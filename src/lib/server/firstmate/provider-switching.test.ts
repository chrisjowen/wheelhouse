import { chmod, mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FleetView, HeadroomProvider, TaskSummary } from '../../types';
import type { ProviderSwitcherOptions } from './provider-switching';
import { ProviderSwitcher, ProviderStatusStore } from './provider-switching';

let root = '';
afterEach(async () => {
	if (root) await rm(root, { recursive: true, force: true });
	root = '';
});

async function setup() {
	root = await mkdtemp(path.join(os.tmpdir(), 'wh-provider-switch-'));
	const homeDir = path.join(root, 'home');
	const firstmateDir = path.join(root, 'firstmate');
	const state = path.join(homeDir, 'state');
	const config = path.join(homeDir, 'config');
	const bin = path.join(firstmateDir, 'bin');
	await Promise.all([
		mkdir(state, { recursive: true }),
		mkdir(config, { recursive: true }),
		mkdir(bin, { recursive: true })
	]);
	const argsFile = path.join(root, 'control-args');
	const controlFile = path.join(bin, 'fm-control.sh');
	await writeFile(controlFile, '#!/bin/sh\nprintf \'%s\\n\' "$@" > "$FM_TEST_ARGS"\n');
	await chmod(controlFile, 0o755);
	return { homeDir, firstmateDir, state, config, argsFile, controlFile };
}

const profile = (harness: string, model: string, provider: string) => ({
	harness,
	model,
	effort: 'high',
	provider
});

async function makeWorker(
	homeDir: string,
	status: string,
	output: string,
	selected = profile('opencode', 'opencode-go', 'opencode-go')
): Promise<TaskSummary> {
	const choices = [
		profile('opencode', 'opencode-go', 'opencode-go'),
		profile('codex', 'gpt-codex', 'codex'),
		profile('opencode', 'openrouter/model', 'openrouter'),
		profile('claude', 'sonnet-api', 'claude-api')
	].filter(
		(candidate) =>
			candidate.harness !== selected.harness ||
			candidate.model !== selected.model ||
			candidate.provider !== selected.provider
	);
	await writeFile(
		path.join(homeDir, 'config', 'crew-dispatch.json'),
		JSON.stringify({
			rules: [{ when: 'code work', use: [selected, ...choices] }]
		})
	);
	await writeFile(path.join(homeDir, 'state', 'task-1.meta'), 'backend=tmux\n');
	return {
		id: 'task-1',
		status,
		busy: false,
		current: { state: status, source: 'crew-state', detail: null, observedAt: null, fresh: true },
		worker: {
			harness: selected.harness,
			name: 'worker',
			model: selected.model,
			modelKnown: true,
			mode: null,
			yolo: null
		},
		outputAvailable: true,
		summaryRaw: output,
		activity: null
	} as unknown as TaskSummary;
}

function makeSwitcher(
	options: Awaited<ReturnType<typeof setup>>,
	lines: string[],
	providerViews: HeadroomProvider[],
	automaticSwitching = true
) {
	const adapter = {
		peek: vi.fn(async () => ({
			ok: true as const,
			observedAt: new Date().toISOString(),
			durationMs: 1,
			value: { lines, requested: 80 }
		})),
		note: vi.fn(async (_requestId: string, _body: string) => ({
			ok: true as const,
			observedAt: new Date().toISOString(),
			durationMs: 1,
			value: {
				schema: 'fm-inbox-note.v1' as const,
				outcome: 'created' as const,
				noteId: 'note-1',
				requestId: _requestId,
				saved: true,
				announced: true,
				acknowledged: false
			}
		}))
	};
	const service = new ProviderSwitcher({
		homeDir: options.homeDir,
		firstmateDir: options.firstmateDir,
		controlFile: options.controlFile,
		adapter,
		automaticSwitching: async () => automaticSwitching,
		providerViews: () => providerViews,
		env: { ...process.env, FM_TEST_ARGS: options.argsFile },
		now: () => Date.parse('2026-04-12T08:00:00.000Z'),
		log: () => {}
	} satisfies ProviderSwitcherOptions);
	return { service, adapter };
}

const fleet = (task: TaskSummary) => ({ tasks: [task] }) as unknown as FleetView;

const openRouter = (credits: number | null, state = 'fresh'): HeadroomProvider =>
	({
		provider: 'openrouter',
		label: 'OpenRouter',
		state,
		reason: null,
		notSetUp: false,
		stale: false,
		windows: [],
		credits: credits === null ? null : { remaining: credits, unit: 'usd', unlimited: false },
		outUntil: null,
		statusReason: null,
		spendTodayUsd: null,
		capUsd: null,
		estimateRemainingPercent: null
	}) as HeadroomProvider;

describe('provider switching lifecycle', () => {
	it('marks the explicit current provider out and relaunches on the next eligible rule profile through the fake public command', async () => {
		const files = await setup();
		const task = await makeWorker(
			files.homeDir,
			'failed',
			'GoUsageLimitError: HTTP 429; reset in 30 minutes'
		);
		await writeFile(
			path.join(files.state, 'provider-status.json'),
			JSON.stringify({
				generatedAt: '2026-04-12T07:00:00.000Z',
				providers: [
					{
						provider: 'codex',
						out_until: '2026-04-13T00:00:00.000Z',
						reason: 'maintenance',
						spend_today_usd: null,
						cap_usd: null,
						estimate_remaining_percent: null
					}
				]
			})
		);
		const { service, adapter } = makeSwitcher(files, [], [openRouter(0)]);
		await service.observe(fleet(task));

		const saved = JSON.parse(
			await readFile(path.join(files.state, 'provider-status.json'), 'utf8')
		) as {
			generatedAt: string;
			providers: { provider: string; out_until: string | null; reason: string | null }[];
		};
		expect(saved.generatedAt).toBe('2026-04-12T08:00:00.000Z');
		expect(saved.providers.find((item) => item.provider === 'opencode-go')).toMatchObject({
			out_until: '2026-04-12T08:30:00.000Z',
			reason: 'Usage or rate limit'
		});
		expect(saved.providers.find((item) => item.provider === 'codex')?.out_until).toBe(
			'2026-04-13T00:00:00.000Z'
		);
		expect((await readFile(files.argsFile, 'utf8')).trim().split('\n')).toEqual([
			'task-1',
			'relaunch',
			'--harness',
			'claude',
			'--model',
			'sonnet-api',
			'--effort',
			'high',
			'--note',
			expect.stringContaining('switch task-1 from opencode-go to claude-api')
		]);
		expect(adapter.note).toHaveBeenCalledWith(
			expect.stringMatching(/^provider-switch:/),
			expect.stringContaining('Task task-1:')
		);
		expect((await readdir(files.state)).filter((name) => name.endsWith('.tmp'))).toEqual([]);
	});

	it('uses OpenRouter after Codex only when the quota report shows a working key and positive balance', async () => {
		const files = await setup();
		const task = await makeWorker(
			files.homeDir,
			'failed',
			'HTTP 429 rate limit; retry after 2 hours'
		);
		await writeFile(
			path.join(files.state, 'provider-status.json'),
			JSON.stringify({
				generatedAt: '2026-04-12T07:00:00.000Z',
				providers: [
					{
						provider: 'codex',
						out_until: '2026-04-13T00:00:00.000Z',
						reason: 'limit',
						spend_today_usd: null,
						cap_usd: null,
						estimate_remaining_percent: null
					}
				]
			})
		);
		const { service } = makeSwitcher(files, [], [openRouter(12.5)]);
		await service.observe(fleet(task));
		const args = (await readFile(files.argsFile, 'utf8')).trim().split('\n');
		expect(args.slice(args.indexOf('--harness'), args.indexOf('--note'))).toEqual([
			'--harness',
			'opencode',
			'--model',
			'openrouter/model',
			'--effort',
			'high'
		]);
	});

	it('skips OpenRouter when its key is not working even when the account has credits', async () => {
		const files = await setup();
		const task = await makeWorker(files.homeDir, 'failed', 'HTTP 429 rate limit');
		await writeFile(
			path.join(files.state, 'provider-status.json'),
			JSON.stringify({
				generatedAt: '2026-04-12T07:00:00.000Z',
				providers: [
					{
						provider: 'codex',
						out_until: '2026-04-13T00:00:00.000Z',
						reason: 'limit',
						spend_today_usd: null,
						cap_usd: null,
						estimate_remaining_percent: null
					}
				]
			})
		);
		const { service } = makeSwitcher(files, [], [openRouter(12.5, 'auth_required')]);
		await service.observe(fleet(task));
		const args = (await readFile(files.argsFile, 'utf8')).trim().split('\n');
		expect(args.slice(args.indexOf('--harness'), args.indexOf('--model'))).toEqual([
			'--harness',
			'claude'
		]);
	});

	it('marks an authoritative Claude API spend of $100 out until the next UTC midnight', async () => {
		const files = await setup();
		await writeFile(
			path.join(files.state, 'provider-status.json'),
			JSON.stringify({
				generatedAt: '2026-04-12T07:59:00.000Z',
				providers: [
					{
						provider: 'claude-api',
						out_until: null,
						reason: null,
						spend_today_usd: 100,
						cap_usd: null,
						estimate_remaining_percent: null
					}
				]
			})
		);
		const { service } = makeSwitcher(files, [], []);
		await service.observe({ tasks: [] } as unknown as FleetView);
		const saved = JSON.parse(
			await readFile(path.join(files.state, 'provider-status.json'), 'utf8')
		) as { providers: { provider: string; out_until: string | null; cap_usd: number | null }[] };
		expect(saved.providers.find((item) => item.provider === 'claude-api')).toMatchObject({
			out_until: '2026-04-13T00:00:00.000Z',
			cap_usd: 100
		});
	});

	it('records provider exhaustion but does not relaunch when automatic switching is disabled', async () => {
		const files = await setup();
		const task = await makeWorker(files.homeDir, 'blocked', 'GoUsageLimitError: HTTP 429');
		const { service } = makeSwitcher(files, [], [], false);
		await service.observe(fleet(task));
		const saved = JSON.parse(
			await readFile(path.join(files.state, 'provider-status.json'), 'utf8')
		) as {
			providers: {
				provider: string;
				out_until: string | null;
				spend_today_usd: number | null;
				cap_usd: number | null;
			}[];
		};
		expect(saved.providers.find((item) => item.provider === 'opencode-go')?.out_until).toBe(
			'2026-04-13T08:00:00.000Z'
		);
		expect(saved.providers.find((item) => item.provider === 'claude-api')).toMatchObject({
			spend_today_usd: null,
			cap_usd: 100
		});
		await expect(readFile(files.argsFile, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
	});

	it.each([
		{
			provider: 'codex',
			harness: 'codex',
			model: 'gpt-codex',
			message: 'Codex usage limit reached; retry in 5 minutes',
			reset: '2026-04-12T08:05:00.000Z'
		},
		{
			provider: 'openrouter',
			harness: 'opencode',
			model: 'openrouter/model',
			message: 'OpenRouter insufficient credits (HTTP 402)',
			reset: '2026-04-13T08:00:00.000Z'
		},
		{
			provider: 'claude',
			harness: 'claude',
			model: 'claude-weekly',
			message: 'Claude weekly usage limit reached',
			reset: '2026-04-19T08:00:00.000Z'
		},
		{
			provider: 'claude-api',
			harness: 'claude',
			model: 'sonnet-api',
			message: 'Anthropic API credit balance too low; rate_limit_error',
			reset: '2026-04-13T08:00:00.000Z'
		}
	])(
		'records $provider errors against the explicit provider and stated or conservative reset',
		async ({ provider, harness, model, message, reset }) => {
			const files = await setup();
			const task = await makeWorker(
				files.homeDir,
				'failed',
				message,
				profile(harness, model, provider)
			);
			const { service } = makeSwitcher(files, [], []);
			await service.observe(fleet(task));
			const saved = JSON.parse(
				await readFile(path.join(files.state, 'provider-status.json'), 'utf8')
			) as {
				providers: { provider: string; out_until: string | null }[];
			};
			expect(saved.providers.find((item) => item.provider === provider)?.out_until).toBe(reset);
		}
	);

	it('never drives non-tmux worker lifecycle and preserves unknown Claude spend instead of inventing prices', async () => {
		const files = await setup();
		const task = await makeWorker(files.homeDir, 'failed', 'GoUsageLimitError: 429');
		await writeFile(path.join(files.state, 'task-1.meta'), 'backend=herdr\n');
		const { service } = makeSwitcher(files, [], [openRouter(10)]);
		await service.observe(fleet(task));
		const statuses = await new ProviderStatusStore(files.homeDir, () =>
			Date.parse('2026-04-12T08:00:00.000Z')
		).read();
		expect(statuses.find((item) => item.provider === 'claude-api')).toMatchObject({
			spend_today_usd: null,
			cap_usd: 100,
			estimate_remaining_percent: null
		});
		expect(await readdir(files.state)).not.toContain('provider-status.json.tmp');
	});
});
