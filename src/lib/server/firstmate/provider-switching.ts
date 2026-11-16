import { randomUUID, createHash } from 'node:crypto';
import { lstat, mkdir, open, readFile, rename, unlink } from 'node:fs/promises';
import path from 'node:path';
import type { FleetView, HeadroomProvider, TaskSummary } from '../../types';
import { parseProviderStatus, type ProviderStatusRecord } from '../insights/usage';
import type { FirstmateAdapter } from './adapter';
import { runBounded } from './exec';
import { scriptEnv } from './scriptenv';

const PROVIDER_ORDER = ['opencode-go', 'codex', 'openrouter', 'claude-api'];
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,159}$/;
const STATUS_CAP_USD = 100;
const MAX_CONFIG_BYTES = 1024 * 1024;

type DispatchProfile = {
	harness: string;
	model: string | null;
	effort: string | null;
	provider: string;
};
type DispatchRule = { when: string; use: DispatchProfile[] };
type Failure = { provider: string; reason: string; resetAt: string };

export interface ProviderStatusFile {
	generatedAt: string | null;
	providers: ProviderStatusRecord[];
}

export interface ProviderSwitcherOptions {
	homeDir: string;
	firstmateDir: string;
	adapter: Pick<FirstmateAdapter, 'peek' | 'note'>;
	automaticSwitching: () => Promise<boolean>;
	providerViews: () => HeadroomProvider[];
	env?: NodeJS.ProcessEnv;
	now?: () => number;
	controlFile?: string;
	log?: (message: string) => void;
}

const object = (value: unknown): Record<string, unknown> =>
	value && typeof value === 'object' && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: {};
const text = (value: unknown): string | null => (typeof value === 'string' ? value : null);

function parseProfile(value: unknown): DispatchProfile | null {
	const raw = object(value);
	if (
		typeof raw.harness !== 'string' ||
		!IDENTIFIER.test(raw.harness) ||
		typeof raw.provider !== 'string' ||
		!IDENTIFIER.test(raw.provider)
	)
		return null;
	const model = text(raw.model);
	const effort = text(raw.effort);
	return {
		harness: raw.harness,
		model: model && IDENTIFIER.test(model) ? model : null,
		effort: effort && IDENTIFIER.test(effort) ? effort : null,
		provider: raw.provider.toLowerCase()
	};
}

function parseDispatch(textValue: string): DispatchRule[] {
	let raw: unknown;
	try {
		raw = JSON.parse(textValue);
	} catch {
		return [];
	}
	const rules = object(raw).rules;
	if (!Array.isArray(rules)) return [];
	return rules.flatMap((entry) => {
		const rule = object(entry);
		if (typeof rule.when !== 'string' || !rule.when.trim() || !Array.isArray(rule.use)) return [];
		return [
			{
				when: rule.when,
				use: rule.use
					.map(parseProfile)
					.filter((profile): profile is DispatchProfile => profile !== null)
			}
		];
	});
}

function sameProfile(a: DispatchProfile, b: DispatchProfile): boolean {
	return a.harness === b.harness && a.model === b.model && a.provider === b.provider;
}

async function readDispatch(homeDir: string): Promise<DispatchRule[]> {
	const file = path.join(homeDir, 'config', 'crew-dispatch.json');
	try {
		const stat = await lstat(file);
		if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink > 1 || stat.size > MAX_CONFIG_BYTES)
			return [];
		return parseDispatch(await readFile(file, 'utf8'));
	} catch {
		return [];
	}
}

async function isLocalTmuxWorker(homeDir: string, taskId: string): Promise<boolean> {
	try {
		const metaFile = path.join(homeDir, 'state', `${taskId}.meta`);
		const stat = await lstat(metaFile);
		if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink > 1 || stat.size > 64 * 1024)
			return false;
		const meta = await readFile(metaFile, 'utf8');
		const backends = meta
			.split(/\r?\n/)
			.filter((line) => line.startsWith('backend='))
			.map((line) => line.slice('backend='.length));
		return (backends.at(-1) || 'tmux') === 'tmux';
	} catch (error) {
		return (error as NodeJS.ErrnoException).code === 'ENOENT';
	}
}

function isWorkerStopped(task: TaskSummary): boolean {
	if (
		task.busy ||
		['done', 'landed', 'closed', 'needs-review', 'needs-decision'].includes(task.status)
	)
		return false;
	return (
		['failed', 'blocked', 'lost'].includes(task.status) ||
		['failed', 'blocked', 'paused'].includes(task.current?.state ?? '')
	);
}

function classifyFailure(message: string, provider: string, now: number): Failure | null {
	const lower = message.toLowerCase();
	const credit =
		/\b402\b|insufficient[_ ]credits?|out of credits?|credit balance.{0,40}(?:low|insufficient|exhausted)|payment required/.test(
			lower
		);
	const weekly = /weekly.{0,35}(?:usage )?limit|(?:usage )?limit.{0,35}weekly/.test(lower);
	const limited =
		/\b429\b|gousagelimiterror|rate[_ ]limit|usage[_ ]limit|usage limit|quota.{0,30}(?:exceeded|exhausted)|resource_exhausted|too many requests/.test(
			lower
		);
	if (!credit && !limited) return null;
	const reason = credit
		? 'Provider credit error'
		: weekly
			? 'Weekly usage limit'
			: 'Usage or rate limit';
	const resetAt =
		statedReset(message, now) ?? new Date(now + (weekly ? 7 : 1) * 86400_000).toISOString();
	return { provider, reason, resetAt };
}

function statedReset(message: string, now: number): string | null {
	const iso =
		/\b(20\d{2}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|\s*UTC|[+-]\d{2}:?\d{2})?)\b/i.exec(
			message
		);
	if (iso) {
		const date = Date.parse(iso[1].replace(/\s*UTC$/i, 'Z').replace(' ', 'T'));
		if (Number.isFinite(date) && date > now) return new Date(date).toISOString();
	}
	const duration =
		/\b(?:reset|retry|available|try again)[^\n.]{0,35}?\b(?:in|after)\s+((?:\d+\s*(?:days?|d|hours?|hrs?|h|minutes?|mins?|m|seconds?|secs?|s)\s*)+)/i.exec(
			message
		);
	if (duration) {
		const units = [
			...duration[1].matchAll(/(\d+)\s*(days?|d|hours?|hrs?|h|minutes?|mins?|m|seconds?|secs?|s)/gi)
		];
		const seconds = units.reduce((sum, match) => {
			const unit = match[2].toLowerCase();
			const scale = unit.startsWith('d')
				? 86400
				: unit.startsWith('h')
					? 3600
					: unit.startsWith('m')
						? 60
						: 1;
			return sum + Number(match[1]) * scale;
		}, 0);
		if (seconds > 0) return new Date(now + seconds * 1000).toISOString();
	}
	const time =
		/\b(?:reset|retry|available)[^\n.]{0,35}?\bat\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s*(?:UTC|GMT)?\b/i.exec(
			message
		);
	if (time) {
		let hour = Number(time[1]);
		const minute = Number(time[2] ?? 0);
		if (time[3]?.toLowerCase() === 'pm' && hour < 12) hour += 12;
		if (time[3]?.toLowerCase() === 'am' && hour === 12) hour = 0;
		if (hour < 24 && minute < 60) {
			let reset = Date.UTC(
				new Date(now).getUTCFullYear(),
				new Date(now).getUTCMonth(),
				new Date(now).getUTCDate(),
				hour,
				minute
			);
			if (reset <= now) reset += 86400_000;
			return new Date(reset).toISOString();
		}
	}
	return null;
}

function outUntil(status: ProviderStatusRecord | undefined, now: number): boolean {
	return !!status?.out_until && Date.parse(status.out_until) > now;
}

function openRouterReady(views: HeadroomProvider[]): boolean {
	const provider = views.find((view) => view.provider === 'openrouter');
	return !!(
		provider &&
		provider.state === 'fresh' &&
		!provider.stale &&
		!provider.notSetUp &&
		provider.credits &&
		(provider.credits.unlimited ||
			(provider.credits.unit === 'usd' &&
				provider.credits.remaining !== null &&
				provider.credits.remaining > 0))
	);
}

export class ProviderStatusStore {
	private queue: Promise<void> = Promise.resolve();
	private file: string;
	private now: () => number;

	constructor(homeDir: string, now: () => number = Date.now) {
		this.file = path.join(homeDir, 'state', 'provider-status.json');
		this.now = now;
	}

	async read(): Promise<ProviderStatusRecord[]> {
		return (await this.readSnapshot()).providers;
	}

	async readSnapshot(): Promise<ProviderStatusFile> {
		let stat;
		try {
			stat = await lstat(this.file);
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === 'ENOENT')
				return { generatedAt: null, providers: [] };
			throw error;
		}
		if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink > 1 || stat.size > 1024 * 1024)
			throw new Error('provider-status.json is not a safe regular file');
		const parsed = JSON.parse(await readFile(this.file, 'utf8')) as unknown;
		const root = object(parsed);
		const generatedAt = text(root.generatedAt);
		if (!generatedAt || !Number.isFinite(Date.parse(generatedAt)) || !Array.isArray(root.providers))
			throw new Error('provider-status.json does not match the required status contract');
		return { generatedAt, providers: parseProviderStatus(parsed) };
	}

	update(provider: string, patch: Partial<ProviderStatusRecord>): Promise<void> {
		const run = this.queue.then(() => this.updateNow(provider, patch));
		this.queue = run.catch(() => {});
		return run;
	}

	private async updateNow(provider: string, patch: Partial<ProviderStatusRecord>): Promise<void> {
		const snapshot = await this.readSnapshot();
		let previous = snapshot.providers;
		const today = new Date(this.now()).toISOString().slice(0, 10);
		const generatedDay =
			snapshot.generatedAt && Number.isFinite(Date.parse(snapshot.generatedAt))
				? new Date(snapshot.generatedAt).toISOString().slice(0, 10)
				: null;
		if (generatedDay !== today) {
			previous = previous.map((item) => ({
				...item,
				spend_today_usd: null,
				estimate_remaining_percent: null,
				...(item.provider === 'claude-api' && item.reason === 'Claude API daily spend cap reached'
					? { out_until: null, reason: null }
					: {})
			}));
		}
		const existing = previous.find((item) => item.provider === provider);
		const merged: ProviderStatusRecord = {
			provider,
			out_until: existing?.out_until ?? null,
			reason: existing?.reason ?? null,
			spend_today_usd: existing?.spend_today_usd ?? null,
			cap_usd: existing?.cap_usd ?? null,
			estimate_remaining_percent: existing?.estimate_remaining_percent ?? null,
			...patch
		};
		const providers = previous.filter((item) => item.provider !== provider).concat(merged);
		const stateDir = path.dirname(this.file);
		await mkdir(stateDir, { recursive: true, mode: 0o700 });
		const temporary = `${this.file}.${randomUUID()}.tmp`;
		const content: ProviderStatusFile = {
			generatedAt: new Date(this.now()).toISOString(),
			providers: providers.sort((a, b) => a.provider.localeCompare(b.provider))
		};
		let handle: Awaited<ReturnType<typeof open>> | null = null;
		try {
			handle = await open(temporary, 'wx', 0o600);
			await handle.writeFile(`${JSON.stringify(content, null, 2)}\n`, 'utf8');
			await handle.sync();
			await handle.close();
			handle = null;
			await rename(temporary, this.file);
			const dir = await open(stateDir, 'r').catch(() => null);
			if (dir) {
				await dir.sync().catch(() => {});
				await dir.close();
			}
		} catch (error) {
			await handle?.close().catch(() => {});
			await unlink(temporary).catch(() => {});
			throw error;
		}
	}
}

export class ProviderSwitcher {
	private store: ProviderStatusStore;
	private now: () => number;
	private env: NodeJS.ProcessEnv;
	private controlFile: string;
	private inFlight = new Set<string>();
	private attempted = new Set<string>();
	private seenErrors = new Set<string>();
	private lastSpendWrite = Number.NEGATIVE_INFINITY;
	private adapter: ProviderSwitcherOptions['adapter'];
	private log: (message: string) => void;

	constructor(private opts: ProviderSwitcherOptions) {
		this.now = opts.now ?? Date.now;
		this.store = new ProviderStatusStore(opts.homeDir, this.now);
		this.env = { ...scriptEnv(opts.env ?? process.env), FM_HOME: opts.homeDir };
		this.controlFile = opts.controlFile ?? path.join(opts.firstmateDir, 'bin', 'fm-control.sh');
		this.adapter = opts.adapter;
		this.log = opts.log ?? ((message) => console.warn(`Provider switching: ${message}`));
	}

	async observe(fleet: FleetView): Promise<void> {
		await this.writeClaudeCap();
		const tasks = fleet.tasks.filter(
			(task) => !task.secondMate && (task.worker?.harness ?? '') !== '' && isWorkerStopped(task)
		);
		await Promise.all(
			tasks.map(async (task) => {
				if (await isLocalTmuxWorker(this.opts.homeDir, task.id))
					await this.inspectStoppedTask(task);
			})
		);
	}

	private async writeClaudeCap(): Promise<void> {
		const now = this.now();
		if (now - this.lastSpendWrite < 60_000) return;
		this.lastSpendWrite = now;
		try {
			const snapshot = await this.store.readSnapshot();
			const record = snapshot.providers.find((provider) => provider.provider === 'claude-api');
			const today = new Date(now).toISOString().slice(0, 10);
			const snapshotAt = snapshot.generatedAt ? Date.parse(snapshot.generatedAt) : NaN;
			const snapshotDay = Number.isFinite(snapshotAt)
				? new Date(snapshotAt).toISOString().slice(0, 10)
				: null;
			const patch: Partial<ProviderStatusRecord> = { cap_usd: STATUS_CAP_USD };
			if (
				snapshotDay !== today &&
				record?.spend_today_usd !== null &&
				record?.spend_today_usd !== undefined
			) {
				patch.spend_today_usd = null;
				patch.estimate_remaining_percent = null;
				if (record.reason === 'Claude API daily spend cap reached') {
					patch.out_until = null;
					patch.reason = null;
				}
			}
			if (
				snapshotDay === today &&
				record?.spend_today_usd !== null &&
				record?.spend_today_usd !== undefined
			) {
				patch.estimate_remaining_percent = Math.max(
					0,
					Math.min(100, ((STATUS_CAP_USD - record.spend_today_usd) / STATUS_CAP_USD) * 100)
				);
				if (record.spend_today_usd >= STATUS_CAP_USD) {
					const date = new Date(now);
					patch.out_until = new Date(
						Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + 1)
					).toISOString();
					patch.reason = 'Claude API daily spend cap reached';
				}
			}
			// Visible token counts have no authoritative token-price source in Wheelhouse, so do not invent a USD estimate.
			await this.store.update('claude-api', patch);
		} catch (error) {
			this.log(`could not update Claude API headroom: ${(error as Error).message}`);
		}
	}

	private async inspectStoppedTask(task: TaskSummary): Promise<void> {
		if (this.inFlight.has(task.id)) return;
		this.inFlight.add(task.id);
		try {
			const terminal = task.outputAvailable ? await this.adapter.peek(task.id, 80) : null;
			const lines = terminal?.ok ? terminal.value.lines : [];
			const output = [task.summaryRaw, task.activity?.text, ...lines].filter(Boolean).join('\n');
			if (!output) return;
			const rules = await readDispatch(this.opts.homeDir);
			const current = this.currentProfile(task, rules);
			if (!current) return;
			const failure = classifyFailure(output, current.provider, this.now());
			if (!failure) return;
			const fingerprint = createHash('sha256')
				.update(`${task.id}\0${current.provider}\0${output}`)
				.digest('hex');
			const errorKey = `${task.id}:${fingerprint}`;
			if (this.seenErrors.has(errorKey)) return;
			this.seenErrors.add(errorKey);
			const now = this.now();
			const previousStatuses = await this.store.read();
			const old = previousStatuses.find((item) => item.provider === failure.provider);
			const oldOut = old?.out_until ? Date.parse(old.out_until) : NaN;
			const resetAt =
				Number.isFinite(oldOut) && oldOut > Date.parse(failure.resetAt)
					? old!.out_until!
					: failure.resetAt;
			await this.store.update(failure.provider, { out_until: resetAt, reason: failure.reason });
			if (!(await this.opts.automaticSwitching())) return;
			const rule = this.matchedRule(rules, current);
			if (!rule) return;
			const views = this.opts.providerViews();
			const providerStatus = new Map(
				(await this.store.read()).map((item) => [item.provider, item])
			);
			const candidates = rule.use
				.filter((profile) => PROVIDER_ORDER.includes(profile.provider))
				.filter((profile) => !outUntil(providerStatus.get(profile.provider), now))
				.filter((profile) => profile.provider !== current.provider)
				.filter((profile) => profile.provider !== 'openrouter' || openRouterReady(views))
				.sort((a, b) => PROVIDER_ORDER.indexOf(a.provider) - PROVIDER_ORDER.indexOf(b.provider));
			const next = candidates[0];
			if (!next) return;
			const attemptKey = `${task.id}:${current.provider}:${task.worker?.harness}:${task.worker?.model}:${resetAt}`;
			if (this.attempted.has(attemptKey)) return;
			this.attempted.add(attemptKey);
			const note = `Provider ${failure.provider} is out until ${resetAt} (${failure.reason}); switch ${task.id} from ${current.provider} to ${next.provider}.`;
			const args = [
				task.id,
				'relaunch',
				'--harness',
				next.harness,
				'--model',
				next.model ?? 'default',
				'--effort',
				next.effort ?? 'default',
				'--note',
				note
			];
			const result = await runBounded(this.controlFile, args, {
				env: this.env,
				timeoutMs: 30_000,
				maxOutputBytes: 64 * 1024
			});
			if (!result.ok) {
				this.log(`could not relaunch ${task.id} through fm-control.sh: ${result.message}`);
				return;
			}
			const requestId = `provider-switch:${fingerprint.slice(0, 64)}`;
			const sent = await this.adapter.note(requestId, `Task ${task.id}: ${note}`);
			if (!sent.ok)
				this.log(`relaunch of ${task.id} succeeded, but its Firstmate note was not delivered.`);
		} catch (error) {
			this.log(`could not inspect ${task.id}: ${(error as Error).message}`);
		} finally {
			this.inFlight.delete(task.id);
		}
	}

	private currentProfile(task: TaskSummary, rules: DispatchRule[]): DispatchProfile | null {
		const harness = task.worker?.harness;
		if (!harness) return null;
		const model = task.worker?.modelKnown ? task.worker.model : null;
		const matching = rules.flatMap((rule) =>
			rule.use.filter((profile) => profile.harness === harness && profile.model === model)
		);
		return matching.length === 1 ? matching[0] : null;
	}

	private matchedRule(rules: DispatchRule[], current: DispatchProfile): DispatchRule | null {
		const matches = rules.filter((rule) =>
			rule.use.some((profile) => sameProfile(profile, current))
		);
		return matches.length === 1 ? matches[0] : null;
	}
}
