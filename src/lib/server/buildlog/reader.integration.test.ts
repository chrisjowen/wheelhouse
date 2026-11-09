import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BuildReader, type BuildContext } from './reader';
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
	rounds: [],
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
	it('reads a long doc from the project’s clone once the worktree is gone, cut short', async () => {
		const repo = path.join(root, 'clone');
		mkdirSync(path.join(repo, 'docs'), { recursive: true });
		writeFileSync(
			path.join(repo, 'docs', 'guide.md'),
			'# The Wheelhouse guide\n\n' + 'A line of the guide.\n'.repeat(40_000)
		);
		const git = (...a: string[]) =>
			execFileSync('git', ['-C', repo, '-c', 'user.name=t', '-c', 'user.email=t@t', ...a]);
		git('init', '-q');
		git('add', '.');
		git('commit', '-qm', 'guide');
		const files = ctx().files;
		if (!files.available) throw new Error('fixture');
		const gone = ctx({
			worktree: null,
			projectDir: repo,
			files: {
				...files,
				value: {
					...files.value,
					files: [{ path: 'docs/guide.md', status: 'M', additions: 1, deletions: 0 }]
				}
			}
		});
		const r = reader();
		const v = await r.insight(gone);
		expect(v.docs.available && v.docs.value.map((d) => d.title)).toEqual(['The Wheelhouse guide']);
		const doc = await r.doc(gone, 'docs/guide.md');
		expect(doc).toMatchObject({ available: true, value: { truncated: true } });
		expect(doc.available && doc.value.markdown.startsWith('# The Wheelhouse guide')).toBe(true);
	});
});
