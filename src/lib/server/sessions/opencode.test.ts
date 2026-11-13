import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fold } from '../../chat/fold';
import {
	answerOpenCodePicker,
	createOpenCodeSession,
	interruptOpenCode,
	openCodeSnapshot,
	openCodeStatus,
	parseOpenCodeConnection,
	pendingOpenCodePicker,
	selectOpenCodeSession,
	sendOpenCode,
	type OpenCodeConnection
} from './opencode';

let server: Server;
let conn: OpenCodeConnection;
let calls: { method: string; path: string; body: unknown }[];
let exists: boolean;
let directory: string;
let messages: unknown[];
let permissions: unknown[];
let questions: unknown[];
let history: ReturnType<typeof admission>[];
let active: Record<string, unknown>;
let override: ((req: IncomingMessage, res: ServerResponse) => boolean) | null;
const SID = 'ses_native_test';
const created = 1794495900000;
const metadata = () => ({ data: { id: SID, location: { directory } } });
const admission = (seq: number, id: string, body: string) => ({
	id: `evt_${seq}`,
	type: 'session.next.prompt.admitted',
	durable: { aggregateID: SID, seq, version: 1 },
	data: {
		timestamp: created + seq,
		sessionID: SID,
		messageID: id,
		prompt: { text: body },
		delivery: 'steer'
	}
});

beforeEach(async () => {
	calls = [];
	exists = true;
	directory = '/tmp/firstmate-native';
	messages = [];
	permissions = [];
	questions = [];
	history = [];
	active = {};
	override = null;
	server = createServer(async (req, res) => {
		try {
			const chunks: Buffer[] = [];
			for await (const chunk of req) chunks.push(Buffer.from(chunk));
			const body = chunks.length
				? (JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown)
				: null;
			const url = new URL(req.url ?? '/', 'http://localhost');
			calls.push({ method: req.method ?? '', path: req.url ?? '', body });
			if (
				req.headers.authorization !==
				`Basic ${Buffer.from('probe:private-test-password').toString('base64')}`
			) {
				res.writeHead(401).end();
				return;
			}
			if (override?.(req, res)) return;
			const send = (value: unknown, code = 200) => {
				res.writeHead(code, { 'content-type': 'application/json' }).end(JSON.stringify(value));
			};
			if (url.pathname === `/api/session/${SID}`) {
				send(exists ? metadata() : {}, exists ? 200 : 404);
				return;
			}
			if (url.pathname === '/api/session' && req.method === 'POST') {
				exists = true;
				send(metadata());
				return;
			}
			if (url.pathname === '/tui/select-session') {
				send(true);
				return;
			}
			if (url.pathname === `/api/session/${SID}/message`) {
				send({ data: [...messages].reverse(), cursor: { next: null, previous: null } });
				return;
			}
			if (url.pathname === `/api/session/${SID}/history`) {
				const after = Number(url.searchParams.get('after') ?? 0);
				send({ data: history.filter((event) => event.durable.seq > after), hasMore: false });
				return;
			}
			if (url.pathname === `/api/session/${SID}/permission`) {
				send({ data: permissions });
				return;
			}
			if (url.pathname === `/api/session/${SID}/question`) {
				send({ data: questions });
				return;
			}
			if (url.pathname === '/api/session/active') {
				send({ data: active });
				return;
			}
			if (req.method === 'POST') {
				res.writeHead(204).end();
				return;
			}
			send({}, 404);
		} catch {
			res.writeHead(500).end();
		}
	});
	await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
	const address = server.address();
	if (!address || typeof address === 'string') throw new Error('missing test address');
	conn = {
		url: `http://127.0.0.1:${address.port}`,
		sessionId: SID,
		username: 'probe',
		password: 'private-test-password',
		directory
	};
});
afterEach(async () => {
	const closed = new Promise<void>((resolve) => server.close(() => resolve()));
	server.closeAllConnections();
	await closed;
});

const permission = () => ({
	id: 'per_first',
	sessionID: SID,
	action: 'shell.exec',
	resources: ['npm test']
});
const question = () => ({
	id: 'que_first',
	sessionID: SID,
	questions: [
		{
			question: 'Which version?',
			header: 'Version',
			custom: false,
			options: [
				{ label: 'Stable', description: 'Use the release.' },
				{ label: 'Next', description: 'Use the preview.' }
			]
		}
	]
});

describe('OpenCode connection boundary', () => {
	it('parses the private numeric-loopback record', () => {
		expect(parseOpenCodeConnection({ ...conn, url: conn.url + '/' })).toEqual(conn);
	});
	it.each([
		'http://example.com:1234',
		'http://localhost:1234',
		'https://127.0.0.1:1234',
		'http://127.0.0.1',
		'http://user:pass@127.0.0.1:1234',
		'http://127.0.0.1:1234/path',
		'http://127.0.0.1:1234/?query',
		'http://127.1:1234'
	])('rejects an unsafe endpoint before fetching: %s', (url) => {
		expect(() => parseOpenCodeConnection({ ...conn, url })).toThrow();
		expect(calls).toEqual([]);
	});
	it.each([
		{ sessionId: '../../other' },
		{ directory: 'relative' },
		{ username: 'a:b' },
		{ password: '' },
		{ password: 'x'.repeat(513) }
	])('rejects invalid session/location/credentials', (extra) => {
		expect(() => parseOpenCodeConnection({ ...conn, ...extra })).toThrow();
	});
	it('blocks redirects without following them or forwarding credentials', async () => {
		override = (_req, res) => {
			res.writeHead(302, { location: 'http://example.com/' }).end();
			return true;
		};
		await expect(openCodeSnapshot(conn)).rejects.toThrow('Could not read OpenCode');
		expect(calls).toHaveLength(1);
	});
	it('rejects oversized native responses', async () => {
		override = (_req, res) => {
			res.writeHead(200).end(' '.repeat(8 * 1024 * 1024 + 1));
			return true;
		};
		await expect(openCodeSnapshot(conn)).rejects.toThrow('size limit');
	});
	it('fails closed when the native session belongs to another directory', async () => {
		directory = '/tmp/another-project';
		await expect(sendOpenCode(conn, 'hello')).rejects.toThrow('does not match');
		expect(calls.every((call) => call.method === 'GET')).toBe(true);
	});
});

describe('OpenCode exact-session lifecycle', () => {
	it('creates the allocated native ID and reuses it on repeated startup', async () => {
		exists = false;
		await createOpenCodeSession(conn);
		await createOpenCodeSession(conn);
		expect(calls.filter((call) => call.path === '/api/session')).toEqual([
			{ method: 'POST', path: '/api/session', body: { id: SID, location: { directory } } }
		]);
	});
	it('selects only the exact verified session', async () => {
		await selectOpenCodeSession(conn);
		expect(calls.at(-1)).toEqual({
			method: 'POST',
			path: `/tui/select-session?directory=${encodeURIComponent(directory)}`,
			body: { sessionID: SID }
		});
	});
	it('sends text to the bound native prompt API and interrupts without terminal keys', async () => {
		await sendOpenCode(conn, ' hello\r\nworld ');
		await interruptOpenCode(conn);
		const prompt = calls.find((call) => call.path.endsWith('/prompt'));
		expect(prompt?.body).toMatchObject({ prompt: { text: 'hello\nworld' }, delivery: 'steer' });
		expect(prompt?.body).toHaveProperty('id', expect.stringMatching(/^msg_/));
		expect(calls.at(-1)).toMatchObject({ method: 'POST', path: `/api/session/${SID}/interrupt` });
	});
	it('rejects invalid or oversized messages before posting anything', async () => {
		for (const value of ['', 'a\0b', 'x'.repeat(65537)])
			await expect(sendOpenCode(conn, value)).rejects.toMatchObject({ status: 400 });
		expect(calls).toEqual([]);
	});
});

describe('OpenCode canonical snapshots', () => {
	it('renders native text, reasoning, tool activity and failures with the existing chat fold', async () => {
		messages = [
			{ id: 'msg_user', type: 'user', time: { created }, text: 'Check the build' },
			{
				id: 'msg_reply',
				type: 'assistant',
				time: { created: created + 1, completed: created + 5 },
				finish: 'stop',
				content: [
					{ id: 'thinking', type: 'reasoning', text: 'Check tests.' },
					{
						id: 'tool',
						type: 'tool',
						name: 'bash',
						state: {
							status: 'error',
							input: { command: 'npm test' },
							content: [],
							error: { type: 'unknown', message: 'test failed' }
						}
					},
					{ id: 'reply', type: 'text', text: 'The tests failed.' }
				]
			}
		];
		const snapshot = await openCodeSnapshot(conn);
		const chat = fold(snapshot.records);
		expect(chat.items[0]).toMatchObject({ kind: 'user', text: 'Check the build' });
		expect(chat.items[1]).toMatchObject({ kind: 'turn', done: true });
		expect(JSON.stringify(chat)).toContain('The tests failed.');
		expect(JSON.stringify(chat)).toContain('test failed');
		expect(JSON.stringify(chat)).toContain('"isError":true');
		expect(snapshot.source).toMatchObject({ truncated: false });
	});
	it('shows admitted input before native execution projects a user message, without duplicating it later', async () => {
		history = [admission(1, 'msg_queued', 'Queued request')];
		const first = await openCodeSnapshot(conn);
		expect(fold(first.records).items).toMatchObject([{ kind: 'user', text: 'Queued request' }]);
		messages = [
			{ id: 'msg_queued', type: 'user', time: { created: created + 1 }, text: 'Queued request' }
		];
		const second = await openCodeSnapshot(conn);
		expect(fold(second.records).items).toHaveLength(1);
		expect(calls.some((call) => call.path.includes('/history?after=1'))).toBe(true);
	});
	it('returns changed assistant content under stable IDs for snapshot replacement', async () => {
		messages = [
			{
				id: 'msg_live',
				type: 'assistant',
				time: { created },
				content: [{ id: 'part', type: 'text', text: 'Hello' }]
			}
		];
		const first = await openCodeSnapshot(conn);
		messages = [
			{
				id: 'msg_live',
				type: 'assistant',
				time: { created },
				content: [{ id: 'part', type: 'text', text: 'Hello world' }]
			}
		];
		const second = await openCodeSnapshot(conn);
		expect(second.records[0].uuid).toBe(first.records[0].uuid);
		expect(JSON.stringify(second.records)).toContain('Hello world');
	});
	it('rejects durable events for a different native session', async () => {
		const event = admission(1, 'msg_wrong', 'wrong');
		event.data.sessionID = 'ses_other';
		history = [event];
		await expect(openCodeSnapshot(conn)).rejects.toThrow('outside the bound session');
	});
	it('bounds normalized records to the existing chat limit', async () => {
		messages = Array.from({ length: 6001 }, (_, i) => ({
			id: `msg_${i}`,
			type: 'user',
			time: { created: created + i },
			text: `message ${i}`
		}));
		const snapshot = await openCodeSnapshot(conn);
		expect(snapshot.records).toHaveLength(6000);
		expect(snapshot.source.truncated).toBe(true);
		expect(snapshot.records.at(-1)?.message.content).toBe('message 6000');
	});
});

describe('OpenCode pending requests', () => {
	it('shows native busy state and explicit one-time permission choices', async () => {
		permissions = [permission()];
		active = { [SID]: { type: 'running' } };
		const status = await openCodeStatus(conn);
		expect(status.busy).toBe(true);
		expect(status.picker?.options.map((option) => option.label)).toEqual(['Allow once', 'Reject']);
		expect(status.picker?.title).toContain('npm test');
	});
	it('revalidates the current signature and sends the exact permission answer', async () => {
		permissions = [permission()];
		const picker = await pendingOpenCodePicker(conn);
		await answerOpenCodePicker(conn, picker?.signature ?? '', { press: 1 });
		expect(calls.at(-1)).toEqual({
			method: 'POST',
			path: `/api/session/${SID}/permission/per_first/reply`,
			body: { reply: 'once' }
		});
	});
	it('rejects a changed permission before posting a stale approval', async () => {
		permissions = [permission()];
		const picker = await pendingOpenCodePicker(conn);
		permissions = [{ ...permission(), resources: ['delete everything'] }];
		await expect(
			answerOpenCodePicker(conn, picker?.signature ?? '', { press: 1 })
		).rejects.toMatchObject({ status: 409 });
		expect(calls.every((call) => call.method === 'GET')).toBe(true);
	});
	it('refuses composer sends while a native interaction is waiting', async () => {
		permissions = [permission()];
		await expect(sendOpenCode(conn, 'unrelated text')).rejects.toMatchObject({ status: 409 });
		expect(calls.every((call) => call.method === 'GET')).toBe(true);
	});
	it('answers a single-choice native question by its offered label', async () => {
		questions = [question()];
		const picker = await pendingOpenCodePicker(conn);
		await answerOpenCodePicker(conn, picker?.signature ?? '', { press: 2 });
		expect(calls.at(-1)).toEqual({
			method: 'POST',
			path: `/api/session/${SID}/question/que_first/reply`,
			body: { answers: [['Next']] }
		});
	});
	it('keeps unsupported multiple-answer questions in the optional native terminal', async () => {
		const request = question();
		questions = [{ ...request, questions: [{ ...request.questions[0], multiple: true }] }];
		expect(await openCodeStatus(conn)).toMatchObject({ picker: null, menu: { canDismiss: false } });
	});
	it('rejects unsupported submit actions and answer indices without posting', async () => {
		questions = [question()];
		const picker = await pendingOpenCodePicker(conn);
		await expect(
			answerOpenCodePicker(conn, picker?.signature ?? '', { press: 7 })
		).rejects.toMatchObject({ status: 400 });
		await expect(
			answerOpenCodePicker(conn, picker?.signature ?? '', { submit: true })
		).rejects.toMatchObject({ status: 400 });
		expect(calls.every((call) => call.method === 'GET')).toBe(true);
	});
});
