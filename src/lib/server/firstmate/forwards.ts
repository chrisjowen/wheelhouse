import { spawn as nodeSpawn } from 'node:child_process';
import net from 'node:net';
import type { Readable, Writable } from 'node:stream';

/**
 * Brings a remote second mate's worker previews to this computer. A worker on
 * another host reports its preview on that host's loopback (`preview
 * http://127.0.0.1:5173/`), which the captain's browser cannot reach. For each
 * such port Wheelhouse listens on 127.0.0.1:<local> here, and carries each
 * connection to it over the second mate's own SSH alias (the one
 * `data/secondmates.md` names and fm-on.sh uses) with `ssh -W
 * 127.0.0.1:<port> <alias>`, so the preview answers at http://127.0.0.1:<local>/
 * and shows, and takes comments, as a local one does.
 *
 * `-W` carries that one connection and nothing else: it implies
 * ClearAllForwardings, so no forward from the SSH configuration is opened
 * either, and it opens no port on the host. Only the reported port, only to
 * the host's loopback; the local end listens on 127.0.0.1 only. As with
 * fm-on.sh, ssh keeps the alias's own key and host-key policy, never asks for a
 * password (BatchMode), forwards no agent, X11 or environment and runs nothing
 * remote. A forward opens only when a preview is asked for, is shared by every
 * page that shows it, and closes once nothing has asked for it for IDLE_MS,
 * when its task leaves its second mate's work in flight, or when Wheelhouse
 * stops. A host that cannot be reached (ssh exit 255 before the connection
 * opens) reads as offline; nothing tries it again until a page asks again.
 */

/** A forward nobody has asked for in this long is closed. */
export const IDLE_MS = 5 * 60_000;
/** How long one look through the forward may take. */
const PROBE_MS = 15_000;
const ALIAS = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

export type ForwardResult =
	{ ok: true; port: number } | { ok: false; offline: boolean; reason: string };

/** One `ssh -W` as Wheelhouse uses it: its stdio is the connection. */
export interface Tunnel {
	stdin: Writable | null;
	stdout: Readable | null;
	stderr: Readable | null;
	kill(): void;
	once(event: 'exit', f: (code: number | null) => void): unknown;
	once(event: 'error', f: (e: Error) => void): unknown;
}

export interface ForwardOptions {
	ssh?: string;
	env?: NodeJS.ProcessEnv;
	spawn?: (cmd: string, args: string[], env: NodeJS.ProcessEnv) => Tunnel;
	now?: () => number;
	probeMs?: number;
}

export const forwardKey = (host: string, remotePort: number) => `${host}:${remotePort}`;

/** The ssh arguments for one connection: this host's loopback port, and nothing else. */
export function sshArgs(host: string, remotePort: number): string[] {
	return [
		'-o',
		'BatchMode=yes',
		'-o',
		'ForwardAgent=no',
		'-o',
		'ForwardX11=no',
		'-o',
		'PermitLocalCommand=no',
		'-o',
		'SendEnv=-*',
		'-o',
		'ServerAliveInterval=15',
		'-o',
		'ServerAliveCountMax=3',
		'-W',
		`127.0.0.1:${remotePort}`,
		'--',
		host
	];
}

interface Forward {
	host: string;
	remotePort: number;
	server: net.Server;
	port: number;
	lastUsed: number;
	sockets: Set<net.Socket>;
	ready: Promise<ForwardResult>;
}

export class PreviewForwards {
	private forwards = new Map<string, Forward>();
	private readonly now: () => number;
	private sweeper: ReturnType<typeof setInterval> | null = null;

	constructor(private opts: ForwardOptions = {}) {
		this.now = opts.now ?? Date.now;
	}

	private tunnel(host: string, remotePort: number): Tunnel {
		const env = this.opts.env ?? process.env;
		const args = sshArgs(host, remotePort);
		return this.opts.spawn
			? this.opts.spawn(this.opts.ssh ?? 'ssh', args, env)
			: nodeSpawn(this.opts.ssh ?? 'ssh', args, { env, stdio: ['pipe', 'pipe', 'pipe'] });
	}

	/**
	 * The local port a remote preview port answers on: the forward is opened
	 * (or reused) and one connection through it is tried, so a host that
	 * cannot be reached reads as offline rather than as a stopped preview.
	 */
	open(host: string, remotePort: number): Promise<ForwardResult> {
		if (!ALIAS.test(host)) {
			return Promise.resolve({
				ok: false,
				offline: false,
				reason: 'Its SSH host is not a plain alias.'
			});
		}
		if (!Number.isInteger(remotePort) || remotePort < 1 || remotePort > 65535) {
			return Promise.resolve({
				ok: false,
				offline: false,
				reason: 'The preview names no valid port.'
			});
		}
		const key = forwardKey(host, remotePort);
		const have = this.forwards.get(key);
		if (have) {
			have.lastUsed = this.now();
			return have.ready;
		}
		const server = net.createServer();
		const f: Forward = {
			host,
			remotePort,
			server,
			port: 0,
			lastUsed: this.now(),
			sockets: new Set(),
			ready: Promise.resolve({ ok: false, offline: false, reason: '' })
		};
		server.on('connection', (socket) => this.carry(f, socket));
		f.ready = this.start(f, key);
		this.forwards.set(key, f);
		this.sweepLater();
		return f.ready;
	}

	private async start(f: Forward, key: string): Promise<ForwardResult> {
		const reach = await this.reach(f.host, f.remotePort);
		if (reach !== null) {
			this.close(key);
			return reach;
		}
		try {
			await new Promise<void>((resolve, reject) => {
				f.server.once('error', reject);
				f.server.listen(0, '127.0.0.1', () => resolve());
			});
		} catch {
			this.close(key);
			return { ok: false, offline: false, reason: 'No free port on this computer.' };
		}
		const a = f.server.address();
		f.port = typeof a === 'object' && a ? a.port : 0;
		return { ok: true, port: f.port };
	}

	/**
	 * One look at the host: null when ssh reached it (the preview itself may
	 * still not answer, which the preview check says), else why not.
	 */
	private reach(host: string, remotePort: number): Promise<ForwardResult | null> {
		return new Promise((resolve) => {
			let t: Tunnel;
			try {
				t = this.tunnel(host, remotePort);
			} catch (e) {
				resolve({ ok: false, offline: false, reason: `Could not run ssh: ${String(e)}` });
				return;
			}
			let stderr = '';
			let done = false;
			const finish = (r: ForwardResult | null) => {
				if (done) return;
				done = true;
				clearTimeout(timer);
				try {
					t.kill();
				} catch {
					// already gone
				}
				resolve(r);
			};
			const timer = setTimeout(
				() => finish({ ok: false, offline: true, reason: `${host} did not answer in time.` }),
				this.opts.probeMs ?? PROBE_MS
			);
			t.stderr?.on('data', (d: Buffer) => {
				if (stderr.length < 2_000) stderr += d.toString();
			});
			t.stdout?.once('data', () => finish(null));
			t.once('error', (e) =>
				finish({ ok: false, offline: false, reason: `Could not run ssh: ${e.message}` })
			);
			t.once('exit', (code) => {
				const said = stderr.trim().split('\n').slice(-1)[0]?.slice(0, 300) ?? '';
				// ssh reached the host, which refused the port: the preview is not running there.
				if (/open failed|connect failed|administratively prohibited/i.test(stderr)) finish(null);
				else if (code === 255)
					finish({
						ok: false,
						offline: true,
						reason: `Offline: could not reach ${host}${said ? ` (${said})` : ''}.`
					});
				else finish(null);
			});
			t.stdin?.on('error', () => {});
			t.stdin?.write('HEAD / HTTP/1.0\r\nHost: 127.0.0.1\r\n\r\n');
		});
	}

	/** Carry one browser connection over its own `ssh -W`. */
	private carry(f: Forward, socket: net.Socket): void {
		f.lastUsed = this.now();
		f.sockets.add(socket);
		let t: Tunnel;
		try {
			t = this.tunnel(f.host, f.remotePort);
		} catch {
			socket.destroy();
			return;
		}
		const end = () => {
			f.sockets.delete(socket);
			socket.destroy();
			try {
				t.kill();
			} catch {
				// already gone
			}
		};
		socket.on('error', end);
		socket.on('close', end);
		t.once('exit', end);
		t.once('error', end);
		t.stdin?.on('error', end);
		if (t.stdin) socket.pipe(t.stdin);
		t.stdout?.pipe(socket);
	}

	/** Close every forward but those whose keys (forwardKey) are kept. */
	retain(keep: Set<string>): void {
		for (const k of [...this.forwards.keys()]) if (!keep.has(k)) this.close(k);
	}

	/** Close forwards nobody has asked for in IDLE_MS. */
	sweep(): void {
		const now = this.now();
		for (const [k, f] of [...this.forwards]) if (now - f.lastUsed > IDLE_MS) this.close(k);
	}

	close(key: string): void {
		const f = this.forwards.get(key);
		if (!f) return;
		this.forwards.delete(key);
		for (const s of f.sockets) s.destroy();
		f.server.close();
	}

	closeAll(): void {
		for (const k of [...this.forwards.keys()]) this.close(k);
		if (this.sweeper) clearInterval(this.sweeper);
		this.sweeper = null;
	}

	/** The open forwards. */
	list(): { host: string; remotePort: number; port: number }[] {
		return [...this.forwards.values()].map((f) => ({
			host: f.host,
			remotePort: f.remotePort,
			port: f.port
		}));
	}

	private sweepLater(): void {
		if (this.sweeper) return;
		this.sweeper = setInterval(() => {
			this.sweep();
			if (!this.forwards.size && this.sweeper) {
				clearInterval(this.sweeper);
				this.sweeper = null;
			}
		}, 60_000);
		this.sweeper.unref?.();
	}
}
