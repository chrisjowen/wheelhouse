import type { DiskSample, MemoryPressure } from '../../soundings';

/**
 * Reading what the system tools print, for Soundings' scan (probe.ts). Pure
 * functions over text, so each is tested on saved output (parse.test.ts)
 * rather than on the computer the tests run on. macOS first; the Linux
 * readers sit behind the same shapes.
 */

/** A `ps` duration: `[dd-][hh:]mm:ss[.ss]` (etime on both, cputime on Linux) or `mmm:ss.ss` (cputime on macOS). */
export function parseDuration(text: string): number {
	const t = text.trim();
	if (!t) return 0;
	const [daysPart, rest] = t.includes('-') ? t.split('-', 2) : ['0', t];
	const parts = rest.split(':').map(Number);
	if (parts.some((n) => !Number.isFinite(n))) return 0;
	let seconds = 0;
	for (const [i, n] of parts.reverse().entries()) seconds += n * 60 ** i;
	return Number(daysPart) * 86400 + seconds;
}

export interface PsRow {
	pid: number;
	ppid: number;
	pcpu: number;
	rssBytes: number;
	ageSeconds: number;
	cpuSeconds: number;
	args: string;
}

/** `ps -A -o pid=,ppid=,pcpu=,rss=,etime=,time=,args=` (the same on macOS and Linux). */
export function parsePs(text: string): PsRow[] {
	const rows: PsRow[] = [];
	for (const line of text.split('\n')) {
		const m = /^\s*(\d+)\s+(\d+)\s+([\d.,]+)\s+(\d+)\s+(\S+)\s+(\S+)\s+(.*)$/.exec(line);
		if (!m) continue;
		rows.push({
			pid: Number(m[1]),
			ppid: Number(m[2]),
			pcpu: Number(m[3].replace(',', '.')),
			rssBytes: Number(m[4]) * 1024,
			ageSeconds: parseDuration(m[5]),
			cpuSeconds: parseDuration(m[6]),
			args: m[7].trim()
		});
	}
	return rows;
}

/** A command line's program name: its first word without the folder. */
export function programName(args: string): string {
	const first = args.trim().split(/\s+/)[0] ?? '';
	return first.split('/').pop() || first;
}

/** `launchctl list`: each job's pid (- when not running), last exit status and label. */
export function parseLaunchctlList(
	text: string
): { pid: number | null; status: number | null; label: string }[] {
	const out: { pid: number | null; status: number | null; label: string }[] = [];
	for (const line of text.split('\n')) {
		const m = /^(-|\d+)\t(-?\d+|-)\t(\S.*)$/.exec(line);
		if (!m) continue;
		out.push({
			pid: m[1] === '-' ? null : Number(m[1]),
			status: m[2] === '-' ? null : Number(m[2]),
			label: m[3].trim()
		});
	}
	return out;
}

/**
 * Third-party launchd jobs worth following: not Apple's own, and not an
 * open app's own instance (`application.…`).
 */
export function watchedLabel(label: string): boolean {
	return !label.startsWith('com.apple.') && !label.startsWith('application.');
}

export interface LaunchdJob {
	runs: number | null;
	lastExit: number | null;
	state: string | null;
	pid: number | null;
	program: string | null;
	periodic: boolean;
}

/** `launchctl print gui/<uid>/<label>`: how often it ran, how it last exited, what it runs. */
export function parseLaunchctlPrint(text: string): LaunchdJob {
	const top = (key: string) => {
		const m = new RegExp(`^\\t${key} = (.*)$`, 'm').exec(text);
		return m ? m[1].trim() : null;
	};
	const num = (v: string | null) => {
		const m = v ? /^-?\d+/.exec(v) : null;
		return m ? Number(m[0]) : null;
	};
	let program = top('program');
	if (!program) {
		const args = /^\targuments = \{\n([\s\S]*?)\n\t\}/m.exec(text);
		if (args)
			program = args[1]
				.split('\n')
				.map((l) => l.trim())
				.filter(Boolean)
				.join(' ');
	}
	return {
		runs: num(top('runs')),
		lastExit: num(top('last exit code')),
		state: top('state'),
		pid: num(top('pid')),
		program,
		periodic: /^\trun interval = /m.test(text) || /^\tstart calendar interval/m.test(text)
	};
}

export interface VmStat {
	pageSize: number;
	free: number;
	active: number;
	inactive: number;
	speculative: number;
	wired: number;
	purgeable: number;
	compressed: number;
}

/** macOS `vm_stat`: page counts (and the page size it counts in). */
export function parseVmStat(text: string): VmStat {
	const size = /page size of (\d+) bytes/.exec(text);
	const pages = (label: string) => {
		const m = new RegExp(`^${label}:\\s+(\\d+)\\.?$`, 'm').exec(text);
		return m ? Number(m[1]) : 0;
	};
	return {
		pageSize: size ? Number(size[1]) : 4096,
		free: pages('Pages free'),
		active: pages('Pages active'),
		inactive: pages('Pages inactive'),
		speculative: pages('Pages speculative'),
		wired: pages('Pages wired down'),
		purgeable: pages('Pages purgeable'),
		compressed: pages('Pages occupied by compressor')
	};
}

/** macOS `sysctl -n kern.memorystatus_vm_pressure_level`: 1 normal, 2 warning, 4 critical. */
export function parsePressureLevel(text: string): MemoryPressure | null {
	const n = Number(text.trim());
	return n === 1 ? 'normal' : n === 2 ? 'warn' : n === 4 ? 'critical' : null;
}

/** macOS `sysctl -n vm.swapusage`: the swap in use, in bytes. */
export function parseSwapUsage(text: string): number | null {
	const m = /used = ([\d.]+)([KMGT])/.exec(text);
	if (!m) return null;
	const scale = { K: 1024, M: 1024 ** 2, G: 1024 ** 3, T: 1024 ** 4 }[
		m[2] as 'K' | 'M' | 'G' | 'T'
	];
	return Math.round(Number(m[1]) * scale);
}

/** Below this a volume is a mounted installer or system partition, not a disk worth watching. */
const SMALL_DISK = 2 * 1024 ** 3;

/**
 * `df -kP`: the disks that hold the captain's files. System volumes, mounted
 * disk images, network and virtual filesystems are left out, and volumes that
 * share one pool of free space (APFS's / and its Data volume) are shown once.
 */
export function parseDf(text: string): DiskSample[] {
	const out: DiskSample[] = [];
	const pools = new Set<string>();
	for (const line of text.split('\n').slice(1)) {
		const m = /^(\S.*?)\s+(\d+)\s+(\d+)\s+(\d+)\s+\d+%\s+(\/.*)$/.exec(line);
		if (!m) continue;
		const [, fs, size, , avail, mount] = m;
		if (!fs.startsWith('/dev/')) continue;
		if (/^\/System\/Volumes\/(?!Data$)/.test(mount)) continue;
		if (/^\/(private\/var\/folders|boot\/efi|snap)\b/.test(mount)) continue;
		const sizeBytes = Number(size) * 1024;
		const availBytes = Number(avail) * 1024;
		if (sizeBytes < SMALL_DISK) continue;
		const pool = `${sizeBytes}:${availBytes}`;
		if (pools.has(pool)) continue;
		pools.add(pool);
		out.push({ mount, sizeBytes, availBytes });
	}
	return out;
}

/** `lsof -nP -iTCP -sTCP:LISTEN -Fpcn`: each listening program's pid, name and ports. */
export function parseLsofListen(text: string): { pid: number; name: string; port: number }[] {
	const out: { pid: number; name: string; port: number }[] = [];
	const seen = new Set<string>();
	let pid = 0;
	let name = '';
	for (const line of text.split('\n')) {
		if (line.startsWith('p')) pid = Number(line.slice(1));
		else if (line.startsWith('c')) name = line.slice(1);
		else if (line.startsWith('n')) {
			const port = Number(/:(\d+)$/.exec(line)?.[1]);
			const key = `${pid}:${port}`;
			if (!pid || !port || seen.has(key)) continue;
			seen.add(key);
			out.push({ pid, name, port });
		}
	}
	return out;
}

/** `ss -ltnpH` (Linux): each listening program's pid, name and port (only the user's own show a pid). */
export function parseSs(text: string): { pid: number; name: string; port: number }[] {
	const out: { pid: number; name: string; port: number }[] = [];
	const seen = new Set<string>();
	for (const line of text.split('\n')) {
		const cols = line.trim().split(/\s+/);
		if (cols.length < 5) continue;
		const port = Number(/:(\d+)$/.exec(cols[3])?.[1]);
		const user = /users:\(\("([^"]+)",pid=(\d+)/.exec(line);
		if (!port || !user) continue;
		const pid = Number(user[2]);
		const key = `${pid}:${port}`;
		if (seen.has(key)) continue;
		seen.add(key);
		out.push({ pid, name: user[1], port });
	}
	return out;
}

/** macOS `footprint <pid>`: the process's physical footprint, in bytes. */
export function parseFootprint(text: string): number | null {
	const m = /Footprint:\s+([\d.]+)\s+(B|KB|MB|GB)/.exec(text);
	if (!m) return null;
	const scale = { B: 1, KB: 1024, MB: 1024 ** 2, GB: 1024 ** 3 }[m[2] as 'B' | 'KB' | 'MB' | 'GB'];
	return Math.round(Number(m[1]) * scale);
}

/** Linux `/proc/meminfo`: total, available and swap in use, in bytes. */
export function parseMeminfo(text: string): {
	totalBytes: number;
	availableBytes: number | null;
	swapUsedBytes: number | null;
} {
	const kb = (key: string) => {
		const m = new RegExp(`^${key}:\\s+(\\d+) kB`, 'm').exec(text);
		return m ? Number(m[1]) * 1024 : null;
	};
	const swapTotal = kb('SwapTotal');
	const swapFree = kb('SwapFree');
	return {
		totalBytes: kb('MemTotal') ?? 0,
		availableBytes: kb('MemAvailable'),
		swapUsedBytes: swapTotal !== null && swapFree !== null ? swapTotal - swapFree : null
	};
}

/**
 * Linux pressure stall information (`/proc/pressure/memory`) as a pressure
 * level: some work waited on memory more than 10% (warn) or 40% (critical) of
 * the last minute.
 */
export function parsePsi(text: string): MemoryPressure | null {
	const m = /^some avg10=[\d.]+ avg60=([\d.]+)/m.exec(text);
	if (!m) return null;
	const avg = Number(m[1]);
	return avg >= 40 ? 'critical' : avg >= 10 ? 'warn' : 'normal';
}

/** Linux `/proc/<pid>/smaps_rollup`: the process's proportional set size, in bytes. */
export function parseSmapsRollup(text: string): number | null {
	const m = /^Pss:\s+(\d+) kB/m.exec(text);
	return m ? Number(m[1]) * 1024 : null;
}

export interface SystemdUnit {
	label: string;
	runs: number | null;
	lastExit: number | null;
	pid: number | null;
	state: string | null;
	program: string | null;
	periodic: boolean;
}

/**
 * `systemctl --user show --property=Id,NRestarts,ExecMainStatus,MainPID,ActiveState,SubState,ExecStart,Type <units…>`:
 * one block per unit, blank-line separated. Restarts count as runs.
 */
export function parseSystemctlShow(text: string): SystemdUnit[] {
	const out: SystemdUnit[] = [];
	for (const block of text.split(/\n\s*\n/)) {
		const props = new Map<string, string>();
		for (const line of block.split('\n')) {
			const i = line.indexOf('=');
			if (i > 0) props.set(line.slice(0, i), line.slice(i + 1));
		}
		const id = props.get('Id');
		if (!id) continue;
		const n = (key: string) => {
			const v = props.get(key);
			return v !== undefined && /^-?\d+$/.test(v) ? Number(v) : null;
		};
		const exec = /argv\[\]=([^;]*)/.exec(props.get('ExecStart') ?? '');
		const pid = n('MainPID');
		out.push({
			label: id,
			runs: n('NRestarts'),
			lastExit: n('ExecMainStatus'),
			pid: pid && pid > 0 ? pid : null,
			state: [props.get('ActiveState'), props.get('SubState')].filter(Boolean).join(' / ') || null,
			program: exec ? exec[1].trim() : null,
			periodic: props.get('Type') === 'oneshot'
		});
	}
	return out;
}

/** Programs that are usually a development or preview server when they listen on a port. */
const DEV_SERVER =
	/^(node|bun|deno|python[\d.]*|ruby|php|java|uvicorn|gunicorn|rails|vite|next-server|esbuild|webpack|astro|hugo|jekyll|caddy|http-server|serve)$/i;

export function devServerName(name: string): boolean {
	return DEV_SERVER.test(name.replace(/\s.*$/, ''));
}
