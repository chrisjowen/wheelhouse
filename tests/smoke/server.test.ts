import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
	backlogRow,
	createFakeFirstmate,
	snapshotFixture,
	taskRow,
	type FakeFirstmate
} from '../helpers/fake-firstmate';

/**
 * Starts the built `wheelhouse open` CLI against a fake Firstmate home and
 * checks that the server comes up, reads Firstmate through its scripts, serves
 * the UI and API, and shuts down without touching Firstmate.
 * Requires `npm run build` first (`npm run test:smoke` does that).
 */

const CLI = path.resolve('dist/cli.js');
let fm: FakeFirstmate;
let cli: ChildProcess;
let output = '';
let base = '';
let firstmateSession: ChildProcess;

async function waitFor<T>(
	fn: () => T | undefined | Promise<T | undefined>,
	ms = 20_000
): Promise<T> {
	const end = Date.now() + ms;
	for (;;) {
		const v = await fn();
		if (v !== undefined) return v;
		if (Date.now() > end) throw new Error(`timed out; CLI output:\n${output}`);
		await new Promise((r) => setTimeout(r, 100));
	}
}

beforeAll(async () => {
	if (!existsSync(CLI) || !existsSync(path.resolve('build/handler.js'))) {
		throw new Error('Run `npm run build` before the smoke test (or use `npm run test:smoke`).');
	}
	fm = createFakeFirstmate();
	fm.set(
		'snapshot.json',
		snapshotFixture(
			{
				tasks: [taskRow({ id: 'wh-1', state: 'done', pr: 'https://github.com/o/r/pull/7' })],
				backlog: { present: true, records: [backlogRow('wh-2', 'queued')] }
			},
			fm.root
		)
	);
	fm.set('peek.txt', 'worker says hello\n');
	// Stands in for the running Firstmate session Wheelhouse attaches to.
	firstmateSession = spawn('sleep', ['120'], { stdio: 'ignore' });

	cli = spawn(
		process.execPath,
		[CLI, 'open', '--firstmate', fm.root, '--home', fm.root, '--port', '0', '--no-browser'],
		{
			env: {
				...process.env,
				WHEELHOUSE_NO_GH: '1',
				WHEELHOUSE_NM_EVIDENCE_DIR: path.join(fm.root, 'none')
			}
		}
	);
	cli.stdout?.on('data', (d) => (output += d));
	cli.stderr?.on('data', (d) => (output += d));
	base = await waitFor(() => /listening on (http:\/\/127\.0\.0\.1:\d+)\//.exec(output)?.[1]);
});

afterAll(() => {
	cli?.kill('SIGKILL');
	firstmateSession?.kill('SIGKILL');
	fm?.cleanup();
});

describe('wheelhouse open', () => {
	it('binds to loopback and reports compatibility in /api/health', async () => {
		expect(base).toMatch(/^http:\/\/127\.0\.0\.1:/);
		expect(output).toContain('Scripts:    compatible');
		const health = await waitFor(async () => {
			const h = await (await fetch(`${base}/api/health`)).json();
			return h.supervisor.available ? h : undefined;
		});
		expect(health.firstmate).toMatchObject({ compatible: true, home: fm.root });
		expect(health.supervisor.onWatch).toBe(true);
	});

	it('serves the fleet read through fm-fleet-snapshot.sh', async () => {
		const fleet = await waitFor(async () => {
			const f = await (await fetch(`${base}/api/fleet`)).json();
			return f.tasks.length ? f : undefined;
		});
		expect(fleet.stale).toBe(false);
		expect(fleet.tasks.find((t: { id: string }) => t.id === 'wh-1').status).toBe('needs-review');
		expect(fleet.tasks.find((t: { id: string }) => t.id === 'wh-2').status).toBe('queued');
	});

	it('renders the Harbour and task pages', async () => {
		const home = await fetch(`${base}/`);
		expect(home.status).toBe(200);
		expect(await home.text()).toContain('Your move');
		expect((await fetch(`${base}/tasks/wh-1`)).status).toBe(200);
		expect((await fetch(`${base}/api/tasks/nope`)).status).toBe(404);
	});

	it('serves bounded worker output on request', async () => {
		const out = await (await fetch(`${base}/api/tasks/wh-1/output?lines=10`)).json();
		expect(out).toMatchObject({ available: true, lines: ['worker says hello'], requested: 10 });
		const queued = await (await fetch(`${base}/api/tasks/wh-2/output`)).json();
		expect(queued.available).toBe(false);
	});

	it('streams fleet and health over SSE', async () => {
		const ac = new AbortController();
		const res = await fetch(`${base}/api/events`, { signal: ac.signal });
		expect(res.headers.get('content-type')).toContain('text/event-stream');
		const reader = res.body!.getReader();
		let text = '';
		while (!text.includes('event: health'))
			text += new TextDecoder().decode((await reader.read()).value);
		ac.abort();
		expect(text).toContain('event: fleet');
	});

	it('closes cleanly, writes nothing to Firstmate, and leaves Firstmate running', async () => {
		const stateBefore = readdirSync(path.join(fm.root, 'state'));
		const exited = new Promise<number | null>((r) => cli.once('exit', (code) => r(code)));
		cli.kill('SIGTERM');
		expect(await exited).toBe(0);
		expect(output).toContain('Firstmate and its crew are still running');
		expect(readdirSync(path.join(fm.root, 'state'))).toEqual(stateBefore);
		expect(firstmateSession.exitCode).toBeNull();
		expect(firstmateSession.signalCode).toBeNull();
	});
});
