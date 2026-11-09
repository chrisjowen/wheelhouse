import { EventEmitter } from 'node:events';
import http from 'node:http';
import net from 'node:net';
import { PassThrough } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { forwardKey, PreviewForwards, sshArgs, type Tunnel } from './forwards';

/*
 * A stand-in for `ssh -W 127.0.0.1:<port> <alias>`: it connects to that port
 * on this computer (the "host"), and fails as ssh does for a host it cannot
 * reach (exit 255) or a port nothing listens on there ("open failed").
 */
const calls: { cmd: string; args: string[] }[] = [];
function fakeSsh(cmd: string, args: string[]): Tunnel {
	calls.push({ cmd, args });
	const host = args[args.length - 1];
	const port = Number(args[args.indexOf('-W') + 1].split(':')[1]);
	const ev = new EventEmitter();
	const stdin = new PassThrough();
	const stdout = new PassThrough();
	const stderr = new PassThrough();
	let ended = false;
	const exit = (code: number, said: string) => {
		if (ended) return;
		ended = true;
		stderr.end(said);
		setImmediate(() => ev.emit('exit', code));
	};
	const t: Tunnel = {
		stdin,
		stdout,
		stderr,
		kill: () => exit(0, ''),
		once: (e: string, f: (...a: unknown[]) => void) => ev.once(e, f)
	} as Tunnel;
	if (host === 'unreachable') {
		exit(255, 'ssh: connect to host unreachable port 22: Connection refused\n');
		return t;
	}
	const sock = net.connect({ host: '127.0.0.1', port });
	sock.once('error', () =>
		exit(255, 'channel 0: open failed: connect failed: Connection refused\n')
	);
	sock.once('connect', () => {
		stdin.pipe(sock);
		sock.pipe(stdout);
	});
	sock.once('close', () => exit(0, ''));
	return t;
}

let preview: http.Server;
let port = 0;
beforeEach(async () => {
	calls.length = 0;
	preview = http.createServer((_req, res) => res.end('<html>remote preview</html>'));
	await new Promise<void>((r) => preview.listen(0, '127.0.0.1', () => r()));
	port = (preview.address() as net.AddressInfo).port;
});
afterEach(() => preview.close());

const forwards = (now = () => Date.now()) =>
	new PreviewForwards({ spawn: (cmd, args) => fakeSsh(cmd, args), now, probeMs: 2_000 });

describe('remote preview forwards', () => {
	it('carry one loopback port over the alias with -W, forwarding nothing else', () => {
		const args = sshArgs('tokyo-box', 5173);
		expect(args.slice(-4)).toEqual(['-W', '127.0.0.1:5173', '--', 'tokyo-box']);
		expect(args).toContain('BatchMode=yes');
		expect(args).toContain('ForwardAgent=no');
		expect(args).toContain('SendEnv=-*');
		expect(args).not.toContain('-L');
		expect(args).not.toContain('-R');
	});

	it('bring a remote preview to 127.0.0.1 here, shared by every page that asks', async () => {
		const f = forwards();
		const a = await f.open('tokyo-box', port);
		expect(a.ok).toBe(true);
		if (!a.ok) return;
		expect(a.port).not.toBe(port);
		const body = await (await fetch(`http://127.0.0.1:${a.port}/`)).text();
		expect(body).toBe('<html>remote preview</html>');
		expect(await f.open('tokyo-box', port)).toEqual(a);
		expect(f.list()).toEqual([{ host: 'tokyo-box', remotePort: port, port: a.port }]);
		f.closeAll();
	});

	it('read a host that cannot be reached as offline, and keep nothing open', async () => {
		const f = forwards();
		const r = await f.open('unreachable', port);
		expect(r).toMatchObject({ ok: false, offline: true });
		expect(f.list()).toEqual([]);
	});

	it('still open when the host is reached but the preview is not running there', async () => {
		const f = forwards();
		const closed = await new Promise<number>((r) => {
			const s = net.createServer();
			s.listen(0, '127.0.0.1', () => {
				const p = (s.address() as net.AddressInfo).port;
				s.close(() => r(p));
			});
		});
		const r = await f.open('tokyo-box', closed);
		expect(r.ok).toBe(true);
		f.closeAll();
	});

	it('refuse an alias that is not plain, or a port that is not one', async () => {
		const f = forwards();
		expect(await f.open('-oProxyCommand=x', port)).toMatchObject({ ok: false, offline: false });
		expect(await f.open('tokyo-box', 70000)).toMatchObject({ ok: false });
		expect(calls).toEqual([]);
	});

	it('close when idle, or when its task is no longer kept', async () => {
		let t = 1_000;
		const f = forwards(() => t);
		await f.open('tokyo-box', port);
		f.retain(new Set([forwardKey('tokyo-box', port)]));
		expect(f.list()).toHaveLength(1);
		f.retain(new Set());
		expect(f.list()).toEqual([]);
		await f.open('tokyo-box', port);
		t += 6 * 60_000;
		f.sweep();
		expect(f.list()).toEqual([]);
		f.closeAll();
	});
});
