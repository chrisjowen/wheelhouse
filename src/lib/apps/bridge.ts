import {
	APPS_PROTOCOL,
	type CallToolResult,
	type DisplayMode,
	type ReadResourceResult
} from './types';

/**
 * The host side of an MCP app's bridge: JSON-RPC 2.0 over postMessage, with
 * the view inside Wheelhouse's sandbox frame. Everything the view sends is
 * untrusted: a message that is not well-formed JSON-RPC is dropped, a request
 * Wheelhouse does not offer is answered "method not found", and each one it
 * does offer goes to the page's own handler, which applies Wheelhouse's
 * policy. Wheelhouse sends nothing to the view before it says it is
 * initialized, as the spec requires. No DOM here: the page supplies `send`.
 */

export interface RpcMessage {
	jsonrpc: '2.0';
	id?: string | number;
	method?: string;
	params?: unknown;
	result?: unknown;
	error?: { code: number; message: string; data?: unknown };
}

/** A JSON-RPC error to answer a request with. */
export class RpcError extends Error {
	constructor(
		readonly code: number,
		message: string
	) {
		super(message);
	}
}

export const METHOD_NOT_FOUND = -32601;
export const INVALID_PARAMS = -32602;
/** The spec's code for a request the host denied or could not do. */
export const DENIED = -32000;

const isId = (v: unknown): v is string | number =>
	(typeof v === 'string' && v.length <= 128) || (typeof v === 'number' && Number.isFinite(v));

/** The message, if it is well-formed JSON-RPC 2.0; else null. */
export function parseMessage(data: unknown): RpcMessage | null {
	if (typeof data !== 'object' || data === null || Array.isArray(data)) return null;
	const m = data as Record<string, unknown>;
	if (m.jsonrpc !== '2.0') return null;
	if (m.method !== undefined && (typeof m.method !== 'string' || m.method.length > 128)) {
		return null;
	}
	if (m.id !== undefined && !isId(m.id)) return null;
	if (m.method === undefined && m.id === undefined) return null;
	return m as unknown as RpcMessage;
}

/**
 * One JSON-RPC peer: answers the view's requests through `onRequest`, passes
 * its notifications to `onNotification`, and sends Wheelhouse's own requests
 * and notifications through `send`.
 */
export class RpcPeer {
	private next = 1;
	private readonly pending = new Map<
		string | number,
		{
			resolve: (v: unknown) => void;
			reject: (e: Error) => void;
			timer: ReturnType<typeof setTimeout>;
		}
	>();
	private closed = false;

	constructor(
		private readonly o: {
			send: (m: RpcMessage) => void;
			onRequest: (method: string, params: unknown) => unknown;
			onNotification: (method: string, params: unknown) => void;
		}
	) {}

	/** Take one message from the view. */
	receive(data: unknown): void {
		if (this.closed) return;
		const m = parseMessage(data);
		if (!m) return;
		if (m.method !== undefined && m.id !== undefined) {
			void this.answer(m.id, m.method, m.params);
		} else if (m.method !== undefined) {
			try {
				this.o.onNotification(m.method, m.params);
			} catch {
				// a handler that throws on a notification has nothing to answer
			}
		} else if (m.id !== undefined) {
			const p = this.pending.get(m.id);
			if (!p) return;
			this.pending.delete(m.id);
			clearTimeout(p.timer);
			if (m.error) p.reject(new RpcError(m.error.code, String(m.error.message)));
			else p.resolve(m.result);
		}
	}

	private async answer(id: string | number, method: string, params: unknown) {
		let reply: RpcMessage;
		try {
			const result = await this.o.onRequest(method, params);
			reply = { jsonrpc: '2.0', id, result: result ?? {} };
		} catch (e) {
			const err =
				e instanceof RpcError
					? e
					: new RpcError(DENIED, e instanceof Error ? e.message : String(e));
			reply = { jsonrpc: '2.0', id, error: { code: err.code, message: err.message } };
		}
		if (!this.closed) this.o.send(reply);
	}

	request(method: string, params: unknown, timeoutMs = 10_000): Promise<unknown> {
		if (this.closed) return Promise.reject(new Error('The app is closed.'));
		const id = this.next++;
		return new Promise((resolve, reject) => {
			const timer = setTimeout(() => {
				this.pending.delete(id);
				reject(new Error(`The app did not answer ${method}.`));
			}, timeoutMs);
			this.pending.set(id, { resolve, reject, timer });
			this.o.send({ jsonrpc: '2.0', id, method, params });
		});
	}

	notify(method: string, params: unknown): void {
		if (!this.closed) this.o.send({ jsonrpc: '2.0', method, params });
	}

	close(): void {
		this.closed = true;
		for (const p of this.pending.values()) {
			clearTimeout(p.timer);
			p.reject(new Error('The app is closed.'));
		}
		this.pending.clear();
	}
}

/** What the page does for the view, each under Wheelhouse's policy. */
export interface AppHandlers {
	/** The host context the view starts with (`ui/initialize`). */
	context(): Record<string, unknown>;
	/** A `tools/call` from the view, to its own server. */
	callTool(name: string, args: Record<string, unknown>): Promise<CallToolResult>;
	/** A `resources/read` from the view, from its own server. */
	readResource(uri: string): Promise<ReadResourceResult>;
	/** `ui/message`: true once sent, false when the captain declined. */
	sendMessage(text: string): Promise<boolean>;
	/** `ui/open-link`, already checked to be http(s). */
	openLink(url: string): void;
	/** `ui/request-display-mode`: the mode now in effect. */
	displayMode(mode: DisplayMode): Promise<DisplayMode>;
	/** `ui/notifications/size-changed`. */
	resize(size: { width?: number; height?: number }): void;
	/** `notifications/message` (the view's log). */
	log(level: string, data: unknown): void;
	/** The view has finished `ui/initialize`: Wheelhouse may now send to it. */
	initialized(): void;
}

const record = (v: unknown): Record<string, unknown> =>
	typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {};

const MAX_MESSAGE = 16 * 1024;

/**
 * The view's requests, answered under Wheelhouse's policy: tool calls and
 * resource reads go to the app's own server only (the page's handlers name no
 * other), links must be http(s), a message needs the captain's agreement, and
 * what Wheelhouse does not offer in this first slice (model context,
 * downloads, sampling) is refused.
 */
export function appRequestHandler(
	h: AppHandlers,
	host: { name: string; version: string },
	capabilities: Record<string, unknown>
) {
	return async (method: string, raw: unknown): Promise<unknown> => {
		const params = record(raw);
		switch (method) {
			case 'ui/initialize':
				return {
					protocolVersion: APPS_PROTOCOL,
					hostInfo: host,
					hostCapabilities: capabilities,
					hostContext: h.context()
				};
			case 'ping':
				return {};
			case 'tools/call': {
				if (typeof params.name !== 'string' || !params.name) {
					throw new RpcError(INVALID_PARAMS, 'Name the tool to call.');
				}
				return h.callTool(params.name, record(params.arguments));
			}
			case 'resources/read': {
				if (typeof params.uri !== 'string' || !params.uri) {
					throw new RpcError(INVALID_PARAMS, 'Name the resource to read.');
				}
				return h.readResource(params.uri);
			}
			case 'ui/open-link': {
				let url: URL;
				try {
					url = new URL(String(params.url));
				} catch {
					throw new RpcError(INVALID_PARAMS, 'Invalid URL');
				}
				if (url.protocol !== 'http:' && url.protocol !== 'https:') {
					throw new RpcError(DENIED, 'Policy violation: only http(s) links open.');
				}
				h.openLink(url.href);
				return {};
			}
			case 'ui/message': {
				const blocks = Array.isArray(params.content) ? params.content : [params.content];
				const text = blocks
					.map((b) => record(b))
					.filter((b) => b.type === 'text' && typeof b.text === 'string')
					.map((b) => b.text as string)
					.join('\n\n')
					.trim();
				if (!text) throw new RpcError(INVALID_PARAMS, 'Invalid message format: no text.');
				if (text.length > MAX_MESSAGE)
					throw new RpcError(INVALID_PARAMS, 'The message is too long.');
				if (!(await h.sendMessage(text))) throw new RpcError(DENIED, 'Message sending denied');
				return {};
			}
			case 'ui/request-display-mode': {
				const mode = params.mode;
				if (mode !== 'inline' && mode !== 'fullscreen' && mode !== 'pip') {
					throw new RpcError(INVALID_PARAMS, 'Unknown display mode.');
				}
				return { mode: await h.displayMode(mode) };
			}
			default:
				throw new RpcError(METHOD_NOT_FOUND, `Wheelhouse does not offer ${method}.`);
		}
	};
}

/** The view's notifications Wheelhouse acts on; any other is ignored. */
export function appNotificationHandler(h: AppHandlers) {
	return (method: string, raw: unknown): void => {
		const params = record(raw);
		const px = (v: unknown) =>
			typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.min(v, 100_000) : undefined;
		if (method === 'ui/notifications/initialized') h.initialized();
		else if (method === 'ui/notifications/size-changed') {
			h.resize({ width: px(params.width), height: px(params.height) });
		} else if (method === 'notifications/message') {
			h.log(typeof params.level === 'string' ? params.level : 'info', params.data);
		}
	};
}
