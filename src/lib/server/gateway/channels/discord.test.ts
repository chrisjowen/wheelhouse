import { afterEach, describe, expect, it, vi } from 'vitest';
import type { InboundEvent } from '../adapter';
import {
	checkDiscordToken,
	DISCORD_API,
	DISCORD_INTENTS,
	DiscordAdapter,
	type DiscordTransport
} from './discord';

/**
 * The Discord adapter against a fake Discord: a gateway socket the test
 * speaks for (HELLO, READY, dispatches, closes) and a REST API that records
 * every call. Nothing reaches the network.
 */

const TOKEN = 'fake-bot-token.for-wheelhouse-tests.not-a-real-discord-token';
const BOT = '999000000000000001';
const CAPTAIN = '111111111111111111';
const DM = '555000000000000001';

class FakeSocket {
	sent: { op: number; d: Record<string, unknown> | number | null }[] = [];
	closed: number | null = null;
	constructor(
		readonly url: string,
		private on: Parameters<DiscordTransport['connect']>[1]
	) {}
	send(data: string) {
		this.sent.push(JSON.parse(data));
	}
	close(code: number) {
		if (this.closed !== null) return;
		this.closed = code;
		setImmediate(() => this.on.close(code));
	}
	/** Discord says something. */
	say(op: number, d: unknown, t: string | null = null, s: number | null = null) {
		this.on.message(JSON.stringify({ op, d, t, s }));
	}
	/** Discord drops the connection. */
	drop(code: number) {
		this.closed = code;
		this.on.close(code);
	}
}

class FakeDiscord implements DiscordTransport {
	requests: { method: string; route: string; body: unknown; headers: Record<string, string> }[] =
		[];
	sockets: FakeSocket[] = [];
	private n = 0;
	override: Record<string, () => Response> = {};

	async fetch(url: string, init: RequestInit): Promise<Response> {
		const route = url.slice(DISCORD_API.length);
		const method = init.method ?? 'GET';
		this.requests.push({
			method,
			route,
			body: init.body ? JSON.parse(init.body as string) : undefined,
			headers: init.headers as Record<string, string>
		});
		const key = `${method} ${route}`;
		if (this.override[key]) return this.override[key]();
		const ok = (v: unknown) => new Response(JSON.stringify(v), { status: 200 });
		if (key === 'GET /gateway/bot') return ok({ url: 'wss://gateway.test' });
		if (key === 'POST /users/@me/channels') return ok({ id: DM });
		if (method === 'POST' && /^\/channels\/\d+\/messages$/.test(route))
			return ok({ id: `60000000000000${++this.n}` });
		if (key === 'GET /users/@me') return ok({ id: BOT, username: 'wheelhouse-bot' });
		if (key === 'GET /applications/@me') return ok({ id: '777', bot_public: true });
		return new Response(null, { status: 204 });
	}
	connect(url: string, on: Parameters<DiscordTransport['connect']>[1]) {
		const s = new FakeSocket(url, on);
		this.sockets.push(s);
		return s;
	}
	get socket(): FakeSocket {
		return this.sockets[this.sockets.length - 1];
	}
}

const tick = () => new Promise((r) => setImmediate(r));
async function until(cond: () => boolean) {
	for (let i = 0; i < 200 && !cond(); i++) await tick();
	if (!cond()) throw new Error('timed out');
}

let abort: AbortController;
afterEach(() => {
	abort?.abort();
	vi.useRealTimers();
});

async function connected(opts: { random?: () => number } = {}) {
	const discord = new FakeDiscord();
	const adapter = new DiscordAdapter({
		token: TOKEN,
		transport: discord,
		version: '1.2.3',
		reconnectBaseMs: 1,
		reconnectMaxMs: 2,
		random: opts.random ?? (() => 0.5)
	});
	const events: InboundEvent[] = [];
	abort = new AbortController();
	const done = adapter.run((e) => events.push(e), abort.signal);
	await until(() => discord.sockets.length === 1);
	discord.socket.say(10, { heartbeat_interval: 60_000 });
	discord.socket.say(
		0,
		{
			session_id: 'sess-1',
			resume_gateway_url: 'wss://resume.test',
			user: { id: BOT, username: 'wheelhouse-bot' }
		},
		'READY',
		1
	);
	return { discord, adapter, events, done };
}

describe('the gateway connection', () => {
	it('identifies with the direct-message intent only and reports who it is', async () => {
		const { discord, adapter } = await connected();
		expect(discord.socket.url).toBe('wss://gateway.test?v=10&encoding=json');
		const identify = discord.socket.sent.find((p) => p.op === 2)!;
		expect(identify.d).toMatchObject({ token: TOKEN, intents: DISCORD_INTENTS });
		expect(DISCORD_INTENTS).toBe(4096);
		expect(adapter.health()).toEqual({
			state: 'connected',
			reason: null,
			self: { id: BOT, name: 'wheelhouse-bot' }
		});
		// The REST calls carry the token in the Authorization header and a Discord-style User-Agent.
		expect(discord.requests[0].headers).toMatchObject({
			authorization: `Bot ${TOKEN}`,
			'user-agent': 'DiscordBot (https://github.com/chrisjowen/wheelhouse, 1.2.3)'
		});
	});

	it('heartbeats with the last sequence, and reconnects to resume when a beat goes unanswered', async () => {
		vi.useFakeTimers({ toFake: ['setTimeout', 'setInterval', 'clearTimeout', 'clearInterval'] });
		const { discord } = await connected({ random: () => 0 });
		discord.socket.say(0, {}, 'TYPING_START', 7);
		await vi.advanceTimersByTimeAsync(1);
		expect(discord.socket.sent.filter((p) => p.op === 1)).toEqual([{ op: 1, d: 7 }]);
		discord.socket.say(11, null);
		await vi.advanceTimersByTimeAsync(60_000);
		expect(discord.socket.sent.filter((p) => p.op === 1)).toHaveLength(2);
		// No ACK for that one: the next beat finds a zombie connection and closes it.
		await vi.advanceTimersByTimeAsync(60_000);
		vi.useRealTimers();
		expect(discord.sockets[0].closed).toBe(4000);
		await until(() => discord.sockets.length === 2);
		expect(discord.socket.url).toBe('wss://resume.test?v=10&encoding=json');
		discord.socket.say(10, { heartbeat_interval: 60_000 });
		expect(discord.socket.sent[0]).toEqual({
			op: 6,
			d: { token: TOKEN, session_id: 'sess-1', seq: 7 }
		});
	});

	it('resumes after Discord asks it to reconnect, and identifies afresh after an invalid session', async () => {
		const { discord, adapter } = await connected();
		discord.socket.say(7, null);
		await until(() => discord.sockets.length === 2);
		discord.socket.say(10, { heartbeat_interval: 60_000 });
		expect(discord.socket.sent[0].op).toBe(6);
		discord.socket.say(0, {}, 'RESUMED', 2);
		expect(adapter.health().state).toBe('connected');

		// Discord asks for a wait of one to five seconds before identifying again.
		vi.useFakeTimers({ toFake: ['setTimeout', 'setInterval', 'clearTimeout', 'clearInterval'] });
		discord.socket.say(9, false);
		await vi.advanceTimersByTimeAsync(900);
		expect(discord.sockets).toHaveLength(2);
		await vi.advanceTimersByTimeAsync(5000);
		vi.useRealTimers();
		await until(() => discord.sockets.length === 3);
		expect(discord.socket.url).toBe('wss://gateway.test?v=10&encoding=json');
		discord.socket.say(10, { heartbeat_interval: 60_000 });
		expect(discord.socket.sent[0].op).toBe(2);
	});

	it('stops for good when Discord refuses the token, and says what to do', async () => {
		const { discord, adapter, done } = await connected();
		discord.socket.drop(4004);
		await done;
		expect(adapter.health()).toMatchObject({
			state: 'down',
			reason: expect.stringMatching(/refused the bot token.*gateway connect discord/)
		});
		expect(discord.sockets).toHaveLength(1);
	});

	it('does not connect at all with a token the REST API refuses', async () => {
		const discord = new FakeDiscord();
		discord.override['GET /gateway/bot'] = () =>
			new Response(JSON.stringify({ message: '401: Unauthorized' }), { status: 401 });
		const adapter = new DiscordAdapter({ token: TOKEN, transport: discord });
		abort = new AbortController();
		await adapter.run(() => {}, abort.signal);
		expect(adapter.health().state).toBe('down');
		expect(discord.sockets).toEqual([]);
	});

	it('never puts the token in a reason, even when an error repeats it', async () => {
		const discord = new FakeDiscord();
		let failed = 0;
		discord.fetch = async () => {
			failed++;
			throw new Error(`getaddrinfo failed for Bot ${TOKEN}`);
		};
		const adapter = new DiscordAdapter({
			token: TOKEN,
			transport: discord,
			reconnectBaseMs: 1,
			reconnectMaxMs: 1
		});
		abort = new AbortController();
		void adapter.run(() => {}, abort.signal);
		await until(() => failed > 0);
		await tick();
		const h = adapter.health();
		expect(h.state).toBe('connecting');
		expect(h.reason).toMatch(/could not reach Discord/);
		expect(h.reason).not.toContain(TOKEN);
	});
});

describe('events from Discord', () => {
	it('passes on the captain’s direct messages and nothing a bot wrote', async () => {
		const { discord, events } = await connected();
		const msg = (d: Record<string, unknown>) =>
			discord.socket.say(
				0,
				{
					id: '700000000000000001',
					channel_id: DM,
					type: 0,
					content: 'hello',
					author: { id: CAPTAIN, username: 'cap', global_name: 'Captain' },
					attachments: [],
					embeds: [],
					...d
				},
				'MESSAGE_CREATE',
				3
			);
		msg({});
		msg({ author: { id: BOT, username: 'wheelhouse-bot', bot: true } });
		msg({ author: { id: '3', username: 'other', bot: true } });
		msg({ id: '700000000000000002', guild_id: '42', channel_id: '43' });
		msg({
			id: '700000000000000003',
			type: 19,
			message_reference: { message_id: '600000000000001', channel_id: DM }
		});
		msg({
			id: '700000000000000004',
			content: '',
			message_reference: { type: 1, message_id: '1', channel_id: '2' },
			message_snapshots: [{ message: { content: 'someone else said' } }]
		});
		msg({ id: '700000000000000005', type: 6 });
		expect(events).toEqual([
			{
				kind: 'text',
				id: '700000000000000001',
				from: CAPTAIN,
				fromName: 'Captain',
				dm: true,
				chat: DM,
				text: 'hello',
				inReplyTo: null,
				extras: false
			},
			expect.objectContaining({ id: '700000000000000002', dm: false }),
			expect.objectContaining({
				id: '700000000000000003',
				inReplyTo: { chat: DM, id: '600000000000001' }
			}),
			// A forward carries someone else's words: none of them is passed on.
			expect.objectContaining({ id: '700000000000000004', text: '', extras: true, inReplyTo: null })
		]);
	});

	it('turns a press of one of its buttons into a button event, and acknowledges it in time', async () => {
		const { discord, adapter, events } = await connected();
		discord.socket.say(
			0,
			{
				id: '800000000000000001',
				type: 3,
				token: 'interaction-token_1',
				channel_id: DM,
				user: { id: CAPTAIN, username: 'cap' },
				data: { custom_id: 'wh:abc123', component_type: 2 },
				message: { id: '600000000000001', channel_id: DM }
			},
			'INTERACTION_CREATE',
			4
		);
		discord.socket.say(
			0,
			{
				id: '8',
				type: 3,
				token: 't',
				channel_id: DM,
				user: { id: CAPTAIN },
				data: { custom_id: 'other' }
			},
			'INTERACTION_CREATE',
			5
		);
		expect(events).toEqual([
			{
				kind: 'button',
				id: '800000000000000001',
				from: CAPTAIN,
				fromName: 'cap',
				dm: true,
				chat: DM,
				token: 'abc123',
				message: { chat: DM, id: '600000000000001' },
				handle: '800000000000000001:interaction-token_1'
			}
		]);
		const press = events[0] as Extract<InboundEvent, { kind: 'button' }>;
		await adapter.ack(press);
		await adapter.ack(press, 'This button has expired.');
		const calls = discord.requests.filter((r) => r.route.startsWith('/interactions/'));
		expect(calls).toEqual([
			expect.objectContaining({
				method: 'POST',
				route: '/interactions/800000000000000001/interaction-token_1/callback',
				body: { type: 6 }
			}),
			expect.objectContaining({
				body: { type: 4, data: { content: 'This button has expired.', flags: 64 } }
			})
		]);
	});
});

describe('sending', () => {
	it('opens the direct message once and sends with buttons, mentions off', async () => {
		const { discord, adapter } = await connected();
		const ref = await adapter.send(
			{ id: CAPTAIN, dm: null },
			{
				text: 'PR green: export',
				buttons: [
					{ label: 'Merge', token: 'tok1', style: 'primary' },
					{ label: 'Open PR', url: 'https://github.com/example/lumen/pull/42' }
				],
				replyTo: { chat: DM, id: '700000000000000001' }
			}
		);
		await adapter.send({ id: CAPTAIN, dm: null }, { text: 'again' });
		expect(ref).toEqual({ chat: DM, id: '600000000000001' });
		const calls = discord.requests.filter((r) => r.method === 'POST' && r.route !== '/gateway/bot');
		expect(calls.map((c) => c.route)).toEqual([
			'/users/@me/channels',
			`/channels/${DM}/messages`,
			`/channels/${DM}/messages`
		]);
		expect(calls[0].body).toEqual({ recipient_id: CAPTAIN });
		expect(calls[1].body).toEqual({
			content: 'PR green: export',
			allowed_mentions: { parse: [] },
			components: [
				{
					type: 1,
					components: [
						{ type: 2, style: 1, label: 'Merge', custom_id: 'wh:tok1' },
						{ type: 2, style: 5, label: 'Open PR', url: 'https://github.com/example/lumen/pull/42' }
					]
				}
			],
			message_reference: {
				message_id: '700000000000000001',
				channel_id: DM,
				fail_if_not_exists: false
			}
		});
	});

	it('updates and reacts to its messages, and refuses anything that is not a Discord id', async () => {
		const { discord, adapter } = await connected();
		const ref = { chat: DM, id: '600000000000001' };
		await adapter.update(ref, { text: 'Settled', buttons: [] });
		await adapter.react(ref, '📥');
		expect(discord.requests.slice(-2)).toEqual([
			expect.objectContaining({
				method: 'PATCH',
				route: `/channels/${DM}/messages/600000000000001`,
				body: { content: 'Settled', allowed_mentions: { parse: [] }, components: [] }
			}),
			expect.objectContaining({
				method: 'PUT',
				route: `/channels/${DM}/messages/600000000000001/reactions/${encodeURIComponent('📥')}/@me`
			})
		]);
		await expect(adapter.react({ chat: '../../guilds', id: '1' }, 'x')).rejects.toThrow(
			/Not a Discord message/
		);
	});

	it('explains a refusal without the request’s URL', async () => {
		const { discord, adapter } = await connected();
		discord.override[`POST /channels/${DM}/messages`] = () =>
			new Response(JSON.stringify({ message: 'Cannot send messages to this user', code: 50007 }), {
				status: 403
			});
		await expect(adapter.send({ id: CAPTAIN, dm: DM }, { text: 'hi' })).rejects.toThrow(
			'Discord would not send a message (403: Cannot send messages to this user).'
		);
	});
});

describe('checkDiscordToken', () => {
	it('says whose bot it is and whether anyone can add it', async () => {
		const discord = new FakeDiscord();
		expect(await checkDiscordToken(TOKEN, { transport: discord })).toEqual({
			ok: true,
			bot: { id: BOT, name: 'wheelhouse-bot' },
			appId: '777',
			publicBot: true
		});
	});

	it('says plainly when Discord refuses the token', async () => {
		const discord = new FakeDiscord();
		discord.override['GET /users/@me'] = () => new Response('{}', { status: 401 });
		expect(await checkDiscordToken(TOKEN, { transport: discord })).toEqual({
			ok: false,
			error: expect.stringMatching(/refused this token/)
		});
	});
});
