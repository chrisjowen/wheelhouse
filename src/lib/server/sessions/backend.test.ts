import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fakeHerdr } from '../../../../tests/helpers/fake-herdr';
import type { RunResult } from '../firstmate/exec';
import type { SessionBackend, SessionKey } from './backend';
import { HerdrBackend } from './herdr';
import { FIRSTMATE_TMUX, TmuxBackend, type Run } from './tmux';

/**
 * The SessionBackend contract, driven the same way for every backend over a
 * stand-in for its program (never a real tmux or herdr): what one backend's
 * session does, as FirstmateSession sees it, the other's must do too.
 */

interface Harness {
	backend: SessionBackend;
	/** Put text on the session's screen. */
	show: (text: string) => void;
	/** What the session received: pasted text and pressed keys, in order. */
	received: () => (string | { key: string })[];
	/** The session's process ends. */
	end: () => void;
}

const ok = (stdout = ''): RunResult => ({ ok: true, stdout, stderr: '', durationMs: 1 });
const fail = (stderr: string): RunResult => ({
	ok: false,
	kind: 'exit',
	code: 1,
	signal: null,
	stdout: '',
	stderr,
	message: 'exited with code 1',
	durationMs: 1
});

/** A tmux server in memory with at most the one Firstmate session. */
function tmux(): Harness {
	let live = false;
	let screen = '';
	let env: Record<string, string> = {};
	const received: (string | { key: string })[] = [];
	let buffer = '';
	const run: Run = async (_file, all, opts) => {
		const args = all.slice(2);
		switch (args[0]) {
			case 'list-sessions':
				return live ? ok(`${FIRSTMATE_TMUX}\n`) : fail('no server running on /tmp/x');
			case 'new-session':
				live = true;
				env = Object.fromEntries(
					args
						.filter((_, i) => args[i - 1] === '-e')
						.map((kv) => [kv.slice(0, kv.indexOf('=')), kv.slice(kv.indexOf('=') + 1)])
				);
				return ok();
			case 'show-environment':
				return args[3] in env ? ok(`${args[3]}=${env[args[3]]}\n`) : fail('unknown variable');
			case 'capture-pane':
				return live ? ok(screen) : fail("can't find session");
			case 'load-buffer':
				buffer = opts.input ?? '';
				return ok();
			case 'paste-buffer':
				received.push(buffer);
				return ok();
			case 'send-keys':
				received.push({ key: args[3] });
				return ok();
		}
		return ok();
	};
	return {
		backend: new TmuxBackend({ socket: 'wh-test', env: {}, find: () => '/opt/bin/tmux', run }),
		show: (text) => (screen = text),
		received: () => received,
		end: () => (live = false)
	};
}

let dir: string;
beforeEach(() => (dir = realpathSync(mkdtempSync(path.join(tmpdir(), 'wh-backend-')))));
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function herdr(): Harness {
	const fake = fakeHerdr('wh-test');
	const pane = () => [...fake.state.panes.values()][0];
	return {
		backend: new HerdrBackend({
			session: 'wh-test',
			recordFile: path.join(dir, 'herdr-session.json'),
			env: {},
			find: (n) => (n === 'herdr' ? '/opt/bin/herdr' : '/usr/bin/env'),
			run: fake.run,
			spawnServer: fake.spawnServer,
			sleep: async () => {}
		}),
		show: (text) => (pane().screen = text),
		// herdr receives the paste with its bracketed-paste markers; tmux adds them itself (paste-buffer -p).
		received: () => [
			...(pane()?.text.map((t) => t.split('\x1b[200~').join('').split('\x1b[201~').join('')) ?? []),
			...(pane()?.keys.map((key) => ({ key })) ?? [])
		],
		end: () => fake.exit([...fake.state.panes.keys()][0])
	};
}

describe.each([
	['tmux', tmux],
	['herdr', herdr]
])('the %s backend, through the SessionBackend interface', (_name, make) => {
	const spec = { cwd: '/fm', argv: ['/opt/bin/claude'], env: { WHEELHOUSE_HARNESS: 'codex' } };

	it('is not running until started, and then is', async () => {
		const { backend } = make();
		expect(backend.unavailable()).toBeNull();
		expect(await backend.running()).toBe(false);
		expect(await backend.start(spec)).toEqual({ ok: true });
		expect(await backend.running()).toBe(true);
	});

	it('reads back the variables the session was launched with', async () => {
		const { backend } = make();
		await backend.start(spec);
		expect(await backend.running()).toBe(true);
		expect(await backend.variable('WHEELHOUSE_HARNESS')).toBe('codex');
		expect(await backend.variable('WH_SESSION_NONCE')).toBe('');
	});

	it('shows the screen, takes a multi-line paste as one message, and presses keys', async () => {
		const h = make();
		await h.backend.start(spec);
		h.show('❯ ready\n');
		expect(await h.backend.screen()).toBe('❯ ready\n');
		expect(await h.backend.paste('one\ntwo')).toEqual({ ok: true });
		for (const key of ['Enter', 'Escape', 'Down', '2'] as SessionKey[]) {
			expect(await h.backend.key(key)).toEqual({ ok: true });
		}
		expect(h.received()).toEqual([
			'one\ntwo',
			{ key: 'Enter' },
			{ key: 'Escape' },
			{ key: 'Down' },
			{ key: '2' }
		]);
	});

	it('is not running once the session’s process ends', async () => {
		const h = make();
		await h.backend.start(spec);
		h.end();
		expect(await h.backend.running()).toBe(false);
	});

	it('names an attach command and a hint', () => {
		const { backend } = make();
		expect(backend.attach().argv.length).toBeGreaterThan(1);
		expect(backend.attachHint()).toMatch(/\S/);
	});
});
