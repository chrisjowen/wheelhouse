import { APP_MIME, UI_EXTENSION } from '../../apps/types';

/**
 * A small MCP client over Streamable HTTP, for the MCP servers plugins
 * declare. It speaks only what an MCP Apps host needs: `initialize`
 * (advertising the `io.modelcontextprotocol/ui` extension, so servers that
 * check for it offer their UI tools), `tools/list`, `tools/call` and
 * `resources/read`. A request is one POST, answered with JSON or with an
 * event stream that carries the response; the server's session id is sent
 * back on every request, and a session the server has forgotten (404) is
 * started again once. It never follows a redirect, reads at most 8 MiB of an
 * answer, and offers the server no sampling, roots or elicitation.
 */

/** MCP revisions this client speaks, newest first; it asks for the first. */
export const PROTOCOL_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26'];
const MAX_BODY = 8 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 10_000;

/** A JSON-RPC error the server answered with, or a failure to reach it. */
export class McpError extends Error {
	constructor(
		message: string,
		/** The JSON-RPC error code, or null when the server could not be reached or understood. */
		readonly code: number | null = null
	) {
		super(message);
	}
}

export interface McpClientOptions {
	/** The server's MCP endpoint (an http(s) URL on this computer). */
	url: string;
	clientInfo: { name: string; version: string };
	fetch?: typeof fetch;
}

interface Session {
	id: string | null;
	protocol: string;
	capabilities: Record<string, unknown>;
	serverInfo: { name?: string; version?: string };
}

type Json = Record<string, unknown>;

export class McpHttpClient {
	private session: Promise<Session> | null = null;
	private next = 1;
	private readonly fetch: typeof fetch;

	constructor(private readonly o: McpClientOptions) {
		this.fetch = o.fetch ?? fetch;
	}

	get url(): string {
		return this.o.url;
	}

	/** Connect (once; again after the server forgets the session) and answer what the server said. */
	async connect(): Promise<Pick<Session, 'protocol' | 'capabilities' | 'serverInfo'>> {
		const s = await this.ensure();
		return { protocol: s.protocol, capabilities: s.capabilities, serverInfo: s.serverInfo };
	}

	/** One request's result, or an McpError. */
	async request(method: string, params: Json, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<Json> {
		const s = await this.ensure();
		try {
			return await this.post(s, method, params, timeoutMs);
		} catch (e) {
			if (!(e instanceof Expired)) throw e;
			// The server forgot the session (it restarted, say): start a new one and ask once more.
			if (this.session && (await this.session.catch(() => null)) === s) this.session = null;
			return this.post(await this.ensure(), method, params, timeoutMs);
		}
	}

	private ensure(): Promise<Session> {
		if (!this.session) {
			this.session = this.initialize().catch((e) => {
				this.session = null;
				throw e;
			});
		}
		return this.session;
	}

	private async initialize(): Promise<Session> {
		const draft: Session = {
			id: null,
			protocol: PROTOCOL_VERSIONS[0],
			capabilities: {},
			serverInfo: {}
		};
		const result = await this.post(draft, 'initialize', {
			protocolVersion: PROTOCOL_VERSIONS[0],
			capabilities: { extensions: { [UI_EXTENSION]: { mimeTypes: [APP_MIME] } } },
			clientInfo: this.o.clientInfo
		});
		const protocol = String(result.protocolVersion ?? '');
		if (!PROTOCOL_VERSIONS.includes(protocol)) {
			throw new McpError(
				`the server speaks MCP ${protocol || '(unknown)'}, which Wheelhouse does not.`
			);
		}
		const s: Session = {
			id: draft.id,
			protocol,
			capabilities: isRecord(result.capabilities) ? result.capabilities : {},
			serverInfo: isRecord(result.serverInfo) ? result.serverInfo : {}
		};
		await this.send(s, { jsonrpc: '2.0', method: 'notifications/initialized' }, DEFAULT_TIMEOUT_MS);
		return s;
	}

	private headers(s: Session, initializing: boolean): Record<string, string> {
		return {
			'content-type': 'application/json',
			accept: 'application/json, text/event-stream',
			...(s.id ? { 'mcp-session-id': s.id } : {}),
			...(initializing ? {} : { 'mcp-protocol-version': s.protocol })
		};
	}

	/** Send a notification; the server answers 202 with no body. */
	private async send(s: Session, message: Json, timeoutMs: number): Promise<void> {
		const r = await this.http(s, message, timeoutMs, false);
		await r.body?.cancel().catch(() => {});
		if (r.status === 404 && s.id) throw new Expired();
		if (!r.ok) throw new McpError(`the server answered ${r.status}.`);
	}

	private async http(s: Session, message: Json, timeoutMs: number, initializing: boolean) {
		try {
			return await this.fetch(this.o.url, {
				method: 'POST',
				headers: this.headers(s, initializing),
				body: JSON.stringify(message),
				redirect: 'error',
				signal: AbortSignal.timeout(timeoutMs)
			});
		} catch (e) {
			const why = (e as Error).name === 'TimeoutError' ? 'it did not answer in time' : 'no answer';
			throw new McpError(`Wheelhouse could not reach the MCP server (${why}).`);
		}
	}

	private async post(
		s: Session,
		method: string,
		params: Json,
		timeoutMs = DEFAULT_TIMEOUT_MS
	): Promise<Json> {
		const id = this.next++;
		const initializing = method === 'initialize';
		const r = await this.http(s, { jsonrpc: '2.0', id, method, params }, timeoutMs, initializing);
		if (r.status === 404 && s.id) {
			await r.body?.cancel().catch(() => {});
			throw new Expired();
		}
		if (!r.ok) {
			await r.body?.cancel().catch(() => {});
			throw new McpError(`the MCP server answered ${r.status} to ${method}.`);
		}
		if (initializing) s.id = r.headers.get('mcp-session-id');
		const type = (r.headers.get('content-type') ?? '').toLowerCase();
		const reply = type.startsWith('text/event-stream')
			? await fromStream(r, id)
			: matching(parseJson(await readCapped(r)), id);
		if (!reply) throw new McpError(`the MCP server sent no answer to ${method}.`);
		if (isRecord(reply.error)) {
			const err = reply.error;
			throw new McpError(
				typeof err.message === 'string' ? err.message : `the MCP server refused ${method}.`,
				typeof err.code === 'number' ? err.code : null
			);
		}
		if (!isRecord(reply.result))
			throw new McpError(`the MCP server's answer to ${method} is not one.`);
		return reply.result;
	}
}

/** The server forgot the session the client named. */
class Expired extends Error {}

const isRecord = (v: unknown): v is Json =>
	typeof v === 'object' && v !== null && !Array.isArray(v);

function parseJson(text: string): unknown {
	try {
		return JSON.parse(text);
	} catch {
		throw new McpError('the MCP server answered with something that is not JSON.');
	}
}

/** The JSON-RPC response for request `id` in what the server sent (one message, or a batch). */
function matching(v: unknown, id: number): Json | null {
	for (const m of Array.isArray(v) ? v : [v]) {
		if (isRecord(m) && m.id === id && ('result' in m || 'error' in m)) return m;
	}
	return null;
}

async function readCapped(r: Response): Promise<string> {
	if (!r.body) return '';
	const reader = r.body.getReader();
	const chunks: Uint8Array[] = [];
	let size = 0;
	for (;;) {
		const { done, value } = await reader.read();
		if (done) break;
		size += value.byteLength;
		if (size > MAX_BODY) {
			await reader.cancel().catch(() => {});
			throw new McpError('the MCP server answered with more than Wheelhouse reads (8 MiB).');
		}
		chunks.push(value);
	}
	return Buffer.concat(chunks).toString('utf8');
}

/**
 * Read an event stream until the response to `id` arrives, skipping the
 * server's own notifications and requests on the way.
 */
async function fromStream(r: Response, id: number): Promise<Json | null> {
	if (!r.body) return null;
	const reader = r.body.getReader();
	const decoder = new TextDecoder();
	let buf = '';
	let data: string[] = [];
	let size = 0;
	try {
		for (;;) {
			const { done, value } = await reader.read();
			if (done) break;
			size += value.byteLength;
			if (size > MAX_BODY) {
				throw new McpError('the MCP server streamed more than Wheelhouse reads (8 MiB).');
			}
			buf += decoder.decode(value, { stream: true });
			let nl: number;
			while ((nl = buf.search(/\r?\n/)) >= 0) {
				const line = buf.slice(0, nl);
				buf = buf.slice(nl + (buf[nl] === '\r' ? 2 : 1));
				if (line === '') {
					if (data.length) {
						let parsed: unknown = null;
						try {
							parsed = JSON.parse(data.join('\n'));
						} catch {
							parsed = null;
						}
						data = [];
						const reply = matching(parsed, id);
						if (reply) return reply;
					}
				} else if (line.startsWith('data:')) {
					data.push(line.slice(line[5] === ' ' ? 6 : 5));
				}
			}
		}
		return null;
	} finally {
		await reader.cancel().catch(() => {});
	}
}
