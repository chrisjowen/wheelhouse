import { execFile } from 'node:child_process';
import { readlink } from 'node:fs/promises';
import path from 'node:path';

/**
 * The processes using the most CPU on this computer, each named by its
 * command and, when it works in a crew task's worktree, that task: what the
 * load check's bell names. Read only (`ps`, and /proc/<pid>/cwd on Linux).
 */

export interface PsRow {
	pid: number;
	cpu: number;
	command: string;
}

export interface HeavyProcess extends PsRow {
	/** The crew task whose worktree it works in, or whose id or worktree its command line names. */
	taskId: string | null;
}

/** `ps -A -o pid=,pcpu=,args=` (or `times=`, CPU seconds) output, heaviest first. Pure. */
export function parsePs(text: string): PsRow[] {
	const rows: PsRow[] = [];
	for (const line of text.split('\n')) {
		const m = /^\s*(\d+)\s+([\d.]+)\s+(.+?)\s*$/.exec(line);
		if (m) rows.push({ pid: Number(m[1]), cpu: Number(m[2]), command: m[3] });
	}
	return rows.sort((a, b) => b.cpu - a.cpu);
}

export interface CrewWorktree {
	taskId: string;
	worktree: string | null;
}

/** The crew task a process belongs to, by its working directory or its command line. Pure. */
export function crewTaskOf(row: PsRow, cwd: string | null, crew: CrewWorktree[]): string | null {
	for (const c of crew) {
		if (!c.worktree) continue;
		const w = c.worktree.replace(/\/+$/, '');
		if (cwd && (cwd === w || cwd.startsWith(`${w}/`))) return c.taskId;
		if (row.command.includes(w)) return c.taskId;
	}
	for (const c of crew) if (c.taskId.length > 3 && row.command.includes(c.taskId)) return c.taskId;
	return null;
}

/** The short name of a command line: its program's file name. */
export function programName(command: string): string {
	const first = command.split(/\s+/)[0] ?? command;
	return path.basename(first) || first;
}

/** One line naming processes, crew tasks' first, e.g. "claude (fix-login) 92%, node 40%". Pure. */
export function describeHeavy(list: HeavyProcess[], limit = 3): string {
	const ordered = [...list.filter((p) => p.taskId), ...list.filter((p) => !p.taskId)];
	return ordered
		.slice(0, limit)
		.map(
			(p) => `${programName(p.command)}${p.taskId ? ` (${p.taskId})` : ''} ${Math.round(p.cpu)}%`
		)
		.join(', ');
}

function ps(fields: string): Promise<string> {
	return new Promise<string>((resolve) =>
		execFile(
			'ps',
			['-A', '-o', fields],
			{ timeout: 10_000, maxBuffer: 8 * 1024 * 1024 },
			(_e, stdout) => resolve(String(stdout ?? ''))
		)
	);
}

/**
 * CPU use now. On Linux, ps's %CPU is the average over each process's whole
 * life, so two reads of its CPU seconds (`times`) `windowMs` apart are compared
 * instead; macOS's %CPU is already a recent average.
 */
async function cpuRows(windowMs: number): Promise<PsRow[]> {
	if (process.platform !== 'linux') return parsePs(await ps('pid=,pcpu=,args='));
	const before = new Map(parsePs(await ps('pid=,times=,args=')).map((r) => [r.pid, r.cpu]));
	await new Promise((r) => setTimeout(r, windowMs));
	return parsePs(await ps('pid=,times=,args='))
		.map((r) => ({
			...r,
			cpu: before.has(r.pid) ? ((r.cpu - before.get(r.pid)!) * 100_000) / windowMs : 0
		}))
		.sort((a, b) => b.cpu - a.cpu);
}

export async function heaviestProcesses(
	crew: CrewWorktree[],
	opts: { top?: number; windowMs?: number } = {}
): Promise<HeavyProcess[]> {
	const rows = (await cpuRows(opts.windowMs ?? 2_000))
		.filter((r) => r.pid !== process.pid && r.cpu > 0)
		.slice(0, opts.top ?? 8);
	return Promise.all(
		rows.map(async (r) => {
			const cwd =
				process.platform === 'linux'
					? await readlink(`/proc/${r.pid}/cwd`).catch(() => null)
					: null;
			return { ...r, taskId: crewTaskOf(r, cwd, crew) };
		})
	);
}
