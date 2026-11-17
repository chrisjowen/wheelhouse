import { existsSync } from 'node:fs';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { digest, type AlertDraft } from '../../bell';
import {
	bySeverity,
	parseSoundingsSettings,
	SOUNDINGS_SCHEMA,
	type Finding,
	type FindingDraft,
	type MachineSample,
	type PageSignal,
	type PageSignalKind,
	type ProcessVitals,
	type Report,
	type SoundingsSettings,
	type SoundingsView
} from '../../soundings';
import type { RunOptions, RunResult } from '../firstmate/exec';
import type { HelperDeps, HelperFailure, Run } from '../previewhelper';
import { maskSecrets } from './mask';
import type { ProbeOptions } from './probe';
import {
	median,
	readReport,
	REPORT_SCHEMA,
	REPORT_SYSTEM,
	reportPrompt,
	type Normal
} from './report';
import { evaluate, scanPoint, type ScanPoint, type VitalsPoint } from './rules';

/**
 * Soundings, running (see lib/soundings.ts for what it is). While the
 * experimental feature is on it:
 *
 * - scans the computer every few minutes (settings.scanMinutes) in a process
 *   of its own under `nice` (dist/soundings-probe.js, built from
 *   probe-main.ts), never in Wheelhouse's server or Firstmate's loop;
 * - runs the rules (rules.ts) every minute over the latest scan, Wheelhouse's
 *   vitals and its pages' trouble, opening, keeping and clearing findings by
 *   id, and rings the ship's bell when one that wants a look opens;
 * - writes a report (report.ts) about hourly, or soon after a new finding
 *   opens, ringing the bell for an hourly one that wants a look;
 * - takes in the trouble Wheelhouse's own pages report (client/beacon.ts),
 *   within a rate limit.
 *
 * It keeps its findings, scans and reports in Wheelhouse's state directory
 * (`soundings/`), on this computer only, and its settings in the config
 * directory (`soundings.json`). It never stops, restarts or deletes anything.
 */

export interface SoundingsDeps {
	stateDir: string;
	configDir: string;
	/** Whether the feature is on now. */
	enabled: () => Promise<boolean>;
	vitals: () => ProcessVitals;
	vitalsHistory: () => VitalsPoint[];
	/** The physical footprint the latest scan read, for the vitals. */
	setFootprint: (bytes: number | null) => void;
	ring: (draft: AlertDraft) => void;
	/** Run a command (runBounded). */
	run: (file: string, args: string[], opts: RunOptions) => Promise<RunResult>;
	/** The built probe (dist/soundings-probe.js), or null to scan in this process. */
	probeFile: string | null;
	/** A scan done in this process (a development server without the built probe). */
	scanHere: (opts: ProbeOptions) => Promise<MachineSample>;
	/** The report's runner (previewhelper's runHelper) and its dependencies. */
	runHelper: (
		input: string,
		dirs: string[],
		o: Run,
		deps: HelperDeps
	) => Promise<{ ok: true; stdout: string } | HelperFailure>;
	helperDeps: HelperDeps;
	env: NodeJS.ProcessEnv;
	now?: () => number;
	log?: (line: string) => void;
}

interface SavedState {
	history: ScanPoint[];
	findings: Finding[];
	cleared: Finding[];
	muted: string[];
	lastReportAt: number | null;
	lastRungReport: string | null;
}

const SETTINGS_FILE = 'soundings.json';
const MINUTE = 60_000;
/** Scans remembered in full (with each process's CPU time) this long, and for what is normal this long. */
const DETAIL_MS = 3 * 3600_000;
const NORMAL_MS = 24 * 3600_000;
const MAX_CLEARED = 60;
const MAX_REPORTS = 60;
const MAX_SIGNALS = 300;
/** Page trouble taken in per ten minutes, at most; the rest is dropped. */
const SIGNAL_BUDGET = 200;
/** Soonest a new finding brings a report after the last one. */
const REPORT_GAP_MS = 10 * MINUTE;
const PROBE_TIMEOUT_MS = 90_000;
const REPORT_TIMEOUT_MS = 120_000;
const SIGNAL_KINDS: PageSignalKind[] = [
	'exception',
	'resource',
	'console',
	'network',
	'longtask',
	'stuck'
];

export class SoundingsService {
	private d: SoundingsDeps;
	private now: () => number;
	private dir: string;
	private settings: SoundingsSettings = parseSoundingsSettings(null);
	private state: SavedState = {
		history: [],
		findings: [],
		cleared: [],
		muted: [],
		lastReportAt: null,
		lastRungReport: null
	};
	private machine: MachineSample | null = null;
	private reports: Report[] = [];
	private signals: PageSignal[] = [];
	private signalWindow = { start: 0, taken: 0 };
	private loaded: Promise<void> | null = null;
	private timer: ReturnType<typeof setInterval> | null = null;
	private scanning: Promise<void> | null = null;
	private writing: Promise<void> | null = null;
	private lastScanAt = 0;
	private problem: string | null = null;
	/** The feature was on at the last look (vitals' tidy-up asks this). */
	on = false;

	constructor(deps: SoundingsDeps) {
		this.d = deps;
		this.now = deps.now ?? Date.now;
		this.dir = path.join(deps.stateDir, 'soundings');
	}

	/** Look every minute: scan when one is due, run the rules, write a report when one is due. */
	start(): void {
		if (this.timer) return;
		this.timer = setInterval(() => void this.tick().catch((e) => this.log(e)), MINUTE);
		this.timer.unref?.();
		void this.tick().catch((e) => this.log(e));
	}

	stop(): void {
		if (this.timer) clearInterval(this.timer);
		this.timer = null;
	}

	private log(e: unknown): void {
		(this.d.log ?? console.warn)(`Soundings: ${e instanceof Error ? e.message : String(e)}`);
	}

	/** One minute's look. Exported for tests through the instance. */
	async tick(): Promise<void> {
		await this.load();
		this.on = await this.d.enabled();
		if (!this.on) return;
		this.settings = await this.readSettings();
		if (this.now() - this.lastScanAt >= this.settings.scanMinutes * MINUTE) await this.scan();
		else this.judge();
		await this.reportIfDue();
	}

	/* ------------------------------------------------------------ the scan */

	/** Scan now (unless one is running), then run the rules. */
	scan(): Promise<void> {
		this.scanning ??= this.doScan().finally(() => (this.scanning = null));
		return this.scanning;
	}

	private async doScan(): Promise<void> {
		this.lastScanAt = this.now();
		const opts: ProbeOptions = { wheelhousePid: process.pid, logDirs: this.settings.logDirs };
		let sample: MachineSample;
		try {
			sample = await this.probe(opts);
		} catch (e) {
			this.problem = `The scan failed: ${e instanceof Error ? e.message : String(e)}`;
			this.log(this.problem);
			return;
		}
		this.problem = null;
		if (this.machine) this.state.history.push(scanPoint(this.machine));
		this.machine = sample;
		this.d.setFootprint(sample.footprintBytes);
		this.prune();
		this.judge();
		await this.save();
		await this.writeJson('latest.json', sample);
	}

	private async probe(opts: ProbeOptions): Promise<MachineSample> {
		const custom = this.d.env.WHEELHOUSE_SOUNDINGS_PROBE;
		const file = custom || this.d.probeFile;
		if (!file) return this.d.scanHere(opts);
		const node = /\.(m?js|cjs)$/.test(file);
		// The built probe runs under nice; a stand-in (tests, a demo) runs as given.
		const [cmd, args] = custom
			? node
				? [process.execPath, [file]]
				: [file, []]
			: ['nice', ['-n', '10', process.execPath, file]];
		const r = await this.d.run(cmd, args, {
			cwd: tmpdir(),
			env: this.d.env,
			input: JSON.stringify(opts),
			timeoutMs: PROBE_TIMEOUT_MS,
			maxOutputBytes: 16 * 1024 * 1024
		});
		if (!r.ok) throw new Error(r.kind === 'timeout' ? 'it took too long' : 'the probe failed');
		const sample = JSON.parse(r.stdout) as MachineSample;
		if (!sample || typeof sample.at !== 'string' || !Array.isArray(sample.processes))
			throw new Error('the probe answered something unreadable');
		return sample;
	}

	/** Keep full detail for a few hours, and the load and memory for a day. */
	private prune(): void {
		const now = this.now();
		this.state.history = this.state.history
			.filter((p) => now - p.at <= NORMAL_MS)
			.map((p) =>
				now - p.at > DETAIL_MS && Object.keys(p.cpu).length ? { ...p, cpu: {}, runs: {} } : p
			);
	}

	/* ------------------------------------------------------------ the rules */

	/** Run the rules and open, keep or clear findings. */
	private judge(): void {
		const now = this.now();
		const drafts = evaluate(
			{
				now,
				machine: this.machine,
				history: this.state.history,
				vitals: this.d.vitals(),
				vitalsHistory: this.d.vitalsHistory(),
				signals: this.signals
			},
			this.settings
		);
		this.merge(drafts, now);
	}

	private merge(drafts: FindingDraft[], now: number): void {
		const at = new Date(now).toISOString();
		const open = new Map(this.state.findings.map((f) => [f.id, f]));
		const next: Finding[] = [];
		const opened: Finding[] = [];
		for (const draft of drafts) {
			const was = open.get(draft.id);
			if (was) {
				next.push({ ...was, ...draft, lastSeen: at });
				open.delete(draft.id);
			} else {
				const f: Finding = { ...draft, firstSeen: at, lastSeen: at, closedAt: null };
				next.push(f);
				opened.push(f);
			}
		}
		for (const gone of open.values()) this.state.cleared.unshift({ ...gone, closedAt: at });
		this.state.cleared = this.state.cleared.slice(0, MAX_CLEARED);
		this.state.findings = next.sort(bySeverity);
		for (const f of opened) {
			if (f.severity === 'info' || this.state.muted.includes(f.id)) continue;
			this.d.ring(findingAlert(f));
			this.wantReport = true;
		}
	}

	/* ------------------------------------------------------------ reports */

	private wantReport = false;

	private async reportIfDue(): Promise<void> {
		if (!this.machine || this.writing) return;
		const since =
			this.state.lastReportAt === null ? Infinity : this.now() - this.state.lastReportAt;
		if (since >= this.settings.reportMinutes * MINUTE) await this.report('hourly');
		else if (this.wantReport && since >= REPORT_GAP_MS) await this.report('finding');
	}

	/** Write a report now (unless one is being written). */
	report(trigger: Report['trigger']): Promise<void> {
		this.writing ??= this.doReport(trigger).finally(() => (this.writing = null));
		return this.writing;
	}

	private async doReport(trigger: Report['trigger']): Promise<void> {
		this.wantReport = false;
		this.state.lastReportAt = this.now();
		const r = await this.d.runHelper(
			reportPrompt(this.context()),
			[],
			{
				system: REPORT_SYSTEM,
				schema: REPORT_SCHEMA,
				read: false,
				model: this.settings.model,
				timeoutMs: REPORT_TIMEOUT_MS
			},
			this.d.helperDeps
		);
		if (!r.ok) {
			this.problem = `The report could not be written: ${r.error.replace(/preview helper/g, 'report')}`;
			await this.save();
			return;
		}
		const out = readReport(r.stdout);
		if (!out) {
			this.problem = 'The report could not be read. It will be tried again.';
			await this.save();
			return;
		}
		this.problem = null;
		const report: Report = {
			id: randomUUID(),
			at: new Date(this.now()).toISOString(),
			trigger,
			model: this.settings.model,
			...out
		};
		this.reports = [report, ...this.reports].slice(0, MAX_REPORTS);
		await this.writeJson('reports.json', this.reports);
		// An hourly report that wants a look rings, unless it says what the last one that rang said.
		const said = digest(report.items.map((i) => i.title.toLowerCase()).join('|'));
		if (
			trigger === 'hourly' &&
			report.status === 'attention' &&
			said !== this.state.lastRungReport
		) {
			this.state.lastRungReport = said;
			this.d.ring(reportAlert(report));
		}
		await this.save();
	}

	private context() {
		const now = this.now();
		const m = this.machine;
		const cpu = new Map<number, number>();
		const restarts = new Map<string, number>();
		const last = this.state.history.at(-1);
		if (m && last && Object.keys(last.cpu).length) {
			const secs = (Date.parse(m.at) - last.at) / 1000;
			for (const p of m.processes) {
				const before = last.cpu[`${p.pid}:${p.name}`];
				if (before !== undefined && secs > 0)
					cpu.set(p.pid, ((p.cpuSeconds - before) / secs) * 100);
			}
		}
		const hourAgo = m
			? this.state.history.find((p) => Date.parse(m.at) - p.at <= 3600_000 + MINUTE)
			: undefined;
		if (m && hourAgo)
			for (const s of m.services)
				if (s.runs !== null && hourAgo.runs[s.label] !== undefined)
					restarts.set(s.label, Math.max(0, s.runs - hourAgo.runs[s.label]));
		const day = [...this.state.history, ...(m ? [scanPoint(m)] : [])];
		const normal: Normal = {
			scans: day.length,
			load: median(day.map((p) => p.load).filter((n) => Number.isFinite(n))),
			availablePercent: median(
				day.map((p) => p.availablePercent).filter((n): n is number => n !== null)
			)
		};
		return {
			now,
			machine: m,
			cpu,
			restarts,
			vitals: this.d.vitals(),
			findings: this.state.findings,
			signals: this.signals,
			normal,
			previous: this.reports[0] ?? null
		};
	}

	/* ------------------------------------------------------- page trouble */

	/**
	 * Trouble a Wheelhouse page reported: kept (masked, cut short) while the
	 * feature is on, within a rate limit. How many were taken.
	 */
	async receive(batch: unknown): Promise<number> {
		if (!this.on || !Array.isArray(batch)) return 0;
		const now = this.now();
		if (now - this.signalWindow.start > 10 * MINUTE) this.signalWindow = { start: now, taken: 0 };
		const at = new Date(now).toISOString();
		const taken: PageSignal[] = [];
		for (const raw of batch.slice(0, 30)) {
			if (this.signalWindow.taken >= SIGNAL_BUDGET) break;
			const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
			if (!SIGNAL_KINDS.includes(r.kind as PageSignalKind) || typeof r.message !== 'string')
				continue;
			const count =
				typeof r.count === 'number' && r.count >= 1 ? Math.min(Math.floor(r.count), 1000) : 1;
			taken.push({
				at,
				kind: r.kind as PageSignalKind,
				message: maskSecrets(r.message.replace(/\s+/g, ' ').trim()).slice(0, 300),
				page: typeof r.page === 'string' ? r.page.split('?')[0].slice(0, 120) : '/',
				count
			});
			this.signalWindow.taken++;
		}
		this.signals = [...taken.reverse(), ...this.signals].slice(0, MAX_SIGNALS);
		return taken.length;
	}

	/* ------------------------------------------------------------- the page */

	async view(): Promise<SoundingsView> {
		await this.load();
		const enabled = await this.d.enabled();
		const settings = await this.readSettings();
		return {
			schema: SOUNDINGS_SCHEMA,
			enabled,
			settings,
			machine: this.machine,
			vitals: this.d.vitals(),
			findings: this.state.findings,
			cleared: this.state.cleared,
			muted: this.state.muted,
			reports: this.reports,
			signals: this.signals.slice(0, 40),
			scanning: this.scanning !== null,
			writing: this.writing !== null,
			problem: this.problem,
			nextScanAt:
				enabled && this.lastScanAt
					? new Date(this.lastScanAt + settings.scanMinutes * MINUTE).toISOString()
					: null
		};
	}

	/** Mute a finding (no bell, listed apart) or unmute it. */
	async mute(id: string, muted: boolean): Promise<void> {
		await this.load();
		this.state.muted = muted
			? [...new Set([...this.state.muted, id])].slice(-200)
			: this.state.muted.filter((m) => m !== id);
		await this.save();
	}

	async saveSettings(raw: unknown): Promise<SoundingsSettings> {
		const settings = parseSoundingsSettings(raw);
		await mkdir(this.d.configDir, { recursive: true });
		const target = path.join(this.d.configDir, SETTINGS_FILE);
		await atomicWrite(target, `${JSON.stringify(settings, null, 2)}\n`);
		this.settings = settings;
		return settings;
	}

	private async readSettings(): Promise<SoundingsSettings> {
		try {
			return parseSoundingsSettings(
				JSON.parse(await readFile(path.join(this.d.configDir, SETTINGS_FILE), 'utf8'))
			);
		} catch {
			return parseSoundingsSettings(null);
		}
	}

	/* ------------------------------------------------------------- storage */

	private load(): Promise<void> {
		this.loaded ??= (async () => {
			const state = await this.readJson<Partial<SavedState>>('state.json');
			if (state)
				this.state = {
					history: Array.isArray(state.history) ? state.history : [],
					findings: Array.isArray(state.findings) ? state.findings : [],
					cleared: Array.isArray(state.cleared) ? state.cleared : [],
					muted: Array.isArray(state.muted) ? state.muted : [],
					lastReportAt: typeof state.lastReportAt === 'number' ? state.lastReportAt : null,
					lastRungReport: typeof state.lastRungReport === 'string' ? state.lastRungReport : null
				};
			const latest = await this.readJson<MachineSample>('latest.json');
			if (latest && typeof latest.at === 'string') {
				this.machine = latest;
				this.lastScanAt = Date.parse(latest.at) || 0;
				this.d.setFootprint(latest.footprintBytes ?? null);
			}
			const reports = await this.readJson<Report[]>('reports.json');
			if (Array.isArray(reports)) this.reports = reports;
		})();
		return this.loaded;
	}

	private save(): Promise<void> {
		return this.writeJson('state.json', this.state);
	}

	private async readJson<T>(name: string): Promise<T | null> {
		try {
			return JSON.parse(await readFile(path.join(this.dir, name), 'utf8')) as T;
		} catch {
			return null;
		}
	}

	private async writeJson(name: string, value: unknown): Promise<void> {
		try {
			await mkdir(this.dir, { recursive: true, mode: 0o700 });
			await atomicWrite(path.join(this.dir, name), JSON.stringify(value));
		} catch (e) {
			this.log(e);
		}
	}
}

async function atomicWrite(target: string, text: string): Promise<void> {
	const temporary = `${target}.${randomUUID()}.tmp`;
	try {
		await writeFile(temporary, text, { mode: 0o600 });
		await rename(temporary, target);
	} catch (error) {
		await unlink(temporary).catch(() => {});
		throw error;
	}
}

/** The built probe beside Wheelhouse's CLI (dist/soundings-probe.js), when it is there. */
export function builtProbe(distDir: string): string | null {
	const file = path.join(distDir, 'soundings-probe.js');
	return existsSync(file) ? file : null;
}

const HEALTH_PAGE = '/health';

/** A finding that wants a look, as a ship's bell alert: it opens again if it clears and comes back. */
export function findingAlert(f: Finding): AlertDraft {
	return {
		id: `health:${f.id}:${f.firstSeen}`,
		kind: 'health',
		taskId: null,
		projectId: null,
		title: 'Soundings',
		captain: f.severity === 'serious',
		text: f.title,
		actions: [
			{ kind: 'open', label: 'Open Health', href: HEALTH_PAGE, external: false },
			...(f.proposal
				? [
						{
							kind: 'note' as const,
							label: f.proposal.label,
							text: f.proposal.note,
							requestId: `wh-soundings-${digest(`${f.id}:${f.firstSeen}`)}`,
							sent: f.proposal.sent
						}
					]
				: [])
		]
	};
}

export function reportAlert(r: Report): AlertDraft {
	return {
		id: `health-report:${r.id}`,
		kind: 'health',
		taskId: null,
		projectId: null,
		title: 'Soundings report',
		captain: false,
		text: r.headline,
		actions: [{ kind: 'open', label: 'Read the report', href: HEALTH_PAGE, external: false }]
	};
}
