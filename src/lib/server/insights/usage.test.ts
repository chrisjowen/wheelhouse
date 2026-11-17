import { appendFileSync, mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
	attribute,
	CONNECT_COMMAND,
	parseAllowance,
	parseProviderHeadroom,
	parseProviderStatus,
	runsOutAt,
	TranscriptUsage,
	weight,
	type AttributionContext
} from './usage';

// Synthetic transcripts and quota output only.
const RUN = '01BBBBBBBBBBBBBBBBBBBBBBBB';
const ctx: AttributionContext = {
	firstmateDir: '/fm',
	homeDir: '/fm-home',
	nmWorktreesDir: '/nm/worktrees',
	runTask: (r) => (r === RUN ? 'alpha' : null),
	isTask: (id) => id === 'alpha' || id === 'beta'
};

describe('attribute', () => {
	it('names a worker by its fm/<task> branch', () => {
		expect(attribute('/pool/3/repo', 'fm/alpha', ctx)).toBe('task:alpha');
	});
	it('names a validation run’s agents by the run’s task', () => {
		expect(attribute(`/nm/worktrees/abc123/${RUN}`, 'HEAD', ctx)).toBe('review:alpha');
		expect(attribute('/nm/worktrees/abc123/01CCCCCCCCCCCCCCCCCCCCCCCC', null, ctx)).toBe('other');
	});
	it('names Firstmate and other use', () => {
		expect(attribute('/fm', 'main', ctx)).toBe('firstmate');
		expect(attribute('/fm-home/projects/demo', 'main', ctx)).toBe('firstmate');
		expect(attribute('/elsewhere', 'main', ctx)).toBe('other');
	});
	it('waits when a worker has not checked out its branch yet', () => {
		expect(attribute('/pool/3/repo', 'HEAD', ctx)).toBeNull();
	});
	it('does not confuse a sibling directory with the Firstmate checkout', () => {
		expect(attribute('/fm-other', 'main', ctx)).toBe('other');
	});
});

describe('weight', () => {
	it('weights writing above re-reading', () => {
		expect(
			weight({
				input_tokens: 10,
				cache_creation_input_tokens: 100,
				cache_read_input_tokens: 1000,
				output_tokens: 20
			})
		).toBe(10 + 125 + 100 + 100);
	});
});

describe('TranscriptUsage', () => {
	let root: string;
	afterEach(() => root && rmSync(root, { recursive: true, force: true }));
	const now = Math.floor(Date.now() / 1000);
	const iso = (s: number) => new Date(s * 1000).toISOString();
	const rec = (o: Record<string, unknown>) => JSON.stringify(o) + '\n';
	const use = (ts: number, out: number, extra: Record<string, unknown> = {}) =>
		rec({ timestamp: iso(ts), message: { usage: { output_tokens: out } }, ...extra });

	it('attributes a worker’s rows from before it checked out its branch', async () => {
		root = mkdtempSync(path.join(tmpdir(), 'wh-usage-'));
		mkdirSync(path.join(root, 'proj'));
		const f = path.join(root, 'proj', 's.jsonl');
		writeFileSync(
			f,
			rec({ cwd: '/pool/3/repo', gitBranch: 'HEAD' }) +
				use(now - 60, 10, { cwd: '/pool/3/repo', gitBranch: 'HEAD' }) +
				use(now - 30, 10, { cwd: '/pool/3/repo', gitBranch: 'fm/alpha' })
		);
		const u = new TranscriptUsage(root, () => ctx);
		await u.poll(now);
		expect(u.totals(now)).toEqual([{ who: 'task:alpha', fiveHour: 100, week: 100 }]);
	});

	it('reads only what was appended since the last poll', async () => {
		root = mkdtempSync(path.join(tmpdir(), 'wh-usage-'));
		mkdirSync(path.join(root, 'fm'));
		const f = path.join(root, 'fm', 's.jsonl');
		writeFileSync(f, use(now - 100, 1, { cwd: '/fm', gitBranch: 'main' }));
		const u = new TranscriptUsage(root, () => ctx);
		await u.poll(now);
		appendFileSync(f, use(now - 10, 2, { cwd: '/fm', gitBranch: 'main' }));
		await u.poll(now);
		expect(u.totals(now)).toEqual([{ who: 'firstmate', fiveHour: 15, week: 15 }]);
	});

	it('holds back a line still being written until it is whole', async () => {
		root = mkdtempSync(path.join(tmpdir(), 'wh-usage-'));
		mkdirSync(path.join(root, 'fm'));
		const f = path.join(root, 'fm', 's.jsonl');
		const whole = use(now - 10, 2, { cwd: '/fm', gitBranch: 'main', note: 'café ✓' });
		const cut = Buffer.from(whole).indexOf(Buffer.from('✓')) + 1;
		writeFileSync(f, use(now - 100, 1, { cwd: '/fm', gitBranch: 'main' }));
		appendFileSync(f, Buffer.from(whole).subarray(0, cut));
		const u = new TranscriptUsage(root, () => ctx);
		await u.poll(now);
		expect(u.totals(now)).toEqual([{ who: 'firstmate', fiveHour: 5, week: 5 }]);
		appendFileSync(f, Buffer.from(whole).subarray(cut));
		await u.poll(now);
		expect(u.totals(now)).toEqual([{ who: 'firstmate', fiveHour: 15, week: 15 }]);
	});

	it('keeps a week, splits the last five hours, and counts per hour', async () => {
		root = mkdtempSync(path.join(tmpdir(), 'wh-usage-'));
		mkdirSync(path.join(root, 'fm'));
		writeFileSync(
			path.join(root, 'fm', 's.jsonl'),
			use(now - 8 * 86400, 100, { cwd: '/fm' }) +
				use(now - 2 * 86400, 1, { cwd: '/fm' }) +
				use(now - 1800, 2, { cwd: '/fm' })
		);
		const u = new TranscriptUsage(root, () => ctx);
		await u.poll(now);
		expect(u.totals(now)).toEqual([{ who: 'firstmate', fiveHour: 10, week: 15 }]);
		expect(u.hourly(now).at(-1)).toBe(10);
	});

	it('skips transcripts untouched for a week, and never reads message text', async () => {
		root = mkdtempSync(path.join(tmpdir(), 'wh-usage-'));
		mkdirSync(path.join(root, 'old'));
		const f = path.join(root, 'old', 's.jsonl');
		writeFileSync(f, use(now - 100, 5, { cwd: '/fm' }));
		utimesSync(f, now - 9 * 86400, now - 9 * 86400);
		const u = new TranscriptUsage(root, () => ctx);
		await u.poll(now);
		expect(u.totals(now)).toEqual([]);
	});

	it('counts sessions it never could attribute as other use', async () => {
		root = mkdtempSync(path.join(tmpdir(), 'wh-usage-'));
		mkdirSync(path.join(root, 'p'));
		writeFileSync(
			path.join(root, 'p', 's.jsonl'),
			use(now - 10, 1, { cwd: '/pool/9/repo', gitBranch: 'HEAD' })
		);
		const u = new TranscriptUsage(root, () => ctx);
		await u.poll(now);
		expect(u.totals(now)).toEqual([{ who: 'other', fiveHour: 5, week: 5 }]);
	});
});

describe('parseAllowance', () => {
	const doc = (claude: Record<string, unknown>) =>
		JSON.stringify({ providers: [{ provider: 'claude', ...claude }] });

	it('asks for the one-time connection when quota-axi needs Keychain access', () => {
		expect(
			parseAllowance(
				doc({ windows: [], state: { status: 'auth_required', error: 'keychain_prompt_required' } })
			)
		).toEqual({ state: 'connect', command: CONNECT_COMMAND });
	});

	it('does not suggest a Keychain prompt for invalid credentials', () => {
		expect(
			parseAllowance(
				doc({ windows: [], state: { status: 'auth_required', error: 'credentials_invalid' } })
			)
		).toEqual({
			state: 'unavailable',
			reason: 'quota-axi could not read Claude’s limits (credentials_invalid).'
		});
	});

	it('reads the windows with plain labels and quota-axi’s runway warnings', () => {
		const a = parseAllowance(
			doc({
				state: { status: 'fresh' },
				windows: [
					{
						id: 'five_hour',
						label: '5-hour',
						percentRemaining: 34.4,
						resetsAt: '2026-01-01T10:00:00Z'
					},
					{
						id: 'seven_day',
						label: 'weekly',
						percentRemaining: 71,
						resetsAt: '2026-01-04T10:00:00Z'
					}
				],
				quotaSemantics: {
					effectiveAvailability: [
						{ runway: { status: 'exhausts_before_reset' }, limitingWindowIds: ['five_hour'] }
					]
				}
			})
		);
		expect(a.state).toBe('ok');
		if (a.state !== 'ok') return;
		expect(a.windows.map((w) => [w.label, w.percentLeft])).toEqual([
			['This session', 34],
			['This week', 71]
		]);
		expect([...a.runwayShort]).toEqual(['five_hour']);
	});

	it('says why when nothing can be read', () => {
		expect(parseAllowance('not json').state).toBe('unavailable');
		expect(parseAllowance(JSON.stringify({ providers: [] })).state).toBe('unavailable');
		expect(parseAllowance(doc({ windows: [], state: { status: 'error', error: 'boom' } }))).toEqual(
			{
				state: 'unavailable',
				reason: 'quota-axi could not read Claude’s limits (boom).'
			}
		);
	});
});

describe('provider headroom', () => {
	it('keeps every quota-axi provider, including setup and attention states', () => {
		const providers = parseProviderHeadroom(
			JSON.stringify({
				providers: [
					{
						provider: 'codex',
						state: { status: 'fresh', stale: false },
						windows: [
							{
								id: 'weekly',
								label: 'week',
								percentRemaining: 79,
								resetsAt: '2030-01-01T00:00:00Z'
							}
						]
					},
					{
						provider: 'openrouter',
						state: { status: 'fresh', stale: false },
						credits: { remaining: 0.18, unit: 'usd' },
						windows: [
							{
								id: 'key-limit',
								spentUsd: 49.82,
								limitUsd: 50,
								percentRemaining: 0.36,
								resetText: 'monthly'
							}
						]
					},
					{
						provider: 'copilot',
						state: { status: 'auth_required', error: 'GitHub Copilot sign-in required' },
						windows: []
					},
					{
						provider: 'opencode-go',
						notSetUp: true,
						state: { status: 'auth_required', error: 'opencode_go_credential_unavailable' },
						windows: []
					}
				]
			})
		);
		expect(providers.map((p) => p.provider)).toEqual([
			'codex',
			'openrouter',
			'copilot',
			'opencode-go'
		]);
		expect(providers[0]).toMatchObject({
			label: 'Codex',
			state: 'fresh',
			windows: [{ percentRemaining: 79 }]
		});
		expect(providers[1]).toMatchObject({
			label: 'OpenRouter',
			credits: { remaining: 0.18, unit: 'usd' },
			windows: [{ percentRemaining: 0.36, resetText: 'monthly' }]
		});
		expect(providers[2]).toMatchObject({
			state: 'auth_required',
			reason: 'GitHub Copilot sign-in required'
		});
		expect(providers[3]).toMatchObject({ notSetUp: true });
	});

	it('merges the optional status contract and preserves status-only providers', () => {
		const statuses = parseProviderStatus({
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
				},
				{ spend_today_usd: 'secret' }
			]
		});
		const providers = parseProviderHeadroom(
			JSON.stringify({
				providers: [{ provider: 'opencode-go', state: { status: 'fresh' }, windows: [] }]
			}),
			statuses
		);
		expect(providers).toHaveLength(2);
		expect(providers[0]).toMatchObject({
			provider: 'opencode-go',
			outUntil: '2030-01-01T02:00:00Z',
			statusReason: 'five-hour limit',
			estimateRemainingPercent: 35
		});
		expect(providers[1]).toMatchObject({
			provider: 'claude-api',
			label: 'Claude API',
			spendTodayUsd: 76.5,
			capUsd: 100
		});
	});
});

describe('runsOutAt', () => {
	const now = 10_000;
	it('projects the recent pace forward', () => {
		const s = [
			{ at: now - 1800, percentLeft: 50 },
			{ at: now, percentLeft: 40 }
		];
		// 10 points per 30 minutes: 40 left lasts two hours
		expect(runsOutAt(s, now + 3 * 3600, now)).toBe(now + 7200);
	});
	it('says nothing when it lasts until the reset', () => {
		const s = [
			{ at: now - 1800, percentLeft: 50 },
			{ at: now, percentLeft: 40 }
		];
		expect(runsOutAt(s, now + 3600, now)).toBeNull();
	});
	it('needs at least ten minutes of readings', () => {
		const s = [
			{ at: now - 300, percentLeft: 50 },
			{ at: now, percentLeft: 40 }
		];
		expect(runsOutAt(s, null, now)).toBeNull();
	});
});
