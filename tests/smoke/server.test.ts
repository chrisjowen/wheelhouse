import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { request } from 'node:http';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
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
	// A steering message Firstmate sent wh-1, which the worker has read.
	const handled = path.join(fm.root, 'state', 'wh-1.inbox', 'handled');
	mkdirSync(handled, { recursive: true });
	writeFileSync(
		path.join(handled, '001.msg'),
		'schema=fm-task-inbox.v1\nat=2026-10-26T09:00:00Z\n--\nKeep the old route working until the next release.\n'
	);
	// Stands in for the running Firstmate session Wheelhouse shows; the fake's lock names it held.
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
				WHEELHOUSE_NM_EVIDENCE_DIR: path.join(fm.root, 'none'),
				// Never the machine's own run logs, transcripts or Claude limits.
				WHEELHOUSE_NM_LOGS_DIR: path.join(fm.root, 'none'),
				WHEELHOUSE_NO_USAGE: '1',
				// Any tmux call stays on a throwaway server, never the captain's or the crew's.
				TMUX: '',
				TMUX_TMPDIR: stateDir,
				WHEELHOUSE_TMUX_SOCKET: `wh-smoke-${process.pid}`
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

	it('shows Firstmate as already running elsewhere, and starts no second session', async () => {
		await waitFor(() => (output.includes('Firstmate:  ') ? true : undefined));
		expect(output).toContain('Firstmate:  Firstmate is running in another terminal');
		const tmux = spawnSync(
			'tmux',
			['-L', `wh-smoke-${process.pid}`, 'has-session', '-t', '=wh-firstmate'],
			{
				env: { ...process.env, TMUX: '', TMUX_TMPDIR: stateDir }
			}
		);
		expect(tmux.status).not.toBe(0);
	});

	it('renders the home page with the rail, and the Harbour and task pages', async () => {
		const home = await fetch(`${base}/`);
		expect(home.status).toBe(200);
		const homeHtml = await home.text();
		expect(homeHtml).toContain('aria-label="Firstmate"');
		expect(homeHtml).toContain('Waiting on you');
		expect(homeHtml).toContain('Pull request #7 is ready for your review.');
		const board = await fetch(`${base}/harbour`);
		expect(board.status).toBe(200);
		const harbourHtml = await board.text();
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

	it('checks a task’s preview before embedding it, and says when there is none', async () => {
		const r = await fetch(`${base}/api/tasks/wh-1/preview`);
		expect(r.status).toBe(200);
		expect(r.headers.get('cache-control')).toBe('no-store');
		expect(await r.json()).toMatchObject({ url: null, state: 'none' });
		expect((await fetch(`${base}/api/tasks/nope/preview`)).status).toBe(404);
	});

	it('shows the build: the conversation, the checks and the docs', async () => {
		const d = await (await fetch(`${base}/api/tasks/wh-1`)).json();
		expect(d.build.conversation).toMatchObject({
			available: true,
			value: [
				{
					kind: 'steer',
					from: 'firstmate',
					title: 'Keep the old route working until the next release.',
					outcome: { state: 'read' }
				}
			]
		});
		expect(d.build.checks.available).toBe(false);
		const html = await (await fetch(`${base}/tasks/wh-1?tab=talk`)).text();
		expect(html).toContain('Keep the old route working until the next release.');
		expect(html).toContain('id="tab-checks"');
		// The reader shows only a doc the task's list names.
		const doc = await fetch(`${base}/tasks/wh-1/doc?path=${encodeURIComponent('../secret.md')}`);
		expect(doc.status).toBe(200);
		expect(await doc.text()).toContain('This document cannot be shown');
	});

	it('renders the insight pages, reading no real usage or limits', async () => {
		const decisions = await fetch(`${base}/decisions`);
		expect(decisions.status).toBe(200);
		expect(await decisions.text()).toContain('Decided for you');
		const time = await fetch(`${base}/time`);
		expect(time.status).toBe(200);
		expect(await time.text()).toContain('Where time went');
		const headroom = await fetch(`${base}/headroom`);
		expect(headroom.status).toBe(200);
		const html = await headroom.text();
		expect(html).toContain('Reading Claude’s limits is turned off.');
		expect(html).toContain('Wheelhouse is not reading Claude Code’s transcripts.');
		const rail = await fetch(`${base}/api/insights`);
		expect(rail.status).toBe(200);
		expect(await rail.json()).toMatchObject({
			schema: 'wheelhouse-rail-insights.v1',
			allowance: { state: 'unavailable' }
		});
	});

	it('serves bounded worker output on request', async () => {
		const out = await (await fetch(`${base}/api/tasks/wh-1/output?lines=10`)).json();
		expect(out).toMatchObject({ available: true, lines: ['worker says hello'], requested: 10 });
		const queued = await (await fetch(`${base}/api/tasks/wh-2/output`)).json();
		expect(queued.available).toBe(false);
	});

	it('loads the compiled-in and bundled plugins and renders their slots', async () => {
		const plugins = await (await fetch(`${base}/api/plugins`)).json();
		expect(plugins.plugins).toEqual([
			expect.objectContaining({ id: 'docket', state: 'loaded', enabledWhenFile: '.docket.yaml' }),
			expect.objectContaining({
				id: 'improve',
				state: 'loaded',
				enabledWhenHomeFile: '.harness/improve.json'
			}),
			expect.objectContaining({
				id: 'project-links',
				state: 'loaded',
				source: 'builtin',
				repository: null,
				commit: null
			})
		]);
		// The project keeps no docket and the home no improve, so both stay off.
		expect(plugins.enabled.wheelhouse).toEqual(['project-links']);
		const fleet = await (await fetch(`${base}/api/slots`)).json();
		expect(fleet.entries.filter((e: { pluginId: string }) => e.pluginId === 'improve')).toEqual([]);
		const slots = await (await fetch(`${base}/api/slots?task=wh-1`)).json();
		expect(slots.entries.map((e: { slot: string }) => e.slot)).toContain('task.section');
		const taskHtml = await (await fetch(`${base}/tasks/wh-1`)).text();
		expect(taskHtml).toContain('data-slot="task.section"');
		expect(taskHtml.indexOf('data-slot="task.section"')).toBeGreaterThan(
			taskHtml.indexOf('id="passage"')
		);
		const card = (await (await fetch(`${base}/api/slots?project=wheelhouse`)).json()).entries.find(
			(e: { key: string }) => e.key === 'project-links/summary@wheelhouse'
		);
		expect(card).toMatchObject({ render: { element: 'project-links-summary' } });
		const bundle = await fetch(`${base}${card.ui}`);
		expect(bundle.status).toBe(200);
		expect(bundle.headers.get('content-type')).toContain('text/javascript');
		const tab = await fetch(`${base}/harbour?project=wheelhouse&tab=project-links%2Flinks`);
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

		it('serves the home page with this launch’s session token', async () => {
			const html = await (await fetch(`${base}/`)).text();
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

		it('streams the Firstmate session’s state for the chat', async () => {
			const ac = new AbortController();
			const res = await fetch(`${base}/api/firstmate/chat`, { signal: ac.signal });
			expect(res.headers.get('content-type')).toContain('text/event-stream');
			const reader = res.body!.getReader();
			let text = '';
			while (!text.includes('event: session'))
				text += new TextDecoder().decode((await reader.read()).value);
			ac.abort();
			const data = JSON.parse(/event: session\ndata: (.*)\n/.exec(text)![1]);
			expect(data).toMatchObject({ state: 'external', canSend: false });
		});

		it('offers Claude Code’s commands when Firstmate has none of its own', async () => {
			const { commands } = await (await fetch(`${base}/api/firstmate/commands`)).json();
			expect(commands.map((c: { name: string }) => c.name)).toEqual([
				'compact',
				'clear',
				'context'
			]);
		});

		it('guards typing into the session, and never types into one it does not own', async () => {
			const send = (
				path: string,
				headers: Record<string, string>,
				body: unknown = { text: 'hi' }
			) =>
				fetch(`${base}/api/firstmate/${path}`, {
					method: 'POST',
					headers: { 'content-type': 'application/json', ...headers },
					body: JSON.stringify(body)
				});
			for (const path of ['input', 'interrupt', 'pick', 'start']) {
				expect((await send(path, {})).status).toBe(403);
				expect((await send(path, { origin: base })).status).toBe(403);
				expect(
					(await send(path, { origin: 'http://evil.example', 'x-wheelhouse-session': token }))
						.status
				).toBe(403);
			}
			// Past the guard: Firstmate runs elsewhere (its lock is held), so nothing is typed or started.
			expect((await send('input', trusted())).status).toBe(409);
			expect((await send('interrupt', trusted())).status).toBe(409);
			expect((await send('pick', trusted(), { signature: 'x', press: 1 })).status).toBe(409);
			const started = await send('start', trusted());
			expect(started.status).toBe(200);
			expect((await started.json()).state).toBe('external');
		});

		it('guards Firstmate’s terminal on the WebSocket upgrade', async () => {
			const upgrade = (urlPath: string, protocols: string[], origin?: string) =>
				new Promise<number>((resolve) => {
					const ws = new WebSocket(`${base.replace('http', 'ws')}${urlPath}`, protocols, {
						...(origin ? { origin } : {})
					});
					ws.once('unexpected-response', (_req, res) => resolve(res.statusCode ?? 0));
					ws.once('open', () => {
						ws.close();
						resolve(101);
					});
					ws.once('error', () => resolve(-1));
				});
			const terminal = '/api/firstmate/terminal';
			const protocol = 'wheelhouse.terminal.v1';
			const withToken = [protocol, `wheelhouse.token.${token}`];
			expect(await upgrade(terminal, [protocol], base)).toBe(403);
			expect(await upgrade(terminal, [protocol, 'wheelhouse.token.nope'], base)).toBe(403);
			expect(await upgrade(terminal, withToken)).toBe(403);
			expect(await upgrade(terminal, withToken, 'http://evil.example')).toBe(403);
			// Past the guard, only the session Wheelhouse runs is attached to; this one runs elsewhere.
			expect(await upgrade(terminal, withToken, base)).toBe(409);
			// Nothing else upgrades.
			expect(await upgrade('/api/firstmate/chat', withToken, base)).toBe(404);
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

		it('keeps spec drafts and their pictures in its own state directory', async () => {
			expect(
				(await fetch(`${base}/api/specs`, { method: 'POST', headers: { origin: base } })).status
			).toBe(403);
			const created = await fetch(`${base}/api/specs`, { method: 'POST', headers: trusted() });
			expect(created.status).toBe(201);
			const { draft } = (await created.json()) as { draft: { id: string } };
			const put = await fetch(`${base}/api/specs/${draft.id}`, {
				method: 'PUT',
				headers: { ...trusted(), 'content-type': 'application/json' },
				body: JSON.stringify({ ...draft, title: 'Saved searches', requirements: ['Keeps filters'] })
			});
			expect(put.status).toBe(200);
			const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
			const img = await fetch(`${base}/api/specs/${draft.id}/images`, {
				method: 'POST',
				headers: { ...trusted(), 'content-type': 'image/png', 'x-caption': 'Filter%20bar' },
				body: png
			});
			const { draft: withImg } = (await img.json()) as {
				draft: { images: { name: string; caption: string }[] };
			};
			expect(withImg.images[0].caption).toBe('Filter bar');
			const served = await fetch(`${base}/api/specs/${draft.id}/images/${withImg.images[0].name}`);
			expect(served.headers.get('content-type')).toBe('image/png');
			const list = (await (await fetch(`${base}/api/specs`)).json()) as {
				specs: { title: string; filled: number }[];
			};
			expect(list.specs).toEqual([expect.objectContaining({ title: 'Saved searches', filled: 3 })]);
			expect(readdirSync(path.join(stateDir, 'specs'))).toContain(`${draft.id}.json`);
			const page = await (await fetch(`${base}/spec?id=${draft.id}`)).text();
			expect(page).toContain('Write a spec');
			expect(
				(await fetch(`${base}/api/specs/${draft.id}`, { method: 'DELETE', headers: trusted() }))
					.status
			).toBe(200);
			expect((await fetch(`${base}/api/specs/${draft.id}`)).status).toBe(404);
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
