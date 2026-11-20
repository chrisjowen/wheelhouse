import {
	bytes,
	span,
	type FindingDraft,
	type MachineSample,
	type PageSignal,
	type ProcessVitals,
	type SoundingsSettings
} from '../../soundings';

/**
 * Soundings' rules: plain checks, no AI, that turn what the scans and
 * Wheelhouse's own vitals show into findings. Each finding's id is its rule
 * and subject, so the same problem on the same thing keeps one id from scan
 * to scan (service.ts opens, keeps and clears findings by it). The proposal a
 * finding carries is only ever a request to Firstmate, sent when the captain
 * taps it.
 */

/** What an earlier scan is remembered by, for comparing over time. */
export interface ScanPoint {
	at: number;
	/** Each service's runs so far, by label. */
	runs: Record<string, number>;
	/** Each process's CPU time so far, by `pid:name` (dropped from scans older than a few hours). */
	cpu: Record<string, number>;
	/** The one-minute load, and the share of memory available (percent), for what is normal. */
	load: number;
	availablePercent: number | null;
}

/** Wheelhouse's own vitals, once a minute. */
export interface VitalsPoint {
	at: number;
	eventLoopP99Ms: number;
	lastSnapshotMs: number | null;
}

export interface RuleInput {
	now: number;
	/** The latest scan, or null before the first. */
	machine: MachineSample | null;
	/** Earlier scans, oldest first (the latest is not among them). */
	history: ScanPoint[];
	vitals: ProcessVitals | null;
	vitalsHistory: VitalsPoint[];
	/** Page trouble reported over the last hour. */
	signals: PageSignal[];
}

export function scanPoint(sample: MachineSample): ScanPoint {
	const runs: Record<string, number> = {};
	for (const s of sample.services) if (s.runs !== null) runs[s.label] = s.runs;
	const cpu: Record<string, number> = {};
	for (const p of sample.processes) cpu[`${p.pid}:${p.name}`] = p.cpuSeconds;
	const m = sample.memory;
	return {
		at: Date.parse(sample.at),
		runs,
		cpu,
		load: sample.load[0],
		availablePercent:
			m.availableBytes !== null && m.totalBytes ? (m.availableBytes / m.totalBytes) * 100 : null
	};
}

const HOUR = 3600_000;
const GB = 1024 ** 3;
const MB = 1024 ** 2;

export function evaluate(input: RuleInput, s: SoundingsSettings): FindingDraft[] {
	return [
		...crashLoops(input, s),
		...cpuHogs(input, s),
		...memoryHogs(input, s),
		...memoryPressure(input),
		...lowDisks(input, s),
		...bigLogs(input, s),
		...oldDevServers(input, s),
		...wheelhouseMemory(input, s),
		...eventLoop(input, s),
		...slowSnapshots(input, s),
		...orphanWatchers(input),
		...pageTrouble(input)
	];
}

/** The latest earlier scan at least `minMs` before the latest, and no more than `maxMs`. */
function baseline(input: RuleInput, minMs: number, maxMs: number): ScanPoint | null {
	const at = input.machine ? Date.parse(input.machine.at) : input.now;
	return input.history.findLast((p) => at - p.at >= minMs && at - p.at <= maxMs) ?? null;
}

/**
 * A background service restarting more often than the setting allows, over
 * the last hour (or as much of it as there are scans for). A job started on a
 * timer that exits cleanly is running as asked, not looping.
 */
function crashLoops(input: RuleInput, s: SoundingsSettings): FindingDraft[] {
	const m = input.machine;
	if (!m) return [];
	const out: FindingDraft[] = [];
	const at = Date.parse(m.at);
	for (const svc of m.services) {
		if (svc.runs === null) continue;
		if (svc.periodic && (svc.lastExit ?? 0) === 0) continue;
		const then = input.history.find(
			(p) => at - p.at <= HOUR + 60_000 && at - p.at >= 60_000 && p.runs[svc.label] !== undefined
		);
		if (!then) continue;
		// Over once it stops: no restart since the scan before this one.
		const last = input.history.at(-1)?.runs[svc.label];
		if (last !== undefined && svc.runs <= last) continue;
		const restarts = svc.runs - then.runs[svc.label];
		if (restarts <= 0) continue;
		const minutes = (at - then.at) / 60_000;
		const perHour = Math.round((restarts / minutes) * 60);
		if (perHour <= s.restartsPerHour) continue;
		const exit =
			svc.lastExit !== null && svc.lastExit !== 0
				? ` It last exited with code ${svc.lastExit}.`
				: '';
		const stop =
			m.platform === 'linux'
				? `systemctl --user stop ${svc.label}`
				: `launchctl bootout gui/$(id -u)/${svc.label}`;
		out.push({
			id: `crash-loop:${svc.label}`,
			rule: 'crash-loop',
			severity: 'serious',
			subject: svc.label,
			title: `${svc.label} keeps crashing and restarting`,
			detail: `It restarted ${restarts} times in the last ${span(minutes * 60)}, about ${perHour} an hour (${svc.runs} runs since login).${exit} Each restart costs CPU and battery, and the service is not doing its job.`,
			proposal: {
				label: 'Ask Firstmate to stop it',
				note: `Soundings (Wheelhouse's health check) sees the background service ${svc.label} crash-looping: ${restarts} restarts in ${Math.round(minutes)} minutes, about ${perHour} an hour.${exit}${svc.program ? ` It runs: ${svc.program}.` : ''} Please look at why it fails (its log or config), tell me the cause, and stop it until it is fixed (\`${stop}\`) if I agree. Do not delete anything.`,
				sent: 'Asked Firstmate to look at it'
			}
		});
	}
	return out;
}

/** A process using more than the setting's share of a core, all through the last few minutes. */
function cpuHogs(input: RuleInput, s: SoundingsSettings): FindingDraft[] {
	const m = input.machine;
	if (!m) return [];
	const then = baseline(
		input,
		s.cpuMinutes * 60_000 - 30_000,
		(s.cpuMinutes + 2 * s.scanMinutes) * 60_000 + 30_000
	);
	if (!then) return [];
	const seconds = (Date.parse(m.at) - then.at) / 1000;
	const out: FindingDraft[] = [];
	for (const p of m.processes) {
		const before = then.cpu[`${p.pid}:${p.name}`];
		if (before === undefined) continue;
		const percent = Math.round(((p.cpuSeconds - before) / seconds) * 100);
		if (percent <= s.cpuPercent) continue;
		const own = input.vitals?.pid === p.pid;
		out.push({
			id: `cpu-hog:${p.name}:${p.pid}`,
			rule: 'cpu-hog',
			severity: percent >= 2 * s.cpuPercent ? 'serious' : 'warning',
			subject: `${p.name} (${p.pid})`,
			title: own ? 'Wheelhouse is busy all the time' : `${p.name} is using a lot of CPU`,
			detail: `It used ${percent}% of a core on average over the last ${span(seconds)} (running for ${span(p.ageSeconds)}). Command: ${p.command}`,
			proposal: own
				? null
				: {
						label: 'Ask Firstmate about it',
						note: `Soundings (Wheelhouse's health check) sees ${p.name} (pid ${p.pid}) using ${percent}% of a CPU core for the last ${Math.round(seconds / 60)} minutes. Command: ${p.command}. Please find out what it is and whether it is stuck, and tell me before stopping anything.`,
						sent: 'Asked Firstmate to look at it'
					}
		});
	}
	return out;
}

function memoryHogs(input: RuleInput, s: SoundingsSettings): FindingDraft[] {
	const m = input.machine;
	if (!m) return [];
	return m.processes
		.filter((p) => p.rssBytes > s.processMemoryGb * GB && p.pid !== input.vitals?.pid)
		.map((p) => ({
			id: `memory-hog:${p.name}:${p.pid}`,
			rule: 'memory-hog' as const,
			severity: 'info' as const,
			subject: `${p.name} (${p.pid})`,
			title: `${p.name} holds ${bytes(p.rssBytes)} of memory`,
			detail: `More than the ${s.processMemoryGb} GB a single program is expected to need (running for ${span(p.ageSeconds)}). Command: ${p.command}`,
			proposal: null
		}));
}

function memoryPressure(input: RuleInput): FindingDraft[] {
	const m = input.machine;
	if (!m?.memory.pressure || m.memory.pressure === 'normal') return [];
	const swap = m.memory.swapUsedBytes
		? ` ${bytes(m.memory.swapUsedBytes)} is swapped out to disk.`
		: '';
	const top = [...m.processes].sort((a, b) => b.rssBytes - a.rssBytes).slice(0, 3);
	return [
		{
			id: 'memory-pressure:system',
			rule: 'memory-pressure',
			severity: m.memory.pressure === 'critical' ? 'serious' : 'warning',
			subject: 'memory',
			title:
				m.memory.pressure === 'critical'
					? 'The computer is critically short of memory'
					: 'The computer is short of memory',
			detail: `The system reports memory pressure (${m.memory.pressure}), so everything slows down.${swap} The largest programs: ${top.map((p) => `${p.name} ${bytes(p.rssBytes)}`).join(', ')}.`,
			proposal: null
		}
	];
}

function lowDisks(input: RuleInput, s: SoundingsSettings): FindingDraft[] {
	const m = input.machine;
	if (!m) return [];
	return m.disks
		.filter((d) => d.sizeBytes && (d.availBytes / d.sizeBytes) * 100 < s.diskFreePercent)
		.map((d) => {
			const pct = Math.round((d.availBytes / d.sizeBytes) * 100);
			return {
				id: `low-disk:${d.mount}`,
				rule: 'low-disk' as const,
				severity: pct < s.diskFreePercent / 2 ? ('serious' as const) : ('warning' as const),
				subject: d.mount,
				title: `The disk at ${d.mount} is nearly full`,
				detail: `${bytes(d.availBytes)} free of ${bytes(d.sizeBytes)} (${pct}%). Below about 10% free, builds, updates and the system's own swap start to fail.`,
				proposal: {
					label: 'Ask Firstmate what is filling it',
					note: `Soundings (Wheelhouse's health check) sees the disk at ${d.mount} with only ${bytes(d.availBytes)} free (${pct}%). Please find what takes the most space (old worktrees, build caches, logs, Docker images) and suggest what I could clear. Do not delete anything without asking me.`,
					sent: 'Asked Firstmate to look at it'
				}
			};
		});
}

function bigLogs(input: RuleInput, s: SoundingsSettings): FindingDraft[] {
	const m = input.machine;
	if (!m) return [];
	return m.logs
		.filter((l) => l.bytes > s.logGb * GB)
		.map((l) => ({
			id: `big-log:${l.path}`,
			rule: 'big-log' as const,
			severity: 'warning' as const,
			subject: l.path,
			title: `A log file has grown to ${bytes(l.bytes)}`,
			detail: `${l.path} is larger than ${s.logGb} GB. A log this size usually means something is writing the same error over and over.`,
			proposal: {
				label: 'Ask Firstmate to look at it',
				note: `Soundings (Wheelhouse's health check) sees the log file ${l.path} at ${bytes(l.bytes)}. Please look at its last lines to find what keeps writing to it and why, and suggest how to fix that and trim the log. Do not delete anything without asking me.`,
				sent: 'Asked Firstmate to look at it'
			}
		}));
}

function oldDevServers(input: RuleInput, s: SoundingsSettings): FindingDraft[] {
	const m = input.machine;
	if (!m) return [];
	const old = m.listeners.filter(
		(l) =>
			l.dev &&
			l.ageSeconds !== null &&
			l.ageSeconds > s.devServerDays * 86400 &&
			l.pid !== input.vitals?.pid
	);
	return old.map((l) => ({
		id: `old-dev-server:${l.port}:${l.pid}`,
		rule: 'old-dev-server' as const,
		severity: 'info' as const,
		subject: `port ${l.port}`,
		title: `A ${l.name} server on port ${l.port} has been running for ${span(l.ageSeconds!)}`,
		detail: `A development or preview server left running holds memory and its port. If no task is using it any more, it can be stopped.`,
		proposal: {
			label: 'Ask Firstmate if it is still needed',
			note: `Soundings (Wheelhouse's health check) sees a ${l.name} server (pid ${l.pid}) listening on port ${l.port} for ${span(l.ageSeconds!)}. If no open task or preview uses it, please stop it; otherwise tell me which task it belongs to.`,
			sent: 'Asked Firstmate about it'
		}
	}));
}

/** Wheelhouse's own memory: its footprint, or its heap after a full collection, never RSS. */
function wheelhouseMemory(input: RuleInput, s: SoundingsSettings): FindingDraft[] {
	const v = input.vitals;
	if (!v) return [];
	const held = v.footprintBytes ?? v.postGcHeapBytes;
	if (held === null || held <= s.wheelhouseMemoryMb * MB) return [];
	const what = v.footprintBytes !== null ? 'physical footprint' : 'heap after garbage collection';
	return [
		{
			id: 'wheelhouse-memory:self',
			rule: 'wheelhouse-memory',
			severity: held > 2 * s.wheelhouseMemoryMb * MB ? 'serious' : 'warning',
			subject: 'Wheelhouse',
			title: `Wheelhouse is holding ${bytes(held)} of memory`,
			detail: `Its ${what} is above ${s.wheelhouseMemoryMb} MB after ${span(v.uptimeSeconds)} running (${v.chatFeeds.count} chat followers, ${v.streams} open streams). Restarting Wheelhouse gives it back; if it climbs again, something is holding on to memory.`,
			proposal: null
		}
	];
}

/** Every once-a-minute reading over the last `minutes` above `limit`, and enough of them. */
function sustained(
	points: VitalsPoint[],
	now: number,
	minutes: number,
	value: (p: VitalsPoint) => number | null,
	limit: number
): number | null {
	const recent = points.filter((p) => now - p.at <= minutes * 60_000 + 30_000);
	if (recent.length < Math.max(2, Math.floor(minutes * 0.8))) return null;
	const values = recent.map(value);
	if (values.some((v) => v === null || v <= limit)) return null;
	return Math.min(...(values as number[]));
}

function eventLoop(input: RuleInput, s: SoundingsSettings): FindingDraft[] {
	const low = sustained(
		input.vitalsHistory,
		input.now,
		s.eventLoopMinutes,
		(p) => p.eventLoopP99Ms,
		s.eventLoopMs
	);
	if (low === null) return [];
	return [
		{
			id: 'event-loop:self',
			rule: 'event-loop',
			severity: 'warning',
			subject: 'Wheelhouse',
			title: 'Wheelhouse is slow to respond',
			detail: `Its event loop has been held up by more than ${s.eventLoopMs} ms (at least ${Math.round(low)} ms at the 99th percentile) for ${s.eventLoopMinutes} minutes, so pages and the chat lag.`,
			proposal: null
		}
	];
}

function slowSnapshots(input: RuleInput, s: SoundingsSettings): FindingDraft[] {
	const low = sustained(
		input.vitalsHistory,
		input.now,
		s.snapshotMinutes,
		(p) => p.lastSnapshotMs,
		s.snapshotSeconds * 1000
	);
	if (low === null) return [];
	return [
		{
			id: 'slow-snapshot:self',
			rule: 'slow-snapshot',
			severity: 'warning',
			subject: 'Wheelhouse',
			title: 'Reading the fleet is slow',
			detail: `Each look at Firstmate's tasks has taken over ${s.snapshotSeconds} seconds (at least ${Math.round(low / 1000)} s) for ${s.snapshotMinutes} minutes, so the Harbour and task pages update late. A busy computer, or a very large Firstmate home, usually causes it.`,
			proposal: null
		}
	];
}

function orphanWatchers(input: RuleInput): FindingDraft[] {
	const n = input.vitals?.chatFeeds.orphans ?? 0;
	if (!n) return [];
	return [
		{
			id: 'orphan-watchers:self',
			rule: 'orphan-watchers',
			severity: 'info',
			subject: 'Wheelhouse',
			title: `Wheelhouse had ${n} chat follower${n === 1 ? '' : 's'} left running with no page open`,
			detail:
				'A chat follower kept watching its file after the last page showing it closed. Soundings closes these itself: they are Wheelhouse’s own and nothing is lost.',
			proposal: null
		}
	];
}

/** Errors in Wheelhouse's own pages over the last hour, or a loading state that never finished. */
function pageTrouble(input: RuleInput): FindingDraft[] {
	const recent = input.signals.filter((g) => input.now - Date.parse(g.at) <= HOUR);
	const errors = recent
		.filter((g) => g.kind === 'exception' || g.kind === 'console' || g.kind === 'network')
		.reduce((n, g) => n + g.count, 0);
	const stuck = recent.filter((g) => g.kind === 'stuck');
	const out: FindingDraft[] = [];
	if (errors >= 10) {
		const pages = [...new Set(recent.map((g) => g.page))].slice(0, 4).join(', ');
		out.push({
			id: 'page-trouble:errors',
			rule: 'page-trouble',
			severity: 'info',
			subject: 'Wheelhouse pages',
			title: `Wheelhouse's pages hit ${errors} errors in the last hour`,
			detail: `On ${pages}. The Health page lists the latest.`,
			proposal: null
		});
	}
	if (stuck.length) {
		out.push({
			id: 'page-trouble:stuck',
			rule: 'page-trouble',
			severity: 'info',
			subject: 'Wheelhouse pages',
			title: 'A Wheelhouse page kept loading without finishing',
			detail: stuck
				.slice(0, 3)
				.map((g) => `${g.page}: ${g.message}`)
				.join('; '),
			proposal: null
		});
	}
	return out;
}
