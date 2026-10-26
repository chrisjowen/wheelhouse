import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it } from 'vitest';
import { ReviewService, type ReviewSubject } from './service';
import type { ReviewEvent, ReviewView } from '../../prreview';
import type { TaskSummary } from '../../types';

/**
 * The PR review service against a real git worktree, a brief in a fake
 * Firstmate home and a stub claude CLI (testdata/fake-claude.mjs).
 */

const FAKE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'testdata', 'fake-claude.mjs');
const GIT_ENV = {
	...process.env,
	GIT_AUTHOR_NAME: 'Test',
	GIT_AUTHOR_EMAIL: 't@example.com',
	GIT_COMMITTER_NAME: 'Test',
	GIT_COMMITTER_EMAIL: 't@example.com',
	GIT_CONFIG_GLOBAL: '/dev/null',
	GIT_CONFIG_NOSYSTEM: '1'
};

let root: string;
let wt: string;
let log: string;

const git = (...args: string[]) =>
	execFileSync('git', ['-C', wt, ...args], { env: GIT_ENV, encoding: 'utf8' });
const write = (rel: string, text: string) => {
	mkdirSync(path.dirname(path.join(wt, rel)), { recursive: true });
	writeFileSync(path.join(wt, rel), text);
};
const calls = () => {
	try {
		return readFileSync(log, 'utf8')
			.trim()
			.split('\n')
			.filter(Boolean)
			.map((l) => JSON.parse(l));
	} catch {
		return [];
	}
};

beforeEach(() => {
	root = mkdtempSync(path.join(tmpdir(), 'wh-review-'));
	wt = path.join(root, 'wt');
	log = path.join(root, 'claude.jsonl');
	mkdirSync(wt);
	execFileSync('git', ['init', '-q', '-b', 'main', wt], { env: GIT_ENV });
	write('src/greet.ts', "export function greet(name: string) {\n\treturn 'hi ' + name;\n}\n");
	write('package-lock.json', '{"version": "1.0.0"}\n');
	git('add', '.');
	git('commit', '-q', '-m', 'init');
	git('checkout', '-q', '-b', 'fm/greet');
	write(
		'src/greet.ts',
		"export function greet(name: string) {\n\tif (!name) throw new Error('name is required');\n\treturn `Hello, ${name}!`;\n}\n"
	);
	write('package-lock.json', '{"version": "1.0.1"}\n');
	git('commit', '-q', '-am', 'feat: friendlier greeting\n\nRefuse empty names, as the spec asks.');
	write('src/farewell.ts', 'export const bye = () => "bye";\n');
	git('add', '.');
	git('commit', '-q', '-m', 'feat: add farewell');
	const brief = path.join(root, 'home', 'data', 'greet', 'brief.md');
	mkdirSync(path.dirname(brief), { recursive: true });
	writeFileSync(
		brief,
		'# Task\n## Captain\'s intent\n"friendlier greetings"\n\n## Firstmate spec\n- Refuse an empty name.\n'
	);
});

const task = {
	id: 'greet',
	title: 'Friendlier greeting',
	branch: 'fm/greet',
	pr: { url: 'https://github.com/example/app/pull/7', number: 7 }
} as TaskSummary;

const subject = (): ReviewSubject => ({
	task,
	worktree: wt,
	files: { available: false, reason: 'not read' },
	records: async () => ({ build: null, decided: [] })
});

const service = (o: { mode?: string; off?: string | null; bin?: string; delay?: number } = {}) =>
	new ReviewService({
		homeDir: path.join(root, 'home'),
		stateDir: path.join(root, 'state'),
		env: {
			...process.env,
			FAKE_CLAUDE_LOG: log,
			FAKE_CLAUDE_MODE: o.mode ?? 'ok',
			FAKE_CLAUDE_DELAY: String(o.delay ?? 5)
		},
		useGh: false,
		agent: {
			bin: o.bin ?? FAKE,
			model: 'sonnet',
			effort: 'low',
			maxBudgetUsd: 1,
			timeoutMs: 20_000,
			off: o.off ?? null
		}
	});

const until = async (fn: () => boolean | Promise<boolean>, ms = 10_000) => {
	const end = Date.now() + ms;
	while (!(await fn())) {
		if (Date.now() > end) throw new Error('timed out');
		await new Promise((r) => setTimeout(r, 20));
	}
};

const ready = (v: ReviewView) => {
	if (!v.available) throw new Error(v.reason);
	return v;
};

describe('ReviewService', () => {
	it('shows the PR’s committed diff without running the agent', async () => {
		const s = service();
		const v = ready(await s.view(subject()));
		expect(v.head).toBe(git('rev-parse', 'HEAD').trim());
		expect(v.base).toBe('main');
		expect(v.files.map((f) => [f.path, f.status, f.boilerplate])).toEqual([
			['package-lock.json', 'M', 'lockfile'],
			['src/farewell.ts', 'A', null],
			['src/greet.ts', 'M', null]
		]);
		expect(v.guide).toBeNull();
		expect(v.runs).toEqual([]);
		expect(v.config).toMatchObject({ model: 'sonnet', effort: 'low', unavailable: null });
		expect(v.pr).toEqual({ url: task.pr!.url, number: 7, title: null });
		expect(calls()).toHaveLength(0);
	});

	it('writes the guide once per head, from the records, and keeps it across restarts', async () => {
		const s = service();
		const events: ReviewEvent[] = [];
		s.subscribe((e) => events.push(e));
		const started = await s.startGuide(subject(), {});
		expect(started).toMatchObject({ ok: true, run: { kind: 'guide', status: 'running' } });
		await until(async () => !!ready(await s.view(subject())).guide);
		const v = ready(await s.view(subject()));
		const g = v.guide!;
		expect(g.summary).toBe('Adds a greeting.');
		// The lockfile is boilerplate, so the agent ranks only the two source hunks.
		expect(g.items).toHaveLength(2);
		expect(g.items[0]).toMatchObject({ importance: 'key', basis: 'recorded', sources: ['I1'] });
		// A "recorded" why with no record behind it is shown as the agent's inference.
		expect(g.items[1]).toMatchObject({ basis: 'inferred', why: 'Not recorded: It looks tidier.' });
		expect(g.records.map((r) => r.label)).toEqual(['I1', 'S1', 'C1', 'C2']);
		expect(g.usage).toMatchObject({ costUsd: 0.0123, model: 'claude-sonnet-5' });
		expect(v.runs).toHaveLength(1);
		expect(v.runs[0].status).toBe('done');
		expect(events.map((e) => e.type)).toContain('guide');

		const prompt = calls()[0].input as string;
		expect(prompt).toContain('[I1] Captain’s intent\n"friendlier greetings"');
		expect(prompt).toContain('[C1] Commit');
		expect(prompt).toContain('Refuse empty names, as the spec asks.');
		expect(prompt).toContain('package-lock.json (lockfile, +1 −1)');
		expect(prompt).not.toContain('"version": "1.0.1"');

		// Asking again for the same head costs nothing.
		const again = await s.startGuide(subject(), {});
		expect(again).toMatchObject({ ok: true, run: null, guide: { runId: g.runId } });
		expect(calls()).toHaveLength(1);

		// A new Wheelhouse process reads the saved guide.
		const fresh = ready(await service().view(subject()));
		expect(fresh.guide?.runId).toBe(g.runId);
		expect(calls()).toHaveLength(1);
	});

	it('marks a guide for an older head as stale once the PR moves on', async () => {
		const s = service();
		await s.startGuide(subject(), {});
		await until(async () => !!ready(await s.view(subject())).guide);
		const old = ready(await s.view(subject())).head;
		write('src/farewell.ts', 'export const bye = () => "goodbye";\n');
		git('commit', '-q', '-am', 'fix: longer farewell');
		const v = ready(await service().view(subject()));
		expect(v.head).not.toBe(old);
		expect(v.guide).toBeNull();
		expect(v.staleGuide?.head).toBe(old);
	});

	it('answers a question about a hunk, streaming it, and keeps the thread', async () => {
		const s = service({ delay: 300 });
		const v = ready(await s.view(subject()));
		const hunk = v.files.find((f) => f.path === 'src/greet.ts')!.hunks[0];
		const texts: string[] = [];
		s.subscribe((e) => {
			if (e.type === 'text') texts.push(e.text);
		});
		const r = await s.ask(subject(), { question: 'Why throw on an empty name?', hunk: hunk.id });
		expect(r).toMatchObject({
			ok: true,
			run: { kind: 'ask', hunk: hunk.id, question: 'Why throw on an empty name?' }
		});
		await until(async () =>
			ready(await s.view(subject())).runs.every((x) => x.status !== 'running')
		);
		const done = ready(await s.view(subject())).runs[0];
		expect(done).toMatchObject({
			status: 'done',
			text: 'You asked: **Why throw on an empty name?**. The records say [I1].'
		});
		expect(done.usage?.costUsd).toBe(0.0123);
		// Text arrives while the answer is written, a growing prefix of it.
		expect(texts.length).toBeGreaterThan(0);
		expect(done.text.startsWith(texts[0])).toBe(true);
		const prompt = calls()[0].input as string;
		expect(prompt).toContain(`## The hunk the question is about\n[hunk ${hunk.id}] src/greet.ts`);
		const sys = calls()[0].args[calls()[0].args.indexOf('--system-prompt') + 1];
		expect(sys).toMatch(/cannot run tools or change anything/);
	});

	it('gives a focused review of the whole PR', async () => {
		const s = service();
		const r = await s.review(subject(), {});
		expect(r).toMatchObject({ ok: true, run: { kind: 'review', hunk: null } });
		await until(async () =>
			ready(await s.view(subject())).runs.every((x) => x.status !== 'running')
		);
		expect(ready(await s.view(subject())).runs[0].text).toBe('Looks right. No issues found.');
		expect(calls()[0].input).toContain('Review the whole pull request.');
	});

	it('refuses what it should not run', async () => {
		const s = service();
		expect(await s.ask(subject(), { question: '  ' })).toMatchObject({ ok: false, status: 400 });
		expect(await s.ask(subject(), { question: 'x', hunk: 'hdeadbeef00' })).toMatchObject({
			ok: false,
			status: 404
		});
		expect(await s.ask(subject(), { question: 'x', model: '--dangerously' })).toMatchObject({
			ok: false,
			status: 400
		});
		expect(await s.ask(subject(), { question: 'x', effort: 'huge' })).toMatchObject({
			ok: false,
			status: 400
		});
		const off = service({ off: 'The review agent is turned off.' });
		expect(await off.startGuide(subject(), {})).toMatchObject({ ok: false, status: 503 });
		const missing = service({ bin: '/nonexistent/claude' });
		expect((await missing.config()).unavailable).toMatch(/not on this machine/);
		expect(calls()).toHaveLength(0);
	});

	it('runs at most two at a time, and can stop one', async () => {
		const s = service({ mode: 'slow' });
		const a = await s.ask(subject(), { question: 'one' });
		const b = await s.ask(subject(), { question: 'two' });
		expect(a.ok && b.ok).toBe(true);
		expect(await s.review(subject(), {})).toMatchObject({ ok: false, status: 429 });
		if (!a.ok || !a.run || !b.ok || !b.run) throw new Error('not started');
		expect(s.stop('greet', a.run.id)).toBe(true);
		expect(s.stop('other', b.run.id)).toBe(false);
		s.stopAll();
		await until(() => s.runningCount() === 0);
		const runs = ready(await s.view(subject())).runs;
		expect(runs.map((r) => r.status)).toEqual(['stopped', 'stopped']);
	});

	it('says why a guide could not be read', async () => {
		const s = service({ mode: 'garbage' });
		await s.startGuide(subject(), {});
		await until(async () =>
			ready(await s.view(subject())).runs.every((x) => x.status !== 'running')
		);
		const v = ready(await s.view(subject()));
		expect(v.guide).toBeNull();
		expect(v.runs[0]).toMatchObject({
			status: 'failed',
			error: expect.stringMatching(/could not be read/)
		});
	});

	it('says when there is nothing to review', async () => {
		const s = service();
		const v = await s.view({ ...subject(), worktree: null, task: { ...task, pr: null } });
		expect(v).toMatchObject({ available: false, reason: expect.stringMatching(/no pull request/) });
	});
});
