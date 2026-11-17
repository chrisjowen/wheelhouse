import type {
	ListenerSample,
	LogSample,
	MachineSample,
	ProcessSample,
	ServiceSample
} from '../../soundings';
import { cleanCommand, tildePath } from './mask';
import {
	devServerName,
	parseDf,
	parseFootprint,
	parseLaunchctlList,
	parseLaunchctlPrint,
	parseLsofListen,
	parseMeminfo,
	parsePressureLevel,
	parsePs,
	parsePsi,
	parseSmapsRollup,
	parseSs,
	parseSwapUsage,
	parseSystemctlShow,
	parseVmStat,
	programName,
	watchedLabel,
	type PsRow
} from './parse';

/**
 * One Soundings scan of the computer: processes, background services,
 * memory, load, disks, large log files and listening dev servers, read with
 * the system's own tools (macOS fully; Linux, best effort, through the same
 * shape). It runs in a process of its own at low priority (probe-main.ts,
 * started by service.ts under `nice`), so a slow tool never holds up
 * Wheelhouse or Firstmate. What it cannot read it notes in `gaps` and carries
 * on.
 *
 * Every command and file read goes through `deps`, so the tests feed it saved
 * output instead of this computer's.
 */

export interface ProbeDeps {
	platform: NodeJS.Platform;
	/** Run a command; its standard output, or null when it failed or is missing. */
	run: (file: string, args: string[]) => Promise<string | null>;
	readFile: (file: string) => Promise<string | null>;
	/** A folder's entries (files and folders), or null when it cannot be read. */
	list: (dir: string) => Promise<{ name: string; dir: boolean; bytes: number }[] | null>;
	home: string;
	uid: number;
	cpus: number;
	totalMem: number;
	load: () => [number, number, number];
	now: () => number;
}

export interface ProbeOptions {
	/** Wheelhouse's own pid, whose footprint is read. */
	wheelhousePid: number | null;
	/** More folders whose log files are watched. */
	logDirs: string[];
}

/** The processes kept in a sample: the busiest and the largest. */
const KEEP_PROCESSES = 40;
/** Launchd jobs looked at closely, at most. */
const MAX_JOBS = 80;
/** A log file is listed when it is at least this large. */
const LOG_LISTED = 50 * 1024 ** 2;
/** How deep under a log folder files are looked for, and how many entries at most. */
const LOG_DEPTH = 3;
const LOG_ENTRIES = 4000;

/** The folders where programs usually keep their logs. */
export function logFolders(platform: NodeJS.Platform, home: string, extra: string[]): string[] {
	const base =
		platform === 'darwin'
			? [`${home}/Library/Logs`, '/Library/Logs', `${home}/.npm/_logs`, `${home}/.pm2/logs`]
			: [`${home}/.local/state`, `${home}/.cache`, `${home}/.npm/_logs`, `${home}/.pm2/logs`];
	return [...new Set([...base, ...extra.map((d) => (d.startsWith('~/') ? home + d.slice(1) : d))])];
}

export async function probe(deps: ProbeDeps, opts: ProbeOptions): Promise<MachineSample> {
	const started = deps.now();
	const gaps: string[] = [];
	const platform =
		deps.platform === 'darwin' ? 'darwin' : deps.platform === 'linux' ? 'linux' : 'other';
	const psText = await deps.run('ps', ['-A', '-o', 'pid=,ppid=,pcpu=,rss=,etime=,time=,args=']);
	const rows = psText ? parsePs(psText) : [];
	if (!psText) gaps.push('the process list (ps)');
	const byPid = new Map(rows.map((r) => [r.pid, r]));

	const [memory, services, listeners, disks, logs, footprintBytes] = await Promise.all([
		platform === 'darwin' ? macMemory(deps, gaps) : linuxMemory(deps, gaps),
		platform === 'darwin'
			? macServices(deps, gaps)
			: platform === 'linux'
				? linuxServices(deps, gaps)
				: Promise.resolve([]),
		listening(deps, platform, byPid, gaps),
		disksOf(deps, gaps),
		bigLogs(deps, logFolders(deps.platform, deps.home, opts.logDirs)),
		opts.wheelhousePid ? footprint(deps, platform, opts.wheelhousePid) : Promise.resolve(null)
	]);

	return {
		at: new Date(started).toISOString(),
		platform,
		cpus: deps.cpus,
		load: deps.load(),
		memory,
		disks,
		processes: keepProcesses(rows, deps.home),
		services,
		listeners,
		logs,
		footprintBytes,
		gaps,
		tookMs: deps.now() - started
	};
}

/**
 * The processes worth keeping: every one that has used real CPU time or
 * holds real memory, the busiest and largest first, up to a limit. The rules
 * compare CPU time between scans, so a process that only now got busy is
 * still compared next time (the busiest by lifetime use are kept too).
 */
export function keepProcesses(rows: PsRow[], home: string): ProcessSample[] {
	const pick = new Map<number, PsRow>();
	const add = (list: PsRow[]) => {
		for (const r of list.slice(0, KEEP_PROCESSES)) pick.set(r.pid, r);
	};
	add([...rows].sort((a, b) => b.pcpu - a.pcpu));
	add([...rows].sort((a, b) => b.rssBytes - a.rssBytes));
	add(
		[...rows].sort(
			(a, b) => b.cpuSeconds / (b.ageSeconds || 1) - a.cpuSeconds / (a.ageSeconds || 1)
		)
	);
	return [...pick.values()].map((r) => ({
		pid: r.pid,
		ppid: r.ppid,
		cpuSeconds: r.cpuSeconds,
		pcpu: r.pcpu,
		rssBytes: r.rssBytes,
		ageSeconds: r.ageSeconds,
		name: programName(r.args),
		command: cleanCommand(r.args, home)
	}));
}

async function macMemory(deps: ProbeDeps, gaps: string[]): Promise<MachineSample['memory']> {
	const [vm, level, swap] = await Promise.all([
		deps.run('vm_stat', []),
		deps.run('sysctl', ['-n', 'kern.memorystatus_vm_pressure_level']),
		deps.run('sysctl', ['-n', 'vm.swapusage'])
	]);
	if (!level) gaps.push('memory pressure (sysctl)');
	const stat = vm ? parseVmStat(vm) : null;
	return {
		totalBytes: deps.totalMem,
		// Free, plus what macOS gives back at once (inactive, speculative and purgeable pages).
		availableBytes: stat
			? (stat.free + stat.inactive + stat.speculative + stat.purgeable) * stat.pageSize
			: null,
		pressure: level ? parsePressureLevel(level) : null,
		swapUsedBytes: swap ? parseSwapUsage(swap) : null
	};
}

async function linuxMemory(deps: ProbeDeps, gaps: string[]): Promise<MachineSample['memory']> {
	const [info, psi] = await Promise.all([
		deps.readFile('/proc/meminfo'),
		deps.readFile('/proc/pressure/memory')
	]);
	if (!info) gaps.push('memory (/proc/meminfo)');
	const m = info ? parseMeminfo(info) : null;
	let pressure = psi ? parsePsi(psi) : null;
	// Without pressure stall information: under 5% available is a warning, under 2% critical.
	if (!pressure && m?.availableBytes != null && m.totalBytes) {
		const share = m.availableBytes / m.totalBytes;
		pressure = share < 0.02 ? 'critical' : share < 0.05 ? 'warn' : 'normal';
	}
	return {
		totalBytes: m?.totalBytes || deps.totalMem,
		availableBytes: m?.availableBytes ?? null,
		pressure,
		swapUsedBytes: m?.swapUsedBytes ?? null
	};
}

async function macServices(deps: ProbeDeps, gaps: string[]): Promise<ServiceSample[]> {
	const list = await deps.run('launchctl', ['list']);
	if (!list) {
		gaps.push('background services (launchctl)');
		return [];
	}
	const jobs = parseLaunchctlList(list)
		.filter((j) => watchedLabel(j.label))
		// Those that last failed first, so they are looked at even past the limit.
		.sort((a, b) => Number((b.status ?? 0) !== 0) - Number((a.status ?? 0) !== 0))
		.slice(0, MAX_JOBS);
	const out: ServiceSample[] = [];
	for (const job of jobs) {
		const text = await deps.run('launchctl', ['print', `gui/${deps.uid}/${job.label}`]);
		const p = text ? parseLaunchctlPrint(text) : null;
		out.push({
			label: job.label,
			runs: p?.runs ?? null,
			lastExit: p?.lastExit ?? job.status,
			pid: p?.pid ?? job.pid,
			state: p?.state ?? null,
			periodic: p?.periodic ?? false,
			program: p?.program ? cleanCommand(p.program, deps.home) : null
		});
	}
	return out;
}

async function linuxServices(deps: ProbeDeps, gaps: string[]): Promise<ServiceSample[]> {
	const units = await deps.run('systemctl', [
		'--user',
		'list-units',
		'--type=service',
		'--all',
		'--no-legend',
		'--plain'
	]);
	if (!units) {
		gaps.push('background services (systemctl --user)');
		return [];
	}
	const names = units
		.split('\n')
		.map((l) => l.trim().split(/\s+/)[0])
		.filter((n) => n && n.endsWith('.service'))
		.slice(0, MAX_JOBS);
	if (!names.length) return [];
	const shown = await deps.run('systemctl', [
		'--user',
		'show',
		'--property=Id,NRestarts,ExecMainStatus,MainPID,ActiveState,SubState,ExecStart,Type',
		...names
	]);
	return (shown ? parseSystemctlShow(shown) : []).map((u) => ({
		...u,
		program: u.program ? cleanCommand(u.program, deps.home) : null
	}));
}

async function listening(
	deps: ProbeDeps,
	platform: MachineSample['platform'],
	byPid: Map<number, PsRow>,
	gaps: string[]
): Promise<ListenerSample[]> {
	const text =
		platform === 'linux'
			? await deps.run('ss', ['-ltnpH'])
			: await deps.run('lsof', ['-nP', '-iTCP', '-sTCP:LISTEN', '-Fpcn']);
	if (text === null) {
		gaps.push('listening ports');
		return [];
	}
	const found = platform === 'linux' ? parseSs(text) : parseLsofListen(text);
	return found
		.filter((l) => l.port >= 1024)
		.map((l) => {
			const row = byPid.get(l.pid);
			const name = row ? programName(row.args) : l.name;
			return {
				pid: l.pid,
				port: l.port,
				name,
				ageSeconds: row?.ageSeconds ?? null,
				dev: devServerName(name)
			};
		});
}

async function disksOf(deps: ProbeDeps, gaps: string[]) {
	const text = await deps.run('df', ['-kP']);
	if (!text) gaps.push('disks (df)');
	return text ? parseDf(text) : [];
}

/** Log files of at least LOG_LISTED under the log folders, the largest first. */
export async function bigLogs(deps: ProbeDeps, dirs: string[]): Promise<LogSample[]> {
	const out: LogSample[] = [];
	let budget = LOG_ENTRIES;
	const walk = async (dir: string, depth: number) => {
		if (budget <= 0) return;
		const entries = await deps.list(dir);
		if (!entries) return;
		budget -= entries.length;
		for (const e of entries) {
			const full = `${dir}/${e.name}`;
			if (e.dir) {
				if (depth < LOG_DEPTH) await walk(full, depth + 1);
			} else if (e.bytes >= LOG_LISTED)
				out.push({ path: tildePath(full, deps.home), bytes: e.bytes });
		}
	};
	for (const dir of dirs) await walk(dir, 1);
	return out.sort((a, b) => b.bytes - a.bytes).slice(0, 20);
}

async function footprint(
	deps: ProbeDeps,
	platform: MachineSample['platform'],
	pid: number
): Promise<number | null> {
	if (platform === 'darwin') {
		const text = await deps.run('footprint', [String(pid)]);
		return text ? parseFootprint(text) : null;
	}
	if (platform === 'linux') {
		const text = await deps.readFile(`/proc/${pid}/smaps_rollup`);
		return text ? parseSmapsRollup(text) : null;
	}
	return null;
}
