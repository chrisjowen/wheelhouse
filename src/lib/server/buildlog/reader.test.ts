import { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BuildReader, buildHint, transcriptDirName, type BuildContext } from './reader';
import type { EvidenceReader } from '../firstmate/evidence';
import type { TaskSummary } from '../../types';

const RUN = '01JDABCDEFGHJKMNPQRSTVWXYZ';
let root: string;
let home: string;
let logs: string;
let projects: string;
let wt: string;
let clock = 1_000_000;

const evidence = { pipeline: async () => null } as unknown as EvidenceReader;

beforeEach(() => {
	root = mkdtempSync(path.join(tmpdir(), 'wh-buildlog-'));
	home = path.join(root, 'fm');
	logs = path.join(root, 'logs');
	projects = path.join(root, 'projects');
	wt = path.join(root, 'trees', 'share');
	mkdirSync(path.join(wt, 'docs', 'adr'), { recursive: true });
	writeFileSync(
		path.join(wt, 'docs', 'adr', '0004-tokens.md'),
		'# Share links use 12-byte tokens\n\nBody.\n'
	);
	writeFileSync(path.join(wt, 'docs', 'sharing.md'), '# Sharing\n');
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const task = {
	id: 'share',
	status: 'working',
	branch: 'fm/share',
	pr: null
} as unknown as TaskSummary;
const ctx = (over: Partial<BuildContext> = {}): BuildContext => ({
	task,
	ledger: null,
	worktree: wt,
	projectDir: null,
	runs: [RUN],
	decided: [],
	captain: [],
	files: {
		available: true,
		source: 's',
		observedAt: null,
		value: {
			base: 'origin/main',
			mergeBase: 'abc',
			branch: 'fm/share',
			files: [
				{ path: 'docs/adr/0004-tokens.md', status: 'A', additions: 9, deletions: 0 },
				{ path: 'src/links.ts', status: 'M', additions: 3, deletions: 1 }
			],
			total: 2,
			truncated: false
		}
	},
	...over
});
const reader = () =>
	new BuildReader({
		homeDir: home,
		evidence,
		logsDir: logs,
		claudeProjectsDir: projects,
		useGh: false,
		now: () => (clock += 20_000)
	});

describe('build reader', () => {
	it('reads the inbox, the run’s step logs and the docs a session opened', async () => {
		const inbox = path.join(home, 'state', 'share.inbox');
		mkdirSync(path.join(inbox, 'handled'), { recursive: true });
		writeFileSync(
			path.join(inbox, 'handled', '001.msg'),
			'schema=fm-task-inbox.v1\nat=2026-10-26T09:00:00Z\n--\nUse 12 bytes.\n'
		);
		writeFileSync(
			path.join(inbox, '002.msg'),
			'schema=fm-task-inbox.v1\nat=2026-10-26T09:05:00Z\n--\nAlso update the guide.\n'
		);
		mkdirSync(path.join(logs, RUN), { recursive: true });
		writeFileSync(path.join(logs, RUN, 'intent.log'), 'intent step\n');
		writeFileSync(
			path.join(logs, RUN, 'test.log'),
			' Test Files  1 passed (1)\n      Tests  6 passed (6)\n'
		);
		const tdir = path.join(projects, transcriptDirName(wt));
		mkdirSync(tdir, { recursive: true });
		const line = (name: string, file: string) =>
			JSON.stringify({
				gitBranch: 'fm/share',
				message: {
					content: [{ type: 'tool_use', name, input: { file_path: path.join(wt, file) } }]
				}
			}) + '\n';
		const transcript = path.join(tdir, 'a.jsonl');
		writeFileSync(transcript, line('Read', 'docs/sharing.md'));

		const r = reader();
		const first = await r.insight(ctx());
		expect(
			first.conversation.available && first.conversation.value.map((e) => e.outcome.state)
		).toEqual(['read', 'unread']);
		expect(
			first.checks.available && first.checks.value.steps.find((s) => s.key === 'test')?.summary
		).toBe('All 6 tests passed');
		expect(
			first.docs.available && first.docs.value.map((d) => [d.title, d.changed, d.read])
		).toEqual([
			['Share links use 12-byte tokens', true, false],
			['Sharing', false, true]
		]);

		// The transcript grows: only the new lines are read, and what was found before is kept.
		appendFileSync(transcript, line('Edit', 'docs/sharing.md'));
		const next = await r.insight(ctx());
		expect(next.docs.available && next.docs.value.find((d) => d.title === 'Sharing')).toMatchObject(
			{
				changed: true,
				read: true
			}
		);

		const doc = await r.doc(ctx(), 'docs/adr/0004-tokens.md');
		expect(doc).toMatchObject({
			available: true,
			value: { kind: 'decision', title: 'Share links use 12-byte tokens' }
		});
		expect(await r.doc(ctx(), '../../etc/passwd.md')).toMatchObject({ available: false });
		expect(await r.doc(ctx(), 'src/links.ts')).toMatchObject({ available: false });
	});

	it('says plainly when no validation run is known yet', async () => {
		const v = await reader().insight(ctx({ runs: [] }));
		expect(v.checks).toMatchObject({ available: false });
	});
});

describe('card hint', () => {
	it('counts questions and docs, and is null when there is neither', () => {
		expect(buildHint(null, 0)).toBeNull();
		expect(buildHint(null, 2)).toEqual({ questions: 0, open: 0, docs: 2 });
	});
});
