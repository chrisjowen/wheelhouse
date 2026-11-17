/**
 * Soundings: Wheelhouse's health check of the computer it runs on and of
 * itself (the experimental `soundings` feature). This file is what the server
 * (server/soundings) and the Health page share: what a scan finds, the
 * findings its rules raise, the reports written about them, and the settings.
 *
 * A scan runs every few minutes in a separate, low-priority process; plain
 * rules turn it into findings at once (a service restarting hundreds of times
 * an hour, a disk nearly full), and about hourly, or when a new finding
 * opens, a cheap AI pass writes a short report in plain words. Nothing is
 * ever stopped, restarted or deleted for the captain: a fix is offered as a
 * request to Firstmate, sent only when the captain taps it. Process details
 * stay on this computer, and secrets in command lines are masked before
 * anything reaches the AI.
 */

export const SOUNDINGS_SCHEMA = 'wheelhouse-soundings.v1';

/* ----------------------------------------------------------------- the scan */

/** One process, as `ps` saw it. */
export interface ProcessSample {
	pid: number;
	ppid: number;
	/** CPU time used since it started, in seconds. */
	cpuSeconds: number;
	/** `ps`'s own CPU percentage (a recent average on macOS, a lifetime one on Linux). */
	pcpu: number;
	rssBytes: number;
	/** How long it has been running, in seconds. */
	ageSeconds: number;
	/** Its program's name (the command line's first word, without its folder). */
	name: string;
	/** Its command line, masked (see server/soundings/mask.ts) and cut short. */
	command: string;
}

/** A background service (a launchd agent on macOS, a systemd user unit on Linux). */
export interface ServiceSample {
	label: string;
	/** How many times it has been started since login (launchd `runs`, systemd `NRestarts`). */
	runs: number | null;
	/** How it last exited (0 is a clean exit). */
	lastExit: number | null;
	pid: number | null;
	/** running, not running, failed, … as the service manager says. */
	state: string | null;
	/** Started on a timer (launchd StartInterval): its runs are expected, not restarts. */
	periodic: boolean;
	/** The program it runs, masked. */
	program: string | null;
}

/** A program listening on a TCP port: a dev or preview server, often. */
export interface ListenerSample {
	pid: number;
	port: number;
	name: string;
	ageSeconds: number | null;
	/** Looks like a development server (node, python, a Vite or Next server, …). */
	dev: boolean;
}

export interface DiskSample {
	mount: string;
	sizeBytes: number;
	availBytes: number;
}

export interface LogSample {
	/** The file's path, with the home folder shown as ~. */
	path: string;
	bytes: number;
}

export type MemoryPressure = 'normal' | 'warn' | 'critical';

export interface MachineSample {
	at: string;
	platform: 'darwin' | 'linux' | 'other';
	cpus: number;
	load: [number, number, number];
	memory: {
		totalBytes: number;
		/** Free for new work without swapping, when the system says (Linux MemAvailable). */
		availableBytes: number | null;
		pressure: MemoryPressure | null;
		swapUsedBytes: number | null;
	};
	disks: DiskSample[];
	processes: ProcessSample[];
	services: ServiceSample[];
	listeners: ListenerSample[];
	logs: LogSample[];
	/** Wheelhouse's own physical footprint (macOS `footprint`, Linux PSS), when it could be read. */
	footprintBytes: number | null;
	/** What could not be read this time, in plain words. */
	gaps: string[];
	/** How long the scan took, in milliseconds. */
	tookMs: number;
}

/* ------------------------------------------------------- Wheelhouse itself */

/** Wheelhouse's own server process, as /api/health shows it. */
export interface ProcessVitals {
	at: string;
	pid: number;
	uptimeSeconds: number;
	rssBytes: number;
	heapUsedBytes: number;
	/** The heap left after the last full garbage collection: what it really holds on to. */
	postGcHeapBytes: number | null;
	/** Physical footprint, from the last scan (null until one has run, or where unreadable). */
	footprintBytes: number | null;
	/** The 99th percentile of the event loop's delay over the last minute, in milliseconds. */
	eventLoopP99Ms: number;
	/** Live streams open to pages (the fleet's event stream, chats). */
	streams: number;
	/** The chat followers (Firstmate's chat and each worker's). */
	chatFeeds: { count: number; listening: number; watchers: number; orphans: number };
	/** Child processes Wheelhouse started in the last minute. */
	childrenPerMinute: number;
	/** How long the last fleet snapshot took, in milliseconds. */
	lastSnapshotMs: number | null;
	load: [number, number, number];
}

/* --------------------------------------------------------- Wheelhouse pages */

export type PageSignalKind =
	'exception' | 'resource' | 'console' | 'network' | 'longtask' | 'stuck';

/** Trouble a Wheelhouse page reported (the beacon, client/beacon.ts). */
export interface PageSignal {
	at: string;
	kind: PageSignalKind;
	message: string;
	/** The page's path. */
	page: string;
	/** How many times it happened in the batch it came in. */
	count: number;
}

/* ----------------------------------------------------------------- findings */

export type Severity = 'info' | 'warning' | 'serious';

export type RuleId =
	| 'crash-loop'
	| 'cpu-hog'
	| 'memory-hog'
	| 'memory-pressure'
	| 'low-disk'
	| 'big-log'
	| 'old-dev-server'
	| 'wheelhouse-memory'
	| 'event-loop'
	| 'slow-snapshot'
	| 'orphan-watchers'
	| 'page-trouble';

/**
 * What a finding offers the captain: a request to Firstmate (sent only when
 * tapped), never an action taken on its own.
 */
export interface Proposal {
	label: string;
	/** The note sent to Firstmate. */
	note: string;
	/** Shown once Firstmate has it. */
	sent: string;
}

export interface Finding {
	/** Stable for the same problem on the same thing: `<rule>:<subject>`. */
	id: string;
	rule: RuleId;
	severity: Severity;
	/** What it is about (a service's label, a process, a disk). */
	subject: string;
	title: string;
	/** What was seen, in plain words. */
	detail: string;
	firstSeen: string;
	lastSeen: string;
	/** When it cleared; null while it is open. */
	closedAt: string | null;
	proposal: Proposal | null;
}

/** A finding as a rule sees it this scan, before it is matched to what was already open. */
export type FindingDraft = Omit<Finding, 'firstSeen' | 'lastSeen' | 'closedAt'>;

/* ------------------------------------------------------------------ reports */

export interface ReportItem {
	title: string;
	/** What it most likely comes from. */
	cause: string;
	/** What the captain could do about it. */
	fix: string;
}

export interface Report {
	id: string;
	at: string;
	trigger: 'hourly' | 'finding' | 'manual';
	model: string;
	/** All is well, or something wants a look. */
	status: 'ok' | 'attention';
	headline: string;
	summary: string;
	items: ReportItem[];
}

/* ----------------------------------------------------------------- settings */

export interface SoundingsSettings {
	/** Minutes between scans. */
	scanMinutes: number;
	/** Minutes between reports when nothing new opens. */
	reportMinutes: number;
	/** The model the report uses. */
	model: string;
	/** A service restarting more often than this an hour is crash-looping. */
	restartsPerHour: number;
	/** A process using more than this much of one core … */
	cpuPercent: number;
	/** … for this many minutes is hogging it. */
	cpuMinutes: number;
	/** A process holding more than this much memory (GB). */
	processMemoryGb: number;
	/** A disk with less than this share free (percent). */
	diskFreePercent: number;
	/** A log file larger than this (GB). */
	logGb: number;
	/** A dev server left listening longer than this (days). */
	devServerDays: number;
	/** Wheelhouse's own footprint, or its heap after collection, above this (MB). */
	wheelhouseMemoryMb: number;
	/** The event loop's p99 delay above this (ms) … */
	eventLoopMs: number;
	/** … for this many minutes. */
	eventLoopMinutes: number;
	/** A fleet snapshot slower than this (seconds) … */
	snapshotSeconds: number;
	/** … for this many minutes. */
	snapshotMinutes: number;
	/** More folders whose log files are watched, besides the usual ones. */
	logDirs: string[];
}

export const DEFAULT_SOUNDINGS_SETTINGS: SoundingsSettings = {
	scanMinutes: 5,
	reportMinutes: 60,
	model: 'haiku',
	restartsPerHour: 30,
	cpuPercent: 90,
	cpuMinutes: 10,
	processMemoryGb: 8,
	diskFreePercent: 10,
	logGb: 1,
	devServerDays: 3,
	wheelhouseMemoryMb: 1500,
	eventLoopMs: 200,
	eventLoopMinutes: 5,
	snapshotSeconds: 15,
	snapshotMinutes: 10,
	logDirs: []
};

/** Each number setting's allowed range. */
export const SETTING_RANGES: Record<
	Exclude<keyof SoundingsSettings, 'model' | 'logDirs'>,
	[number, number]
> = {
	scanMinutes: [1, 120],
	reportMinutes: [10, 1440],
	restartsPerHour: [2, 100_000],
	cpuPercent: [10, 6400],
	cpuMinutes: [1, 240],
	processMemoryGb: [0.5, 1024],
	diskFreePercent: [1, 90],
	logGb: [0.05, 1024],
	devServerDays: [0.5, 365],
	wheelhouseMemoryMb: [100, 65_536],
	eventLoopMs: [20, 10_000],
	eventLoopMinutes: [1, 120],
	snapshotSeconds: [1, 600],
	snapshotMinutes: [1, 240]
};

/** Settings as stored or sent, with anything missing, malformed or out of range at its default. */
export function parseSoundingsSettings(raw: unknown): SoundingsSettings {
	const v = (raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}) as Record<
		string,
		unknown
	>;
	const out: SoundingsSettings = { ...DEFAULT_SOUNDINGS_SETTINGS, logDirs: [] };
	for (const [key, [min, max]] of Object.entries(SETTING_RANGES)) {
		const n = v[key];
		if (typeof n === 'number' && Number.isFinite(n) && n >= min && n <= max)
			(out as unknown as Record<string, number>)[key] = n;
	}
	if (typeof v.model === 'string' && /^[\w.:-]{1,80}$/.test(v.model.trim()))
		out.model = v.model.trim();
	if (Array.isArray(v.logDirs))
		out.logDirs = v.logDirs
			.filter((d): d is string => typeof d === 'string' && d.trim().length > 0)
			.map((d) => d.trim())
			.slice(0, 20);
	return out;
}

/* --------------------------------------------------------------------- view */

/** What the Health page shows. */
export interface SoundingsView {
	schema: typeof SOUNDINGS_SCHEMA;
	enabled: boolean;
	settings: SoundingsSettings;
	/** The latest scan, trimmed for the page; null before the first. */
	machine: MachineSample | null;
	vitals: ProcessVitals | null;
	/** Open findings, the most serious first. */
	findings: Finding[];
	/** Findings that cleared lately, newest first. */
	cleared: Finding[];
	/** Findings the captain muted, by id. */
	muted: string[];
	/** Reports, newest first. */
	reports: Report[];
	/** Trouble Wheelhouse's pages reported lately, newest first. */
	signals: PageSignal[];
	scanning: boolean;
	writing: boolean;
	/** Why the last scan or report failed, if it did. */
	problem: string | null;
	nextScanAt: string | null;
}

/* ------------------------------------------------------------ plain words */

const SEVERITY_ORDER: Record<Severity, number> = { serious: 0, warning: 1, info: 2 };

/** The most serious first, then the newest. */
export function bySeverity(a: Finding, b: Finding): number {
	return (
		SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] ||
		Date.parse(b.firstSeen) - Date.parse(a.firstSeen)
	);
}

export function severityLabel(s: Severity): string {
	return s === 'serious' ? 'Serious' : s === 'warning' ? 'Worth a look' : 'For the record';
}

/** 1.4 GB, 320 MB, 12 KB. */
export function bytes(n: number | null | undefined): string {
	if (n === null || n === undefined || !Number.isFinite(n)) return '—';
	const units = ['B', 'KB', 'MB', 'GB', 'TB'];
	let v = n;
	let i = 0;
	while (v >= 1024 && i < units.length - 1) {
		v /= 1024;
		i++;
	}
	return `${v >= 100 || i === 0 ? Math.round(v) : v.toFixed(1)} ${units[i]}`;
}

/** 3 days, 5 hours, 12 minutes, 40 seconds. */
export function span(seconds: number): string {
	const s = Math.max(0, Math.round(seconds));
	const unit = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;
	if (s >= 2 * 86400) return unit(Math.round(s / 86400), 'day');
	if (s >= 2 * 3600) return unit(Math.round(s / 3600), 'hour');
	if (s >= 120) return unit(Math.round(s / 60), 'minute');
	return unit(s, 'second');
}
