import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LedgerReader } from '../firstmate/ledger';
import { InsightsService, type TaskMeta } from './service';

// A synthetic Firstmate home, no-mistakes logs and transcripts in a temp dir.
const RUN = '01DDDDDDDDDDDDDDDDDDDDDDDD';
const OTHER_RUN = '01EEEEEEEEEEEEEEEEEEEEEEEE';
const T = Math.floor(Date.now() / 1000) - 3600;

let root: string;
let home: string;
let logs: string;

function ledger(lines: object[]) {
	const r = new LedgerReader(path.join(root, 'none.jsonl'));
	for (const l of lines) r.ingest(JSON.stringify({ v: 1, ...l }));
	return r.state().tasks;
}

function service(over: Partial<ConstructorParameters<typeof InsightsService>[0]> = {}) {
	return new InsightsService({
		homeDir: home,
		firstmateDir: path.join(root, 'fm'),
		logsDir: logs,
		nmWorktreesDir: path.join(root, 'nm-worktrees'),
		claudeProjectsDir: path.join(root, 'claude'),
		readQuota: async () => ({
			ok: true,
			stdout: JSON.stringify({
				providers: [{ provider: 'claude', windows: [], state: { status: 'auth_required' } }]
			})
		}),
		...over
	});
}

const meta = (live: boolean): Map<string, TaskMeta> =>
	new Map([['alpha', { title: 'Alpha feature', projectId: 'demo', kind: 'ship', live }]]);

beforeEach(() => {
	root = mkdtempSync(path.join(tmpdir(), 'wh-insights-'));
	home = path.join(root, 'home');
	logs = path.join(root, 'logs');
	mkdirSync(path.join(home, 'data', 'alpha'), { recursive: true });
	mkdirSync(path.join(home, 'state', 'alpha.inbox', 'handled'), { recursive: true });
	mkdirSync(path.join(logs, OTHER_RUN), { recursive: true });
	writeFileSync(
		path.join(logs, OTHER_RUN, 'rebase.log'),
		'fetching origin/fm/alpha\nrebasing onto main\n'
	);
	writeFileSync(path.join(logs, OTHER_RUN, 'review.log'), 'reviewing changes\n');
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const findingsFile = () => path.join(home, 'data', 'alpha', `nm-${RUN}-findings.txt`);
const base = [
	{ ts: T, event: 'task.dispatched', task: 'alpha', kind: 'ship', project: 'demo' },
	{
		ts: T + 600,
		event: 'task.status',
		task: 'alpha',
		state: 'paused',
		text: 'no-mistakes run started'
	}
];
const asked = (file: string) => ({
	ts: T + 900,
	event: 'task.status',
	task: 'alpha',
	state: 'needs-decision',
	key: `nm-${RUN}-review`,
	text: `ask-user findings=f1 file=${file}`
});
const answered = (text: string) => ({
	ts: T + 960,
	event: 'task.status',
	task: 'alpha',
	state: 'resolved',
	key: `nm-${RUN}-review`,
	text: `answered: ${text}`
});

describe('InsightsService', () => {
	it('finds a run by the branch its logs name, and splits the task’s time', async () => {
		const s = service();
		await s.refresh(ledger(base), meta(true));
		const split = s.split('alpha')!;
		expect(split.phase).toBe('review');
		expect(s.time().tasks.map((t) => [t.taskId, t.title, t.projectId])).toEqual([
			['alpha', 'Alpha feature', 'demo']
		]);
		expect(s.eta('alpha')).not.toBeNull();
	});

	it('estimates a scout promoted to a ship task as ship work', async () => {
		const s = service();
		const promoted = [{ ...base[0], kind: 'scout' }, ...base.slice(1)];
		await s.refresh(ledger(promoted), meta(true));
		expect(s.eta('alpha')?.openEnded).toBe(false);
	});

	it('shows a decision with the question, Firstmate’s call and the full reason', async () => {
		writeFileSync(
			findingsFile(),
			'id: f1\nseverity: warning\nfile: src/lib/x.ts\nline: 4\ndescription: A case can pin a draft. More.\nauthority: ask-user\n'
		);
		writeFileSync(
			path.join(home, 'state', 'alpha.inbox', 'handled', '001.msg'),
			'schema=fm-task-inbox.v1\nat=x\n--\nDecision on f1: FIX by refusing drafts, because the rule says so. Run: no-mistakes axi respond --step review'
		);
		const s = service();
		await s.refresh(
			ledger([
				...base,
				asked(findingsFile()),
				answered('Decision on f1: FIX by refusing drafts, bec [truncated]')
			]),
			meta(true)
		);
		const [d] = s.decisions();
		expect(d).toMatchObject({
			taskId: 'alpha',
			taskTitle: 'Alpha feature',
			step: 'review',
			verdict: 'Fix it',
			answerCut: false,
			landed: false
		});
		expect(d.calls).toEqual([
			{
				question: 'A case can pin a draft.',
				detail: 'A case can pin a draft. More.',
				file: 'lib/x.ts',
				serious: false,
				verdict: 'Fix it',
				reason: 'By refusing drafts, because the rule says so.'
			}
		]);
	});

	it('never reads a findings file outside the task’s own data folder', async () => {
		const outside = path.join(root, 'elsewhere-findings.txt');
		writeFileSync(outside, 'id: f1\ndescription: Secret text.\n');
		const s = service();
		await s.refresh(ledger([...base, asked(outside), answered('FIX it')]), meta(true));
		expect(s.decisions()[0].calls[0].detail).toBe('');
	});

	it('asks the captain to connect Claude usage instead of prompting', async () => {
		const s = service();
		await s.pollUsage();
		expect(s.headroom().allowance).toEqual({
			state: 'connect',
			command: 'quota-axi --allow-keychain-prompt'
		});
		expect(s.headroom().atRisk).toBeNull();
	});

	it('warns when quota-axi says a window will not last, without inventing a time', async () => {
		const s = service({
			readQuota: async () => ({
				ok: true,
				stdout: JSON.stringify({
					providers: [
						{
							provider: 'claude',
							state: { status: 'fresh' },
							windows: [
								{ id: 'five_hour', percentRemaining: 20, resetsAt: '2030-01-01T10:00:00Z' },
								{ id: 'seven_day', percentRemaining: 80, resetsAt: '2030-01-05T10:00:00Z' }
							],
							quotaSemantics: {
								effectiveAvailability: [
									{ runway: { status: 'exhausts_before_reset' }, limitingWindowIds: ['five_hour'] }
								]
							}
						}
					]
				})
			})
		});
		await s.pollUsage();
		const h = s.headroom();
		expect(h.atRisk).toMatchObject({ label: 'This session', atRisk: true, runsOutAt: null });
		expect(h.allowance.state === 'ok' && h.allowance.windows[1].atRisk).toBe(false);
	});

	it('says why when quota-axi cannot run', async () => {
		const s = service({
			readQuota: async () => ({ ok: false, reason: 'quota-axi is not installed.' })
		});
		await s.pollUsage();
		expect(s.headroom().allowance).toEqual({
			state: 'unavailable',
			reason: 'quota-axi is not installed.'
		});
	});

	it('groups a task’s own use with its automated review’s', async () => {
		const now = Math.floor(Date.now() / 1000);
		const line = (cwd: string, branch: string, out: number) =>
			JSON.stringify({
				cwd,
				gitBranch: branch,
				timestamp: new Date((now - 60) * 1000).toISOString(),
				message: { usage: { output_tokens: out } }
			}) + '\n';
		mkdirSync(path.join(root, 'claude', 'a'), { recursive: true });
		mkdirSync(path.join(root, 'claude', 'b'), { recursive: true });
		writeFileSync(path.join(root, 'claude', 'a', 's.jsonl'), line('/pool/1/repo', 'fm/alpha', 6));
		writeFileSync(
			path.join(root, 'claude', 'b', 's.jsonl'),
			line(path.join(root, 'nm-worktrees', 'x', OTHER_RUN), 'HEAD', 2)
		);
		const s = service();
		await s.refresh(ledger(base), meta(true));
		await s.pollUsage();
		const u = s.headroom().usage;
		expect(u.available).toBe(true);
		if (!u.available) return;
		expect(u.value.shares).toEqual([
			expect.objectContaining({
				key: 'task:alpha',
				label: 'Alpha feature',
				week: 40,
				reviewShare: 0.25
			})
		]);
	});
});
