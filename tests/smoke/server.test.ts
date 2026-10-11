import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { request } from 'node:http';
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
let stateDir: string;

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
	stateDir = mkdtempSync(path.join(tmpdir(), 'wh-smoke-state-'));
	writeFileSync(
		path.join(stateDir, 'plugins.json'),
		JSON.stringify({ plugins: { 'project-links': { projects: { wheelhouse: true } } } })
	);
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
		[
			CLI,
			'open',
			'--firstmate',
			fm.root,
			'--home',
			fm.root,
			'--port',
			'0',
			'--no-browser',
			'--state-dir',
			stateDir
		],
		{
			env: {
				...process.env,
				WHEELHOUSE_NO_GH: '1',
				// Project links is off by default; plugins.json turns it on for this project.
				WHEELHOUSE_CONFIG_DIR: stateDir,
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
	if (stateDir) rmSync(stateDir, { recursive: true, force: true });
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
		const harbourHtml = await home.text();
		expect(harbourHtml).toContain('Your move');
		// wh-1 waits on the captain's review with no screenshots or preview yet: said plainly.
		expect(harbourHtml).toContain('No screenshots saved');
		expect(harbourHtml).toContain('No live preview reported');
		const taskPage = await fetch(`${base}/tasks/wh-1`);
		expect(taskPage.status).toBe(200);
		const taskHtml = await taskPage.text();
		expect(taskHtml).toContain('Review evidence');
		expect(taskHtml).toContain('No screenshots saved');
		expect(taskHtml).toContain('No live preview reported');
		expect(taskHtml.indexOf('Review evidence')).toBeLessThan(taskHtml.indexOf('id="passage"'));
		expect((await fetch(`${base}/api/tasks/nope`)).status).toBe(404);
	});

	it('serves bounded worker output on request', async () => {
		const out = await (await fetch(`${base}/api/tasks/wh-1/output?lines=10`)).json();
		expect(out).toMatchObject({ available: true, lines: ['worker says hello'], requested: 10 });
		const queued = await (await fetch(`${base}/api/tasks/wh-2/output`)).json();
		expect(queued.available).toBe(false);
	});

	it('loads the compiled-in plugins and renders their slots', async () => {
		const plugins = await (await fetch(`${base}/api/plugins`)).json();
		expect(plugins.plugins).toEqual([
			expect.objectContaining({ id: 'project-links', state: 'loaded' })
		]);
		expect(plugins.enabled.wheelhouse).toEqual(['project-links']);
		const slots = await (await fetch(`${base}/api/slots?task=wh-1`)).json();
		expect(slots.entries.map((e: { slot: string }) => e.slot)).toContain('task.section');
		const taskHtml = await (await fetch(`${base}/tasks/wh-1`)).text();
		expect(taskHtml).toContain('data-slot="task.section"');
		expect(taskHtml.indexOf('data-slot="task.section"')).toBeGreaterThan(
			taskHtml.indexOf('id="passage"')
		);
		const tab = await fetch(`${base}/?project=wheelhouse&tab=project-links%2Flinks`);
		expect(tab.status).toBe(200);
		expect(await tab.text()).toContain('data-slot="project.tab"');
		expect((await fetch(`${base}/api/slots?task=a&project=b`)).status).toBe(400);
	});

	it('serves one changed file’s diff, honestly unavailable without a worktree', async () => {
		expect((await fetch(`${base}/api/tasks/wh-1/diff`)).status).toBe(400);
		expect((await fetch(`${base}/api/tasks/nope/diff?path=a.txt`)).status).toBe(404);
		const res = await fetch(`${base}/api/tasks/wh-1/diff?path=${encodeURIComponent('../x')}`);
		expect(res.status).toBe(200);
		expect(res.headers.get('cache-control')).toBe('no-store');
		const d = await res.json();
		expect(d.available).toBe(false);
		expect(d.reason).toMatch(/worktree is gone/);
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

	it('refuses requests addressed to a foreign host (DNS rebinding)', async () => {
		const status = (host: string) =>
			new Promise<number | undefined>((resolve, reject) => {
				const req = request(`${base}/api/fleet`, { headers: { host } }, (res) => {
					res.resume();
					resolve(res.statusCode);
				});
				req.on('error', reject);
				req.end();
			});
		const port = new URL(base).port;
		expect(await status(`evil.example:${port}`)).toBe(421);
		expect(await status(`localhost:${port}`)).toBe(200);
	});

	describe('talking to Firstmate', () => {
		let token = '';
		const post = (key: string | null, body: unknown, headers: Record<string, string> = {}) =>
			fetch(`${base}/api/firstmate/messages`, {
				method: 'POST',
				headers: {
					'content-type': 'application/json',
					...(key ? { 'idempotency-key': key } : {}),
					...headers
				},
				body: JSON.stringify(body)
			});
		const trusted = () => ({ origin: base, 'x-wheelhouse-session': token });

		it('serves the Bridge with this launch’s session token', async () => {
			const res = await fetch(`${base}/bridge?task=wh-1`);
			expect(res.status).toBe(200);
			const html = await res.text();
			expect(html).toContain('Talk to Firstmate');
			token = /sessionToken:"([A-Za-z0-9_-]+)"/.exec(html)?.[1] ?? '';
			expect(token).toHaveLength(43);
			const health = await (await fetch(`${base}/api/health`)).json();
			expect(health.messaging).toMatchObject({ available: true });
			expect(health.messaging.store.startsWith(stateDir)).toBe(true);
		});

		it('refuses a send without the served Origin or the session token', async () => {
			const msg = { text: 'should not arrive' };
			expect((await post('wh-smoke-x', msg)).status).toBe(403);
			expect((await post('wh-smoke-x', msg, { origin: 'http://evil.example' })).status).toBe(403);
			expect((await post('wh-smoke-x', msg, { origin: base })).status).toBe(403);
			expect(
				(await post('wh-smoke-x', msg, { origin: base, 'x-wheelhouse-session': 'nope' })).status
			).toBe(403);
			expect(fm.notes()).toHaveLength(0);
		});

		it('sends once per request id, with task context as a body prefix', async () => {
			const msg = { text: 'What is left before this can land?', taskId: 'wh-1' };
			const first = await post('wh-smoke-1', msg, trusted());
			expect(first.status).toBe(201);
			const a = await first.json();
			expect(a).toMatchObject({
				replay: false,
				message: { delivery: 'delivered', taskId: 'wh-1' }
			});
			const again = await post('wh-smoke-1', msg, trusted());
			expect(again.status).toBe(200);
			const b = await again.json();
			expect(b).toMatchObject({ replay: true, message: { noteId: a.message.noteId } });
			expect(fm.notes().map((n) => n.body)).toEqual([
				'Re: wh-1\nWhat is left before this can land?'
			]);
			expect((await post('wh-smoke-1', { text: 'different' }, trusted())).status).toBe(422);
			expect((await post(null, msg, trusted())).status).toBe(400);
		});

		it('shows acknowledgement and Firstmate’s recorded reply from its receipts', async () => {
			const noteId = fm.notes()[0].id;
			fm.ack(noteId);
			fm.reply(noteId, 'One fixture left. PR: https://github.com/o/r/pull/7');
			const view = await waitFor(async () => {
				const v = await (await fetch(`${base}/api/firstmate/messages`)).json();
				return v.messages[0]?.reply ? v : undefined;
			});
			expect(view.messages).toEqual([
				expect.objectContaining({
					requestId: 'wh-smoke-1',
					delivery: 'delivered',
					acknowledged: true,
					reply: expect.objectContaining({
						body: 'One fixture left. PR: https://github.com/o/r/pull/7'
					})
				})
			]);
			const stored = readdirSync(path.join(stateDir, 'homes'));
			expect(stored).toHaveLength(1);
			const record = JSON.parse(
				readFileSync(path.join(stateDir, 'homes', stored[0], 'messages.json'), 'utf8')
			);
			expect(record).toMatchObject({ home: fm.root, receiptCursor: '000000000001' });
		});

		it('streams messages over SSE', async () => {
			const ac = new AbortController();
			const res = await fetch(`${base}/api/events`, { signal: ac.signal });
			const reader = res.body!.getReader();
			let text = '';
			while (!text.includes('event: messages'))
				text += new TextDecoder().decode((await reader.read()).value);
			ac.abort();
			expect(text).toContain('wh-smoke-1');
		});
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
