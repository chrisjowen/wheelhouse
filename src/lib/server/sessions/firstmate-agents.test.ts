import { createServer, type Server } from 'node:http';
import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	realpathSync,
	rmSync,
	statSync,
	writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { LaunchSpec, SessionBackend, SessionKey } from './backend';
import { FirstmateSession, HOOK_RECORD, sessionScope } from './firstmate';
import { piExtensionSource } from './pi';

/**
 * What FirstmateSession does for Pi and OpenCode, the primary agents with only
 * launch tests in firstmate.test.ts: how each is recovered after a Wheelhouse
 * restart, read off its screen or API, typed into, stopped and answered.
 */

let root: string;
let firstmateDir: string;
let stateDir: string;
let screen: string | null;
let now: number;
/** What the session asked of its backend, in order. */
let did: (string | [string, unknown])[];
let running: boolean;
let variables: Record<string, string>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const NONCE = '6f1c2b7e-3d4a-4e5f-8a9b-0c1d2e3f4a5b';

const backend: SessionBackend = {
	label: 'fakemux',
	unavailable: () => null,
	running: async () => running,
	start: async (spec: LaunchSpec) => {
		did.push(['start', spec]);
		running = true;
		variables = { ...spec.env };
		return { ok: true };
	},
	variable: async (name: string) => variables[name] ?? '',
	screen: async () => screen,
	paste: async (text: string) => {
		did.push(['paste', text]);
		return { ok: true };
	},
	key: async (key: SessionKey) => {
		did.push(['key', key]);
		return { ok: true };
	},
	attach: () => ({ argv: ['fakemux', 'attach'], env: {} }),
	attachHint: () => 'fakemux attach'
};

function session(harness: 'pi' | 'opencode', extra: { piProvider?: () => string | null } = {}) {
	return new FirstmateSession({
		harness,
		firstmateDir,
		homeDir: firstmateDir,
		stateDir,
		lock: async () => 'free',
		backend,
		env: { PATH: '/opt/bin', HOME: root },
		find: (name) => (name === harness ? `/opt/bin/${name}` : null),
		trustStore: null,
		sleep: async () => {},
		now: () => now,
		...extra
	});
}

/** This home's session files, where every session Wheelhouse starts writes its record. */
const sessionDir = () => path.join(sessionScope(stateDir, firstmateDir), path.dirname(HOOK_RECORD));
const hookFile = () => path.join(sessionScope(stateDir, firstmateDir), HOOK_RECORD);
const started = () => did.find((d): d is ['start', LaunchSpec] => d[0] === 'start')?.[1];
const typed = () => did.filter((d) => d[0] === 'paste' || d[0] === 'key');

beforeEach(() => {
	root = realpathSync(mkdtempSync(path.join(tmpdir(), 'wh-agents-')));
	firstmateDir = path.join(root, 'firstmate');
	stateDir = path.join(root, 'state');
	mkdirSync(firstmateDir);
	screen = '';
	now = 0;
	did = [];
	running = false;
	variables = {};
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

describe('on Pi', () => {
	const RULE = '─'.repeat(80);
	const IDLE = [
		'Pi startup help: escape interrupt',
		RULE,
		'',
		RULE,
		'/tmp/project',
		'0.0%/1.0M (auto) gpt-4.1'
	].join('\n');
	const BUSY = IDLE.replace(RULE, '── ⠋ Working ' + '─'.repeat(60));
	const UNSENT = IDLE.replace('\n\n' + RULE, '\nunsent prompt\n' + RULE);

	/** A Pi session an earlier Wheelhouse started, still running. */
	const runningPi = (marks: Record<string, string>) => {
		running = true;
		variables = { WHEELHOUSE_HARNESS: 'pi', ...marks };
	};

	it('starts it with Wheelhouse’s extension, its record and a launch nonce', async () => {
		const s = session('pi');
		expect(await s.ensure()).toMatchObject({
			state: 'ours',
			harness: 'pi',
			canSend: true,
			reason: null,
			skipPermissions: false
		});
		const extension = path.join(sessionDir(), 'pi-extension.mjs');
		const spec = started()!;
		expect(spec.argv).toEqual(['/opt/bin/pi', '--approve', '--extension', extension]);
		expect(spec.env).toEqual({
			WHEELHOUSE_HARNESS: 'pi',
			WH_SESSION_RECORD: hookFile(),
			WH_SESSION_NONCE: expect.stringMatching(UUID)
		});
		expect(readFileSync(extension, 'utf8')).toBe(piExtensionSource());
		expect(statSync(extension).mode & 0o777).toBe(0o600);
	});

	it('finds its record and nonce again after a Wheelhouse restart', async () => {
		runningPi({ WH_SESSION_RECORD: hookFile(), WH_SESSION_NONCE: NONCE });
		screen = IDLE;
		const s = session('pi');
		expect(await s.status()).toMatchObject({ state: 'ours', harness: 'pi', canSend: true });
		expect(await s.ensure()).toMatchObject({ state: 'ours', harness: 'pi', canSend: true });
		expect(started()).toBeUndefined();
	});

	it.each([
		['no record or nonce', () => ({})],
		[
			'another state directory’s record',
			() => ({ WH_SESSION_RECORD: '/elsewhere/session-start.json', WH_SESSION_NONCE: NONCE })
		],
		['a malformed nonce', () => ({ WH_SESSION_RECORD: hookFile(), WH_SESSION_NONCE: 'latest' })]
	])('keeps a session with %s in the drawer but blocks chat input', async (_, marks) => {
		runningPi(marks());
		screen = IDLE;
		const s = session('pi');
		expect(await s.status()).toMatchObject({
			state: 'ours',
			canSend: false,
			reason: expect.stringContaining('This pi session predates chat integration')
		});
		expect((await s.terminal()).ok).toBe(true);
		expect(await s.send('hello')).toEqual({
			ok: false,
			status: 409,
			error: 'Restart the pi session from Wheelhouse to enable its chat recorder.'
		});
		expect(typed()).toEqual([]);
	});

	it('sends a message only at its empty editor, busy or not', async () => {
		const s = session('pi');
		await s.ensure();
		screen = IDLE;
		expect(await s.status()).toMatchObject({ picker: null, menu: null, busy: false });
		expect(await s.send('hello\r\nthere')).toEqual({ ok: true });
		screen = BUSY;
		expect(await s.status()).toMatchObject({ picker: null, menu: null, busy: true });
		expect(await s.send('and more')).toEqual({ ok: true });
		expect(typed()).toEqual([
			['paste', 'hello\nthere'],
			['key', 'Enter'],
			['paste', 'and more'],
			['key', 'Enter']
		]);
		for (const shown of [UNSENT, 'Unknown startup screen']) {
			screen = shown;
			expect((await s.status()).menu).toMatchObject({ canDismiss: false });
			expect(await s.send('this must not be typed')).toEqual({
				ok: false,
				status: 409,
				error: 'pi is waiting for attention. Answer the choice or open its terminal before sending.'
			});
		}
		expect(typed()).toHaveLength(4);
	});

	it('says Pi waits in its terminal only once a dialog stays', async () => {
		const s = session('pi');
		await s.ensure();
		screen = UNSENT;
		const title = 'Pi has unsent input or a dialog. Send or clear it in the terminal first.';
		expect(await s.status()).toMatchObject({
			menu: { title, canDismiss: false },
			terminal: null
		});
		now = 1499;
		expect((await s.status()).terminal).toBeNull();
		now = 1500;
		expect((await s.status()).terminal).toEqual({ excerpt: title });
		screen = IDLE;
		const back = await s.status();
		expect(back.menu).toBeNull();
		expect(back.terminal ?? null).toBeNull();
	});

	it('stops with Escape, and leaves choices and menus to its terminal', async () => {
		const s = session('pi');
		await s.ensure();
		screen = BUSY;
		expect(await s.interrupt()).toEqual({ ok: true });
		expect(typed()).toEqual([['key', 'Escape']]);
		expect(await s.picker()).toBeNull();
		expect(await s.pick('any', { press: 1 })).toEqual({
			ok: false,
			status: 409,
			error: 'That choice is no longer on Firstmate’s screen.'
		});
		expect(await s.dismiss()).toEqual({
			ok: false,
			status: 409,
			error: 'Use the browser terminal to close this harness’s menus.'
		});
		expect(typed()).toEqual([['key', 'Escape']]);
	});
});

describe('on OpenCode', () => {
	const SID = 'ses_0123456789abcdef0123456789abcdef';
	let server: Server;
	let port: number;
	/** Every request the fake OpenCode server took, with its JSON body. */
	let requests: { method: string; path: string; body: unknown; auth: string | undefined }[];
	let sessions: Set<string>;
	let permissions: unknown[];
	let active: Record<string, unknown>;
	let down: boolean;

	beforeEach(async () => {
		requests = [];
		sessions = new Set([SID]);
		permissions = [];
		active = {};
		down = false;
		server = createServer(async (req, res) => {
			const chunks: Buffer[] = [];
			for await (const chunk of req) chunks.push(Buffer.from(chunk));
			const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : null;
			const url = new URL(req.url ?? '/', 'http://localhost');
			requests.push({
				method: req.method ?? '',
				path: url.pathname,
				body,
				auth: req.headers.authorization
			});
			const send = (value: unknown, code = 200) =>
				res.writeHead(code, { 'content-type': 'application/json' }).end(JSON.stringify(value));
			if (down) return void res.writeHead(500).end();
			const id = /^\/api\/session\/([^/]+)$/.exec(url.pathname)?.[1];
			const metadata = (sid: string) => ({
				data: { id: sid, location: { directory: firstmateDir } }
			});
			if (id === 'active') return send({ data: active });
			if (id) return sessions.has(id) ? send(metadata(id)) : send({}, 404);
			if (url.pathname === '/api/session' && req.method === 'POST') {
				sessions.add(body.id);
				return send(metadata(body.id));
			}
			if (url.pathname === '/tui/select-session') return send(true);
			if (url.pathname.endsWith('/permission')) return send({ data: permissions });
			if (url.pathname.endsWith('/question')) return send({ data: [] });
			if (req.method === 'POST') return void res.writeHead(204).end();
			send({}, 404);
		});
		await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
		const address = server.address();
		if (!address || typeof address === 'string') throw new Error('missing test address');
		port = address.port;
	});

	afterEach(async () => {
		const closed = new Promise<void>((resolve) => server.close(() => resolve()));
		server.closeAllConnections();
		await closed;
	});

	const connection = (extra: Record<string, unknown> = {}) => ({
		url: `http://127.0.0.1:${port}`,
		directory: firstmateDir,
		sessionId: SID,
		username: 'wheelhouse',
		password: 'private-test-password',
		...extra
	});
	/** An OpenCode session an earlier Wheelhouse started, with its private connection file. */
	const runningOpenCode = (
		file = path.join(sessionDir(), `opencode-${NONCE}.json`),
		value: Record<string, unknown> = connection()
	) => {
		mkdirSync(path.dirname(file), { recursive: true });
		writeFileSync(file, JSON.stringify(value), { mode: 0o600 });
		running = true;
		variables = { WHEELHOUSE_HARNESS: 'opencode', WH_OPENCODE_CONNECTION: file };
	};
	const posts = () =>
		requests.filter((r) => r.method === 'POST').map((r) => [r.path, r.body] as const);
	const permission = {
		id: 'per_first',
		sessionID: SID,
		action: 'shell.exec',
		resources: ['npm test']
	};

	it('starts it on its own port with a private connection file, then binds its chat', async () => {
		mkdirSync(stateDir, { recursive: true });
		writeFileSync(
			path.join(stateDir, 'primary-ports.json'),
			JSON.stringify({
				schema: 'wheelhouse-service-ports.v1',
				ports: { opencode: { project: null, port } }
			})
		);
		// The native TUI is ready once its input box is drawn.
		screen = '┃ ';
		const s = session('opencode');
		expect(await s.ensure()).toMatchObject({
			state: 'ours',
			harness: 'opencode',
			canSend: true,
			reason: null,
			skipPermissions: false
		});
		const spec = started()!;
		const file = spec.env.WH_OPENCODE_CONNECTION;
		expect(path.dirname(file)).toBe(sessionDir());
		expect(path.basename(file)).toMatch(/^opencode-[0-9a-f-]{36}\.json$/);
		expect(statSync(file).mode & 0o777).toBe(0o600);
		const saved = JSON.parse(readFileSync(file, 'utf8'));
		expect(saved).toMatchObject({
			url: `http://127.0.0.1:${port}`,
			directory: firstmateDir,
			sessionId: expect.stringMatching(/^ses_[0-9a-f]{32}$/),
			username: 'wheelhouse',
			password: expect.stringMatching(/^[0-9a-f]{64}$/)
		});
		expect(JSON.stringify(spec.argv)).not.toContain(saved.password);
		expect(spec.argv.slice(-2)).toEqual([file, '/opt/bin/opencode']);
		expect(posts()).toEqual([
			['/api/session', { id: saved.sessionId, location: { directory: firstmateDir } }],
			['/tui/select-session', { sessionID: saved.sessionId }]
		]);
		const auth = `Basic ${Buffer.from(`wheelhouse:${saved.password}`).toString('base64')}`;
		expect(requests.every((r) => r.auth === auth)).toBe(true);
		expect(typed()).toEqual([]);
	});

	it('finds its connection again after a Wheelhouse restart and reads its state over the API', async () => {
		runningOpenCode();
		active = { [SID]: { type: 'running' } };
		const s = session('opencode');
		expect(await s.status()).toMatchObject({
			state: 'ours',
			harness: 'opencode',
			canSend: true,
			reason: null,
			busy: true,
			picker: null,
			menu: null
		});
		permissions = [permission];
		active = {};
		expect(await s.status()).toMatchObject({
			busy: false,
			picker: {
				title: 'Allow shell.exec?\nnpm test',
				options: [{ label: 'Allow once' }, { label: 'Reject' }]
			}
		});
		expect(started()).toBeUndefined();
	});

	it.each([
		['no connection file', () => (variables.WH_OPENCODE_CONNECTION = '')],
		[
			'a file named as no launch names it',
			() => runningOpenCode(path.join(sessionDir(), 'connection.json'))
		],
		[
			'a file in another state directory',
			() => runningOpenCode(path.join(root, 'elsewhere', `opencode-${NONCE}.json`))
		],
		[
			'a connection to another checkout',
			() => {
				mkdirSync(path.join(root, 'other'));
				runningOpenCode(undefined, connection({ directory: path.join(root, 'other') }));
			}
		],
		[
			'a connection that is not loopback',
			() => runningOpenCode(undefined, connection({ url: 'http://example.com:4096' }))
		]
	])('keeps a session with %s in the drawer but blocks chat input', async (_, arrange) => {
		runningOpenCode();
		arrange();
		const s = session('opencode');
		expect(await s.status()).toMatchObject({
			state: 'ours',
			canSend: false,
			reason: expect.stringContaining('This opencode session predates chat integration'),
			menu: {
				title: 'OpenCode’s session API is not ready. Retry shortly or open its terminal.',
				canDismiss: false
			}
		});
		expect((await s.terminal()).ok).toBe(true);
		const restart = {
			ok: false,
			status: 409,
			error: 'Restart the OpenCode primary from Wheelhouse to enable chat.'
		};
		expect(await s.send('hello')).toEqual(restart);
		expect(await s.interrupt()).toEqual(restart);
		expect(await s.pick('any', { press: 1 })).toEqual(restart);
		expect(await s.picker()).toBeNull();
		expect(typed()).toEqual([]);
		expect(posts()).toEqual([]);
	});

	it('sends, stops and answers choices through its API, never by typing', async () => {
		runningOpenCode();
		const s = session('opencode');
		expect(await s.send('hello\r\nthere')).toEqual({ ok: true });
		expect(await s.interrupt()).toEqual({ ok: true });
		permissions = [permission];
		expect(await s.send('not while it asks')).toEqual({
			ok: false,
			status: 409,
			error: 'Answer OpenCode’s pending request before sending another message.'
		});
		const picker = await s.picker();
		if (!picker) throw new Error('missing OpenCode picker');
		expect(await s.pick('opencode:stale', { press: 1 })).toEqual({
			ok: false,
			status: 409,
			error: 'That OpenCode choice is no longer waiting for an answer.'
		});
		expect(await s.pick(picker.signature, { press: 1 })).toEqual({ ok: true });
		expect(posts()).toEqual([
			[
				`/api/session/${SID}/prompt`,
				{ id: expect.stringMatching(/^msg_/), prompt: { text: 'hello\nthere' }, delivery: 'steer' }
			],
			[`/api/session/${SID}/interrupt`, {}],
			[`/api/session/${SID}/permission/per_first/reply`, { reply: 'once' }]
		]);
		expect(typed()).toEqual([]);
	});

	it('leaves sign-in and closing menus to its terminal', async () => {
		runningOpenCode();
		const s = session('opencode');
		expect(await s.signIn('any', 'code')).toEqual({
			ok: false,
			status: 409,
			error: 'Sign in to OpenCode in its terminal.'
		});
		expect(await s.dismiss()).toEqual({
			ok: false,
			status: 409,
			error: 'Use the browser terminal to close this harness’s menus.'
		});
		expect(typed()).toEqual([]);
	});

	it('says its API is not ready while it is down, and that it waits in the terminal once that stays', async () => {
		runningOpenCode();
		const s = session('opencode');
		expect(await s.status()).toMatchObject({ canSend: true, menu: null });
		down = true;
		const title = 'OpenCode’s session API is not ready. Retry shortly or open its terminal.';
		now = 10;
		expect(await s.status()).toMatchObject({
			canSend: true,
			menu: { title, canDismiss: false },
			terminal: null
		});
		now = 1510;
		expect((await s.status()).terminal).toEqual({ excerpt: title });
		expect(await s.send('hello')).toMatchObject({ ok: false, status: 503 });
		down = false;
		const back = await s.status();
		expect(back.menu).toBeNull();
		expect(back.terminal ?? null).toBeNull();
	});
});
