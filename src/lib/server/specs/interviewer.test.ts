import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Interviewer, interviewerSettings, type TurnEvent } from './interviewer';
import { SpecStore } from './store';

const FAKE = path.resolve('tests/helpers/fake-claude.mjs');

let root: string;
let store: SpecStore;
let argsFile: string;

beforeEach(async () => {
	root = await mkdtemp(path.join(tmpdir(), 'wh-interview-'));
	store = new SpecStore(path.join(root, 'specs'));
	argsFile = path.join(root, 'args.jsonl');
});
afterEach(async () => {
	await rm(root, { recursive: true, force: true });
});

const interviewer = (projectPath: (p: string) => Promise<string | null> = async () => null) =>
	new Interviewer(store, {
		settings: { bin: FAKE, model: 'sonnet', effort: 'low' },
		skillDirs: [path.join(root, 'no-skills')],
		projectPath,
		env: { ...process.env, FAKE_CLAUDE_ARGS_FILE: argsFile },
		timeoutMs: 20_000
	});

const lastArgs = async () =>
	JSON.parse((await readFile(argsFile, 'utf8')).trim().split('\n').pop()!) as string[];

describe('interviewerSettings', () => {
	it('defaults to a mid model at low effort, and takes the CLI’s settings', () => {
		expect(interviewerSettings({})).toEqual({ bin: 'claude', model: 'sonnet', effort: 'low' });
		expect(
			interviewerSettings({
				WHEELHOUSE_CLAUDE_BIN: '/bin/c',
				WHEELHOUSE_SPEC_MODEL: 'opus',
				WHEELHOUSE_SPEC_EFFORT: 'high'
			})
		).toEqual({ bin: '/bin/c', model: 'opus', effort: 'high' });
		expect(interviewerSettings({ WHEELHOUSE_SPEC_EFFORT: 'max!' }).effort).toBe('low');
	});
});

describe('Interviewer', () => {
	it('records the answer, streams the question without the JSON, and saves the spec', async () => {
		const d = await store.create();
		const events: TurnEvent[] = [];
		const r = await interviewer().turn(d.id, 'Let a family share trip photos', (e) =>
			events.push(e)
		);
		expect(r.ok).toBe(true);
		if (!r.ok) return;
		const streamed = events
			.filter((e) => e.type === 'text')
			.map((e) => (e as { text: string }).text)
			.join('');
		expect(streamed).toContain('Who should be able to add photos?');
		expect(streamed).not.toContain('===SPEC===');
		expect(r.draft.title).toBe('Shared trip albums');
		expect(r.draft.interview.turns.map((t) => t.role)).toEqual(['captain', 'agent']);
		const agent = r.draft.interview.turns[1];
		expect(agent.options).toHaveLength(3);
		expect(agent.recommended).toBe(2);
		expect(agent.changed).toEqual(['project', 'problem']);
		expect(r.draft.interview.usage).toEqual({
			turns: 1,
			inputTokens: 2000,
			outputTokens: 150,
			costUsd: 0.0123
		});
		expect(await store.get(d.id)).toEqual(r.draft);
		// No project checkout known: no tools at all.
		const args = await lastArgs();
		expect(args[args.indexOf('--tools') + 1]).toBe('');
	});

	it('lets the agent read the project’s checkout, read-only, when it has one', async () => {
		const repo = path.join(root, 'repo');
		await mkdir(repo);
		const d = await store.create();
		await store.save(d.id, { ...d, project: 'photo-library' });
		const r = await interviewer(async (p) => (p === 'photo-library' ? repo : null)).turn(
			d.id,
			'Albums'
		);
		expect(r.ok).toBe(true);
		const args = await lastArgs();
		expect(args[args.indexOf('--tools') + 1]).toBe('Read,Grep,Glob');
	});

	it('addresses open comments and marks them resolved', async () => {
		const d = await store.create();
		const iv = interviewer();
		await iv.turn(d.id, 'Albums');
		await store.addComment(d.id, { section: 'requirements', quote: '', text: 'Works offline' });
		const r = await iv.turn(d.id, null);
		expect(r.ok).toBe(true);
		if (!r.ok) return;
		expect(r.draft.requirements).toContain('Works offline');
		expect(r.draft.comments[0].resolvedAt).not.toBeNull();
		expect(r.draft.comments[0].reply).toMatch(/Works offline/);
		expect(r.draft.interview.turns.at(-1)?.changed).toContain('requirements');
	});

	it('keeps the captain’s answer when the agent fails, so the turn can be tried again', async () => {
		const d = await store.create();
		const r = await interviewer().turn(d.id, 'FAKE_CLAUDE_FAIL please');
		expect(r).toMatchObject({ ok: false, status: 502, message: /Invalid API key/ });
		const saved = await store.get(d.id);
		expect(saved?.interview.turns.map((t) => t.text)).toEqual(['FAKE_CLAUDE_FAIL please']);
	});

	it('runs one turn per spec at a time', async () => {
		const d = await store.create();
		const iv = new Interviewer(store, {
			settings: { bin: FAKE, model: 'sonnet', effort: 'low' },
			skillDirs: [],
			env: { ...process.env, FAKE_CLAUDE_DELAY_MS: '20' },
			timeoutMs: 20_000
		});
		const first = iv.turn(d.id, 'Albums');
		expect(iv.isBusy(d.id)).toBe(true);
		expect(await iv.turn(d.id, 'Again')).toMatchObject({ ok: false, status: 409 });
		expect((await first).ok).toBe(true);
		expect(iv.isBusy(d.id)).toBe(false);
	});

	it('needs something to start from', async () => {
		const d = await store.create();
		expect(await interviewer().turn(d.id, '  ')).toMatchObject({ ok: false, status: 400 });
		expect(await interviewer().turn('spec-missing1', 'x')).toMatchObject({
			ok: false,
			status: 404
		});
	});
});
