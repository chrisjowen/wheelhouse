import WebSocket from 'ws';
import type {
	ButtonEvent,
	ChannelAdapter,
	ChannelHealth,
	InboundEvent,
	OutboundButton,
	OutboundMessage,
	Peer,
	SentRef
} from '../adapter';

/**
 * Discord, through its official bot API: one outbound WebSocket to the
 * Discord gateway for the captain's direct messages and button presses, and
 * HTTPS calls for everything sent. Wheelhouse listens on no port for it.
 *
 * It asks for the direct-message intent only (no privileged intent: Discord
 * hands an app the text of direct messages to it without the Message Content
 * intent). It heartbeats as the gateway asks, resumes a dropped session where
 * it can, and reconnects with a backoff otherwise; a token Discord refuses
 * stops it until a new one is set. The token goes only into the
 * Authorization header and the gateway's identify payload, never into a log,
 * an error or a URL.
 */

export const DISCORD_API = 'https://discord.com/api/v10';
const GATEWAY_QUERY = '?v=10&encoding=json';
/** GUILDS is not asked for: the bot reads direct messages only. */
export const DISCORD_INTENTS = 1 << 12; // DIRECT_MESSAGES
const TEXT_LIMIT = 2000;
const BUTTON_LIMIT = 5;
const LABEL_LIMIT = 80;
const SNOWFLAKE = /^\d{1,32}$/;
const REQUEST_TIMEOUT_MS = 15_000;

/** Gateway close codes after which reconnecting cannot help. */
const FATAL: Record<number, string> = {
	4004: 'Discord refused the bot token. Set a new one with `wheelhouse gateway connect discord`.',
	4010: 'Discord refused the connection (invalid shard).',
	4011: 'Discord asked for sharding, which a private bot never needs.',
	4012: 'Discord no longer accepts this API version; update Wheelhouse.',
	4013: 'Discord refused the requested intents.',
	4014: 'Discord refused the direct-message intent for this app.'
};

export interface DiscordSocket {
	send(data: string): void;
	close(code: number): void;
}

export interface DiscordTransport {
	fetch(url: string, init: RequestInit): Promise<Response>;
	connect(
		url: string,
		on: {
			message(data: string): void;
			close(code: number): void;
			error(e: Error): void;
		}
	): DiscordSocket;
}

/** The real thing: Node's fetch and the `ws` client. */
export const wsTransport: DiscordTransport = {
	fetch: (url, init) => fetch(url, init),
	connect(url, on) {
		const ws = new WebSocket(url);
		ws.on('message', (data) => on.message(data.toString()));
		ws.on('close', (code) => on.close(code));
		ws.on('error', (e) => on.error(e));
		return {
			send: (data) => {
				if (ws.readyState === WebSocket.OPEN) ws.send(data);
			},
			close: (code) => ws.close(code)
		};
	}
};

export class DiscordError extends Error {
	constructor(
		readonly status: number,
		message: string
	) {
		super(message);
		this.name = 'DiscordError';
	}
}

export interface DiscordOptions {
	token: string;
	transport?: DiscordTransport;
	/** Wheelhouse's version, for Discord's User-Agent rule. */
	version?: string;
	reconnectBaseMs?: number;
	reconnectMaxMs?: number;
	random?: () => number;
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
	return new Promise((resolve) => {
		const t = setTimeout(done, ms);
		function done() {
			clearTimeout(t);
			signal?.removeEventListener('abort', done);
			resolve();
		}
		signal?.addEventListener('abort', done, { once: true });
	});
}

/** One REST call; `what` names it in errors, since a URL may carry an interaction token. */
async function call<T>(
	transport: DiscordTransport,
	token: string,
	version: string,
	method: string,
	route: string,
	what: string,
	body?: unknown
): Promise<T> {
	const redact = (s: string) => s.split(token).join('[token]');
	for (let attempt = 0; ; attempt++) {
		let res: Response;
		try {
			res = await transport.fetch(`${DISCORD_API}${route}`, {
				method,
				headers: {
					authorization: `Bot ${token}`,
					'content-type': 'application/json',
					'user-agent': `DiscordBot (https://github.com/chrisjowen/wheelhouse, ${version})`
				},
				body: body === undefined ? undefined : JSON.stringify(body),
				signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
			});
		} catch (e) {
			throw new DiscordError(
				0,
				redact(`Wheelhouse could not reach Discord to ${what}: ${(e as Error).message}`)
			);
		}
		if (res.status === 429 && attempt < 2) {
			const j = (await res.json().catch(() => ({}))) as { retry_after?: number };
			await sleep(Math.min(10, Math.max(0.1, Number(j.retry_after) || 1)) * 1000);
			continue;
		}
		const text = await res.text().catch(() => '');
		if (!res.ok) {
			let said = '';
			try {
				said = str((JSON.parse(text) as Obj).message) ?? '';
			} catch {
				// not JSON
			}
			throw new DiscordError(
				res.status,
				redact(`Discord would not ${what} (${res.status}${said ? `: ${said}` : ''}).`)
			);
		}
		return (text ? JSON.parse(text) : undefined) as T;
	}
}

function components(buttons: OutboundButton[] | undefined): Obj[] {
	if (!buttons?.length) return [];
	const row = buttons.slice(0, BUTTON_LIMIT).map((b) => {
		const label = b.label.length > LABEL_LIMIT ? `${b.label.slice(0, LABEL_LIMIT - 1)}…` : b.label;
		if ('url' in b) return { type: 2, style: 5, label, url: b.url };
		const style = b.style === 'primary' ? 1 : b.style === 'danger' ? 4 : 2;
		return { type: 2, style, label, custom_id: `wh:${b.token}` };
	});
	return [{ type: 1, components: row }];
}

export class DiscordAdapter implements ChannelAdapter {
	readonly channel = 'discord' as const;
	readonly limits = { text: TEXT_LIMIT, buttons: BUTTON_LIMIT };
	private token: string;
	private transport: DiscordTransport;
	private version: string;
	private baseMs: number;
	private maxMs: number;
	private random: () => number;
	private state: Omit<ChannelHealth, 'self'> = { state: 'connecting', reason: null };
	private self: ChannelHealth['self'] = null;
	private gatewayUrl: string | null = null;
	private sessionId: string | null = null;
	private resumeUrl: string | null = null;
	private seq: number | null = null;
	private dms = new Map<string, string>();

	constructor(opts: DiscordOptions) {
		this.token = opts.token;
		this.transport = opts.transport ?? wsTransport;
		this.version = opts.version ?? '0';
		this.baseMs = opts.reconnectBaseMs ?? 1_000;
		this.maxMs = opts.reconnectMaxMs ?? 60_000;
		this.random = opts.random ?? Math.random;
	}

	health(): ChannelHealth {
		return { ...this.state, self: this.self };
	}

	private api<T>(method: string, route: string, what: string, body?: unknown): Promise<T> {
		return call<T>(this.transport, this.token, this.version, method, route, what, body);
	}

	async run(sink: (e: InboundEvent) => void, signal: AbortSignal): Promise<void> {
		let failures = 0;
		while (!signal.aborted) {
			const r = await this.session(sink, signal);
			if (signal.aborted) break;
			if (r.fatal) {
				this.state = { state: 'down', reason: r.fatal };
				return;
			}
			failures = r.ready ? 0 : failures + 1;
			this.state = { state: 'connecting', reason: r.reason };
			const wait = Math.min(this.maxMs, this.baseMs * 2 ** failures) * (0.5 + this.random() / 2);
			// Discord asks for one to five seconds before identifying again after an invalid session.
			await sleep(r.invalid ? Math.max(wait, 1000 + this.random() * 4000) : wait, signal);
		}
	}

	/** One connection, from opening the socket until it closes. */
	private async session(
		sink: (e: InboundEvent) => void,
		signal: AbortSignal
	): Promise<{ ready: boolean; fatal?: string; reason: string | null; invalid?: boolean }> {
		if (!this.gatewayUrl) {
			try {
				const g = await this.api<{ url?: string }>('GET', '/gateway/bot', 'look up its gateway');
				this.gatewayUrl = str(g?.url) ?? 'wss://gateway.discord.gg';
			} catch (e) {
				const status = e instanceof DiscordError ? e.status : 0;
				if (status === 401 || status === 403)
					return { ready: false, fatal: FATAL[4004], reason: null };
				return { ready: false, reason: (e as Error).message };
			}
		}
		const resuming = !!(this.sessionId && this.resumeUrl && this.seq !== null);
		const url = `${resuming ? this.resumeUrl : this.gatewayUrl}${GATEWAY_QUERY}`;
		return new Promise((resolve) => {
			let ready = false;
			let invalid = false;
			let lastError: string | null = null;
			let acked = true;
			let first: ReturnType<typeof setTimeout> | null = null;
			let every: ReturnType<typeof setInterval> | null = null;
			let finished = false;
			const send = (op: number, d: unknown) => socket.send(JSON.stringify({ op, d }));
			const beat = () => {
				// No answer to the last heartbeat: the connection is a zombie, so reconnect and resume.
				if (!acked) return socket.close(4000);
				acked = false;
				send(1, this.seq);
			};
			const finish = (code: number) => {
				if (finished) return;
				finished = true;
				if (first) clearTimeout(first);
				if (every) clearInterval(every);
				signal.removeEventListener('abort', onAbort);
				resolve({ ...this.closed(code, ready, lastError), invalid });
			};
			const onAbort = () => {
				socket.close(1000);
				finish(1000);
			};
			const socket = this.transport.connect(url, {
				error: (e) => (lastError = e.message),
				close: (code) => finish(code),
				message: (data) => {
					let p: Obj;
					try {
						p = JSON.parse(data) as Obj;
					} catch {
						return;
					}
					if (typeof p.s === 'number') this.seq = p.s;
					switch (p.op) {
						case 10: {
							const interval = Number(isObj(p.d) ? p.d.heartbeat_interval : 0) || 41_250;
							first = setTimeout(() => {
								beat();
								every = setInterval(beat, interval);
							}, interval * this.random());
							if (resuming) {
								send(6, { token: this.token, session_id: this.sessionId, seq: this.seq });
							} else {
								send(2, {
									token: this.token,
									intents: DISCORD_INTENTS,
									properties: { os: process.platform, browser: 'wheelhouse', device: 'wheelhouse' }
								});
							}
							break;
						}
						case 11:
							acked = true;
							break;
						case 1:
							send(1, this.seq);
							break;
						case 7:
							socket.close(4000);
							break;
						case 9:
							if (p.d !== true) this.forget();
							invalid = true;
							socket.close(4000);
							break;
						case 0:
							if (p.t === 'READY' || p.t === 'RESUMED') {
								ready = true;
								this.state = { state: 'connected', reason: null };
							}
							this.dispatch(str(p.t), p.d, sink);
							break;
					}
				}
			});
			signal.addEventListener('abort', onAbort, { once: true });
		});
	}

	private forget(): void {
		this.sessionId = null;
		this.resumeUrl = null;
		this.seq = null;
	}

	private closed(
		code: number,
		ready: boolean,
		lastError: string | null
	): { ready: boolean; fatal?: string; reason: string | null } {
		if (FATAL[code]) return { ready, fatal: FATAL[code], reason: null };
		// The session cannot be resumed after these; the next connection identifies afresh.
		if (code === 4007 || code === 4009 || code === 1000 || code === 1001) this.forget();
		const why = lastError ? `: ${lastError.split(this.token).join('[token]')}` : '';
		return { ready, reason: `The connection to Discord closed (${code}${why}); reconnecting.` };
	}

	private dispatch(t: string | null, d: unknown, sink: (e: InboundEvent) => void): void {
		if (!isObj(d)) return;
		if (t === 'READY') {
			this.sessionId = str(d.session_id);
			this.resumeUrl = str(d.resume_gateway_url);
			const u = isObj(d.user) ? d.user : {};
			const id = str(u.id);
			if (id) this.self = { id, name: str(u.global_name) ?? str(u.username) ?? id };
			return;
		}
		const e =
			t === 'MESSAGE_CREATE' ? this.text(d) : t === 'INTERACTION_CREATE' ? this.press(d) : null;
		if (!e) return;
		try {
			sink(e);
		} catch {
			// the core's problem, not the connection's
		}
	}

	private text(d: Obj): InboundEvent | null {
		const author = isObj(d.author) ? d.author : null;
		const from = str(author?.id);
		const id = str(d.id);
		const chat = str(d.channel_id);
		// Its own messages, other bots' and system messages (pins, joins) are not the captain's words.
		if (!author || !from || !id || !chat || author.bot === true || from === this.self?.id)
			return null;
		if (d.type !== undefined && d.type !== 0 && d.type !== 19) return null;
		const ref = isObj(d.message_reference) ? d.message_reference : null;
		const forward =
			ref?.type === 1 || (Array.isArray(d.message_snapshots) && d.message_snapshots.length > 0);
		const count = (v: unknown) => (Array.isArray(v) ? v.length : 0);
		const replied = ref && !forward ? str(ref.message_id) : null;
		return {
			kind: 'text',
			id,
			from,
			fromName: str(author.global_name) ?? str(author.username) ?? from,
			dm: !d.guild_id,
			chat,
			text: forward ? '' : (str(d.content) ?? ''),
			inReplyTo: replied ? { chat: str(ref?.channel_id) ?? chat, id: replied } : null,
			extras: forward || count(d.attachments) + count(d.sticker_items) + count(d.embeds) > 0
		};
	}

	private press(d: Obj): InboundEvent | null {
		if (d.type !== 3 || !isObj(d.data)) return null;
		const custom = str(d.data.custom_id);
		const id = str(d.id);
		const token = str(d.token);
		const user = isObj(d.user)
			? d.user
			: isObj(d.member) && isObj(d.member.user)
				? d.member.user
				: null;
		const from = str(user?.id);
		const message = isObj(d.message) ? d.message : null;
		const chat = str(d.channel_id) ?? str(message?.channel_id);
		if (!custom?.startsWith('wh:') || !id || !token || !from || !chat) return null;
		const mid = str(message?.id);
		return {
			kind: 'button',
			id,
			from,
			fromName: str(user?.global_name) ?? str(user?.username) ?? from,
			dm: !d.guild_id,
			chat,
			token: custom.slice(3),
			message: mid ? { chat: str(message?.channel_id) ?? chat, id: mid } : null,
			handle: `${id}:${token}`
		};
	}

	private async dm(user: string): Promise<string> {
		const known = this.dms.get(user);
		if (known) return known;
		if (!SNOWFLAKE.test(user)) throw new DiscordError(0, 'Not a Discord user id.');
		const c = await this.api<{ id?: string }>(
			'POST',
			'/users/@me/channels',
			'open a direct message',
			{
				recipient_id: user
			}
		);
		const id = str(c?.id);
		if (!id) throw new DiscordError(0, 'Discord did not open a direct message.');
		this.dms.set(user, id);
		return id;
	}

	private route(ref: SentRef): string {
		if (!SNOWFLAKE.test(ref.chat) || !SNOWFLAKE.test(ref.id)) {
			throw new DiscordError(0, 'Not a Discord message.');
		}
		return `/channels/${ref.chat}/messages/${ref.id}`;
	}

	async send(to: Peer, m: OutboundMessage): Promise<SentRef> {
		const chat = to.dm && SNOWFLAKE.test(to.dm) ? to.dm : await this.dm(to.id);
		const reply = m.replyTo && SNOWFLAKE.test(m.replyTo.id) ? m.replyTo : null;
		const sent = await this.api<{ id?: string }>(
			'POST',
			`/channels/${chat}/messages`,
			'send a message',
			{
				content: m.text.slice(0, TEXT_LIMIT),
				// Nothing a message says pings anyone.
				allowed_mentions: { parse: [] },
				components: components(m.buttons),
				...(reply
					? {
							message_reference: {
								message_id: reply.id,
								channel_id: reply.chat,
								fail_if_not_exists: false
							}
						}
					: {})
			}
		);
		const id = str(sent?.id);
		if (!id) throw new DiscordError(0, 'Discord did not say which message it sent.');
		return { chat, id };
	}

	async update(ref: SentRef, m: OutboundMessage): Promise<void> {
		await this.api('PATCH', this.route(ref), 'update a message', {
			content: m.text.slice(0, TEXT_LIMIT),
			allowed_mentions: { parse: [] },
			components: components(m.buttons)
		});
	}

	async react(ref: SentRef, emoji: string): Promise<void> {
		await this.api(
			'PUT',
			`${this.route(ref)}/reactions/${encodeURIComponent(emoji)}/@me`,
			'add a reaction'
		);
	}

	async ack(e: ButtonEvent, text?: string): Promise<void> {
		const at = e.handle.indexOf(':');
		const id = e.handle.slice(0, at);
		const token = e.handle.slice(at + 1);
		if (at < 1 || !SNOWFLAKE.test(id) || !/^[A-Za-z0-9._-]+$/.test(token)) {
			throw new DiscordError(0, 'Not a Discord button press.');
		}
		await this.api(
			'POST',
			`/interactions/${id}/${token}/callback`,
			'acknowledge a button',
			// 4 with the ephemeral flag answers only the presser; 6 says the message is about to change.
			text ? { type: 4, data: { content: text, flags: 64 } } : { type: 6 }
		);
	}
}

export interface TokenCheck {
	ok: true;
	bot: { id: string; name: string };
	/** The application's id, for the link that adds the bot to a server. */
	appId: string;
	/** Anyone with the link can add it to their server. */
	publicBot: boolean | null;
}

/** Ask Discord who a token belongs to, without connecting the gateway. */
export async function checkDiscordToken(
	token: string,
	opts: { transport?: DiscordTransport; version?: string } = {}
): Promise<TokenCheck | { ok: false; error: string }> {
	const transport = opts.transport ?? wsTransport;
	const version = opts.version ?? '0';
	try {
		const me = await call<Obj>(
			transport,
			token,
			version,
			'GET',
			'/users/@me',
			'say who the bot is'
		);
		const id = str(me?.id);
		if (!id) return { ok: false, error: 'Discord did not say who the bot is.' };
		const app = await call<Obj>(
			transport,
			token,
			version,
			'GET',
			'/applications/@me',
			'describe the application'
		).catch(() => null);
		return {
			ok: true,
			bot: { id, name: str(me.global_name) ?? str(me.username) ?? id },
			appId: str(app?.id) ?? id,
			publicBot: typeof app?.bot_public === 'boolean' ? app.bot_public : null
		};
	} catch (e) {
		const status = e instanceof DiscordError ? e.status : 0;
		if (status === 401)
			return {
				ok: false,
				error: 'Discord refused this token: it is not a valid bot token, or it was reset.'
			};
		return { ok: false, error: (e as Error).message };
	}
}

/** The link that adds the bot to a server the captain owns (no permissions: it only needs to share one). */
export const inviteUrl = (appId: string) =>
	`https://discord.com/oauth2/authorize?client_id=${encodeURIComponent(appId)}&scope=bot&permissions=0`;
