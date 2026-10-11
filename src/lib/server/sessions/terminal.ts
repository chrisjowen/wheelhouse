import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocketServer, type RawData, type WebSocket } from 'ws';
import { LOOPBACK_HOST, refuseCaller } from '../session';
import {
	TERMINAL_CLOSE,
	TERMINAL_PROTOCOL,
	TOKEN_PROTOCOL_PREFIX,
	type TerminalMessage
} from '../../sessions';

/**
 * The live, interactive terminal for a captain's session: a WebSocket at
 * `/api/sessions/<id>/terminal` bridged to a real pty running
 * `tmux -L <socket> attach-session -t =wh-session-<id>`, so Claude Code's TUI
 * renders as it would in the captain's own terminal. Each socket gets its own
 * tmux client; several tabs on one session are several clients. Closing the
 * socket kills only that client (tmux detaches it); the session keeps running.
 *
 * Typing here is input to a live agent, so the upgrade is refused unless it
 *   - is addressed to a loopback Host (no DNS rebinding),
 *   - carries the Origin Wheelhouse served the page from, and
 *   - offers this launch's session token as a subprotocol;
 * and the session must be one Wheelhouse launched and recorded, running on
 * Wheelhouse's own tmux server (SessionManager.terminal decides; it never
 * names any other server). The pty is started only after all of that passes.
 */

const TERMINAL_URL = /^\/api\/sessions\/([^/?#]+)\/terminal(?:\?.*)?$/;
/** Paste is the largest input; 1 MiB of text is far more than a prompt needs. */
const MAX_MESSAGE_BYTES = 1024 * 1024;
const MIN_COLS = 2;
const MAX_COLS = 1000;
const MIN_ROWS = 1;
const MAX_ROWS = 500;
/** Stop reading the pty while this much output waits to be sent, and resume below LOW. */
const HIGH_WATER = 1024 * 1024;
const LOW_WATER = 128 * 1024;

/** The session id a request URL asks for, or null when it is not a terminal URL. */
export function terminalId(url: string | undefined): string | null {
	const m = TERMINAL_URL.exec(url ?? '');
	if (!m) return null;
	try {
		return decodeURIComponent(m[1]);
	} catch {
		return null;
	}
}

export interface Pty {
	onData(listener: (data: string) => void): unknown;
	onExit(listener: (e: { exitCode: number; signal?: number }) => void): unknown;
	write(data: string): void;
	resize(cols: number, rows: number): void;
	kill(signal?: string): void;
	pause(): void;
	resume(): void;
}

export interface PtyOptions {
	cols: number;
	rows: number;
	cwd: string;
	env: NodeJS.ProcessEnv;
}

export type SpawnPty = (file: string, args: string[], opts: PtyOptions) => Pty | Promise<Pty>;

/** What to run in the pty for a session Wheelhouse may attach to. */
export interface AttachTarget {
	argv: string[];
	cwd: string;
	env: NodeJS.ProcessEnv;
}

export type ResolveTarget = (
	id: string
) => Promise<
	{ ok: true; target: AttachTarget } | { ok: false; status: 404 | 409 | 503; error: string }
>;

/** node-pty, loaded on first use so Wheelhouse still starts where it cannot load. */
export const nodePty: SpawnPty = async (file, args, opts) => {
	const mod = (await import('node-pty')) as typeof import('node-pty') & {
		default?: typeof import('node-pty');
	};
	const spawn = mod.spawn ?? mod.default?.spawn;
	return spawn(file, args, { name: 'xterm-256color', ...opts });
};

const STATUS_TEXT: Record<number, string> = {
	400: 'Bad Request',
	403: 'Forbidden',
	404: 'Not Found',
	409: 'Conflict',
	421: 'Misdirected Request',
	503: 'Service Unavailable'
};

/** Answer an upgrade with a plain HTTP error and close the socket. */
export function refuseUpgrade(socket: Duplex, status: number, message: string): void {
	if (socket.destroyed) return;
	const body = `${message}\n`;
	socket.end(
		`HTTP/1.1 ${status} ${STATUS_TEXT[status] ?? 'Error'}\r\n` +
			'Connection: close\r\n' +
			'Content-Type: text/plain; charset=utf-8\r\n' +
			`Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`
	);
}

function offeredProtocols(req: IncomingMessage): string[] {
	return (req.headers['sec-websocket-protocol'] ?? '')
		.split(',')
		.map((p) => p.trim())
		.filter(Boolean);
}

/** Why this upgrade is refused (status and message), or null when the caller may connect. */
export function refuseTerminalCaller(
	req: IncomingMessage
): { status: number; error: string } | null {
	const host = req.headers.host ?? '';
	if (!LOOPBACK_HOST.test(host)) return { status: 421, error: 'Misdirected request' };
	const offered = offeredProtocols(req);
	if (!offered.includes(TERMINAL_PROTOCOL)) {
		return { status: 400, error: `The terminal speaks ${TERMINAL_PROTOCOL} only.` };
	}
	const token = offered.find((p) => p.startsWith(TOKEN_PROTOCOL_PREFIX));
	const refused = refuseCaller(
		req.headers.origin,
		token?.slice(TOKEN_PROTOCOL_PREFIX.length),
		`http://${host.toLowerCase()}`
	);
	return refused ? { status: 403, error: refused } : null;
}

function clamp(n: unknown, min: number, max: number, fallback: number): number {
	const v = typeof n === 'number' ? n : Number(n);
	return Number.isFinite(v) ? Math.min(max, Math.max(min, Math.floor(v))) : fallback;
}

function parseMessage(raw: RawData, isBinary: boolean): TerminalMessage | null {
	if (isBinary) return null;
	try {
		const m = JSON.parse(raw.toString()) as Partial<TerminalMessage>;
		if (m.type === 'input' && typeof m.data === 'string') return { type: 'input', data: m.data };
		if (m.type === 'resize') {
			return {
				type: 'resize',
				cols: clamp(m.cols, MIN_COLS, MAX_COLS, 80),
				rows: clamp(m.rows, MIN_ROWS, MAX_ROWS, 24)
			};
		}
	} catch {
		// not a message
	}
	return null;
}

export interface TerminalServerOptions {
	resolve: ResolveTarget;
	spawn?: SpawnPty;
}

export class TerminalServer {
	private resolve: ResolveTarget;
	private spawn: SpawnPty;
	private wss = new WebSocketServer({
		noServer: true,
		maxPayload: MAX_MESSAGE_BYTES,
		perMessageDeflate: false,
		handleProtocols: (offered) => (offered.has(TERMINAL_PROTOCOL) ? TERMINAL_PROTOCOL : false)
	});
	private open = new Set<{ ws: WebSocket; pty: Pty | null }>();

	constructor(opts: TerminalServerOptions) {
		this.resolve = opts.resolve;
		this.spawn = opts.spawn ?? nodePty;
	}

	/** How many terminals are connected (for tests and shutdown). */
	get connections(): number {
		return this.open.size;
	}

	/**
	 * Handle an HTTP upgrade if it is for a session terminal; returns false (and
	 * leaves the socket alone) for any other URL.
	 */
	handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): boolean {
		const id = terminalId(req.url);
		if (id === null) return false;
		void this.accept(id, req, socket, head);
		return true;
	}

	private async accept(id: string, req: IncomingMessage, socket: Duplex, head: Buffer) {
		socket.on('error', () => socket.destroy());
		const refused = refuseTerminalCaller(req);
		if (refused) return refuseUpgrade(socket, refused.status, refused.error);
		const found = await this.resolve(id).catch((e: Error) => ({
			ok: false as const,
			status: 503 as const,
			error: e.message
		}));
		if (!found.ok) return refuseUpgrade(socket, found.status, found.error);
		const query = new URL(req.url ?? '/', 'http://localhost').searchParams;
		const cols = clamp(query.get('cols'), MIN_COLS, MAX_COLS, 80);
		const rows = clamp(query.get('rows'), MIN_ROWS, MAX_ROWS, 24);
		if (socket.destroyed) return;
		this.wss.handleUpgrade(req, socket, head, (ws) => {
			void this.connect(ws, found.target, cols, rows);
		});
	}

	private async connect(ws: WebSocket, target: AttachTarget, cols: number, rows: number) {
		const conn: { ws: WebSocket; pty: Pty | null } = { ws, pty: null };
		this.open.add(conn);
		let closed = false;
		ws.on('close', () => {
			closed = true;
			this.open.delete(conn);
			conn.pty?.kill();
		});
		ws.on('error', () => ws.terminate());

		let pty: Pty;
		try {
			const [file, ...args] = target.argv;
			pty = await this.spawn(file, args, { cols, rows, cwd: target.cwd, env: target.env });
		} catch (e) {
			ws.close(
				TERMINAL_CLOSE.failed,
				`The terminal could not start: ${(e as Error).message}`.slice(0, 120)
			);
			return;
		}
		if (closed) {
			pty.kill();
			return;
		}
		conn.pty = pty;

		let paused = false;
		pty.onData((data) => {
			if (ws.readyState !== ws.OPEN) return;
			ws.send(Buffer.from(data, 'utf8'), { binary: true }, () => {
				if (paused && ws.bufferedAmount < LOW_WATER) {
					paused = false;
					pty.resume();
				}
			});
			if (!paused && ws.bufferedAmount > HIGH_WATER) {
				paused = true;
				pty.pause();
			}
		});
		pty.onExit(() => {
			conn.pty = null;
			if (ws.readyState === ws.OPEN) ws.close(TERMINAL_CLOSE.detached, 'detached');
		});
		ws.on('message', (raw, isBinary) => {
			const m = parseMessage(raw, isBinary);
			if (!m || !conn.pty) return;
			if (m.type === 'input') conn.pty.write(m.data);
			else conn.pty.resize(m.cols, m.rows);
		});
	}

	/** Close every terminal (each tmux client detaches; the sessions keep running). */
	close(): void {
		for (const { ws, pty } of this.open) {
			pty?.kill();
			ws.close(TERMINAL_CLOSE.shutdown, 'Wheelhouse is closing');
		}
		this.open.clear();
		this.wss.close();
	}
}
