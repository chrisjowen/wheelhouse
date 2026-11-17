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
				providers: [
					{
						provider: 'claude',
						windows: [],
						state: { status: 'auth_required', error: 'keychain_prompt_required' }
					}
				]
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

	it('moves the estimate once a minute, not on every read', async () => {
		const minute = T + 3600 - ((T + 3600) % 60);
		let now = minute;
		const s = service({ now: () => now });
		await s.refresh(ledger(base), meta(true));
		const first = JSON.stringify(s.eta('alpha'));
		now += 30;
		expect(JSON.stringify(s.eta('alpha'))).toBe(first);
		now += 30;
		const later = s.eta('alpha')!;
		expect(JSON.stringify(later)).not.toBe(first);
		expect(later.ahead.find((x) => x.current)!.spent).toBe(minute + 60 - (T + 600));
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

	it('keeps each round’s question on the same step apart', async () => {
		writeFileSync(findingsFile(), 'id: f1\ndescription: A case can pin a draft.\n');
		const later = (l: { ts: number }) => ({ ...l, ts: l.ts + 600 });
		const s = service();
		await s.refresh(
			ledger([
				...base,
				asked(findingsFile()),
				answered('FIX it'),
				later(asked(findingsFile())),
				later(answered('KEEP it'))
			]),
			meta(true)
		);
		const ids = s.decisions().map((d) => d.id);
		expect(ids).toHaveLength(2);
		expect(new Set(ids).size).toBe(2);
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

	it('shows every quota provider and enriches them from the optional Firstmate status file', async () => {
		writeFileSync(
			path.join(home, 'state', 'provider-status.json'),
			JSON.stringify({
				generatedAt: '2030-01-01T00:00:00Z',
				providers: [
					{
						provider: 'opencode-go',
						out_until: '2030-01-01T02:00:00Z',
						reason: 'five-hour limit',
						spend_today_usd: null,
						cap_usd: null,
						estimate_remaining_percent: 35
					},
					{
						provider: 'claude-api',
						out_until: null,
						reason: null,
						spend_today_usd: 76.5,
						cap_usd: 100,
						estimate_remaining_percent: null
					}
				]
			})
		);
		const s = service({
			readQuota: async () => ({
				ok: true,
				stdout: JSON.stringify({
					providers: [
						{
							provider: 'codex',
							state: { status: 'fresh' },
							windows: [{ id: 'weekly', percentRemaining: 79 }]
						},
						{
							provider: 'cursor',
							state: { status: 'fresh' },
							windows: [{ id: 'monthly', percentRemaining: 100 }]
						},
						{
							provider: 'claude',
							state: { status: 'auth_required', error: 'credentials_invalid' },
							windows: []
						},
						{
							provider: 'openrouter',
							state: { status: 'fresh' },
							credits: { remaining: 0.18, unit: 'usd' },
							windows: []
						},
						{
							provider: 'copilot',
							state: { status: 'auth_required', error: 'sign-in required' },
							windows: []
						}
					]
				})
			})
		});
		await s.pollUsage();
		const providers = s.headroom().providers;
		expect(providers.map((p) => p.provider)).toEqual([
			'codex',
			'cursor',
			'claude',
			'openrouter',
			'copilot',
			'opencode-go',
			'claude-api'
		]);
		expect(providers.find((p) => p.provider === 'claude')).toMatchObject({
			state: 'auth_required',
			reason: 'credentials_invalid'
		});
		expect(providers.find((p) => p.provider === 'opencode-go')).toMatchObject({
			outUntil: '2030-01-01T02:00:00Z',
			statusReason: 'five-hour limit',
			estimateRemainingPercent: 35
		});
		expect(providers.find((p) => p.provider === 'claude-api')).toMatchObject({
			spendTodayUsd: 76.5,
			capUsd: 100
		});
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

	it('gives quota-axi the mapped vault keys only in its own environment', async () => {
		const bin = path.join(root, 'bin');
		mkdirSync(bin, { recursive: true });
		// A stand-in quota-axi that reports ElevenLabs only when its key arrives as ELEVENLABS_API_KEY.
		writeFileSync(
			path.join(bin, 'quota-axi'),
			`#!/bin/sh
if [ "$ELEVENLABS_API_KEY" = "xi-test" ]; then
  echo '{"providers":[{"provider":"elevenlabs","state":{"status":"fresh"},"credits":{"remaining":12345,"unit":"characters"}}]}'
else
  echo '{"providers":[{"provider":"elevenlabs","notSetUp":true}]}'
fi
`,
			{ mode: 0o755 }
		);
		const env = { PATH: `${bin}:/usr/bin:/bin`, HOME: root };
		const s = service({
			readQuota: undefined,
			env,
			quotaEnv: async () => ({ ELEVENLABS_API_KEY: 'xi-test' })
		});
		await s.pollUsage();
		expect(s.headroom().providers.find((p) => p.provider === 'elevenlabs')).toMatchObject({
			notSetUp: false,
			credits: { remaining: 12345, unit: 'characters' }
		});
		expect(env).not.toHaveProperty('ELEVENLABS_API_KEY');
		expect(process.env.ELEVENLABS_API_KEY).not.toBe('xi-test');
		expect(JSON.stringify(s.headroom())).not.toContain('xi-test');
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

	it('keeps every task’s decisions until the next refresh, and lets go of tasks no longer held', async () => {
		writeFileSync(
			findingsFile(),
			'id: f1\nseverity: warning\nfile: src/lib/x.ts\nline: 4\ndescription: A case can pin a draft.\n'
		);
		writeFileSync(
			path.join(home, 'state', 'alpha.inbox', 'handled', '001.msg'),
			'schema=fm-task-inbox.v1\nat=x\n--\nDecision on f1: FIX by refusing drafts.'
		);
		const s = service();
		const tasks = ledger([...base, asked(findingsFile()), answered('Decision on f1: FIX it.')]);
		await s.refresh(tasks, meta(true));
		const all = s.decisions();
		expect(all).toHaveLength(1);
		expect(s.decisions()).toBe(all);
		expect(s.decisions('alpha')).toEqual(all);
		expect(s.decisions('nobody')).toEqual([]);
		await s.refresh(tasks, meta(true));
		expect(s.decisions()).not.toBe(all);
		expect(s.decisions()).toEqual(all);

		// The ledger let go of the task and the fleet no longer lists it.
		await s.refresh(new Map(), new Map());
		expect(s.decisions()).toEqual([]);
		const held = s as unknown as { handled: Map<string, unknown>; findings: Map<string, unknown> };
		expect(held.handled.size).toBe(0);
		expect(held.findings.size).toBe(0);
	});
});
