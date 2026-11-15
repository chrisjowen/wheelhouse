import { readdir, readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import type { FirstmateSessionView, TranscriptSource } from '../../types';
import { HARNESS_NAMES, HARNESSES, type Harness } from '../../harness';
import { TASK_ID } from '../firstmate/adapter';
import { metaGet } from '../firstmate/crew';
import { transcriptDirName } from '../buildlog/reader';
import { ChatFeed, transcriptCwd } from '../sessions/transcript';

/**
 * A worker's own conversation, for its task's Chat (read-only, or in a crew
 * discussion): the same follower as Firstmate's chat (ChatFeed), one per task,
 * pointed at the worker's transcript instead.
 *
 * Which transcript: Firstmate records each task's harness, worktree and
 * spawn time in state/<task>.meta. For a Claude Code worker it is the newest
 * transcript under Claude Code's projects folder for that worktree, written
 * since the worker was spawned, whose records name the worktree as their
 * working directory (a worktree is reused by later tasks, hence the time).
 * Workers on other harnesses are not followed yet: the Chat says so (in a
 * discussion, what the captain sends still reaches them).
 */

export interface WorkerMeta {
	harness: string;
	worktree: string | null;
	/** When the worker was spawned (epoch ms), from `spawn_gen=s<epoch>.…`; null when unknown. */
	spawnedAt: number | null;
}

const META_MAX_BYTES = 64 * 1024;
/** A transcript may start a little before the spawn is recorded. */
const SPAWN_SLACK_MS = 5 * 60_000;

/** A task's meta, or null when Firstmate has no record of it. */
export async function workerMeta(homeDir: string, taskId: string): Promise<WorkerMeta | null> {
	if (!TASK_ID.test(taskId)) return null;
	let text: string;
	try {
		text = (await readFile(path.join(homeDir, 'state', `${taskId}.meta`), 'utf8')).slice(
			0,
			META_MAX_BYTES
		);
	} catch {
		return null;
	}
	const spawn = /^s(\d{9,11})(?:\.|$)/.exec(metaGet(text, 'spawn_gen'))?.[1];
	return {
		harness: metaGet(text, 'harness') || 'claude',
		worktree: metaGet(text, 'worktree') || null,
		spawnedAt: spawn ? Number(spawn) * 1000 : null
	};
}

async function real(p: string): Promise<string> {
	try {
		return await realpath(p);
	} catch {
		return path.resolve(p);
	}
}

/** The newest Claude Code transcript a worker wrote in its worktree since it was spawned, or null. */
export async function locateWorkerTranscript(o: {
	projectsDir: string;
	worktree: string;
	spawnedAt: number | null;
}): Promise<string | null> {
	const dir = await real(o.worktree);
	const since = o.spawnedAt === null ? 0 : o.spawnedAt - SPAWN_SLACK_MS;
	const folders = [...new Set([transcriptDirName(o.worktree), transcriptDirName(dir)])];
	const found: { file: string; mtime: number }[] = [];
	for (const f of folders) {
		const folder = path.join(o.projectsDir, f);
		const names = (await readdir(folder).catch(() => [] as string[])).filter((n) =>
			n.endsWith('.jsonl')
		);
		for (const n of names) {
			const st = await stat(path.join(folder, n)).catch(() => null);
			if (st?.isFile() && st.mtimeMs >= since)
				found.push({ file: path.join(folder, n), mtime: st.mtimeMs });
		}
	}
	found.sort((a, b) => b.mtime - a.mtime);
	for (const f of found) {
		const cwd = await transcriptCwd(f.file);
		if (cwd && (await real(cwd)) === dir) return f.file;
	}
	return null;
}

export interface WorkerFeedsOptions {
	homeDir: string;
	/** Claude Code's projects folder; null follows no transcript. */
	projectsDir: string | null;
	/** The worker is at work right now, from the fleet. */
	busy: (taskId: string) => boolean;
	pollMs?: number;
}

const isHarness = (h: string): h is Harness => (HARNESSES as readonly string[]).includes(h);

/** What the Chat says of the worker's conversation; `external` means it can be read. */
export function workerSession(
	meta: WorkerMeta | null,
	busy: boolean,
	followable: boolean
): FirstmateSessionView {
	const harness = meta && isHarness(meta.harness) ? meta.harness : undefined;
	const reason = !meta
		? 'Firstmate has no record of this worker any more.'
		: !followable
			? 'Wheelhouse cannot read Claude Code’s conversations on this computer.'
			: meta.harness !== 'claude'
				? `Wheelhouse can show a Claude Code worker’s conversation; this one runs ${harness ? HARNESS_NAMES[harness] : meta.harness}. Its terminal shows what it is doing.`
				: !meta.worktree
					? 'Firstmate has not recorded where this worker works.'
					: null;
	return {
		schema: 'wheelhouse-firstmate-session.v1',
		harness,
		state: reason ? 'unavailable' : 'external',
		reason,
		canSend: false,
		attach: null,
		skipPermissions: false,
		picker: null,
		menu: null,
		busy
	};
}

/** The most idle workers' feeds kept, each with its records (the least recently opened are let go). */
export const MAX_FEEDS = 12;

/** One ChatFeed per task whose Chat was opened; a feed stops by itself when no page listens. */
export class WorkerFeeds {
	private feeds = new Map<string, ChatFeed>();

	constructor(private opts: WorkerFeedsOptions) {}

	feed(taskId: string): ChatFeed {
		let feed = this.feeds.get(taskId);
		if (feed) {
			// The most recently opened last.
			this.feeds.delete(taskId);
			this.feeds.set(taskId, feed);
			return feed;
		}
		for (const [old, f] of this.feeds) {
			if (this.feeds.size < MAX_FEEDS) break;
			if (f.idle) this.feeds.delete(old);
		}
		let meta: WorkerMeta | null = null;
		feed = new ChatFeed({
			status: async () => {
				meta = await workerMeta(this.opts.homeDir, taskId);
				return workerSession(meta, this.opts.busy(taskId), !!this.opts.projectsDir);
			},
			locate: async (state): Promise<Omit<TranscriptSource, 'truncated'> | null> => {
				if (state !== 'external' || !meta?.worktree || !this.opts.projectsDir) return null;
				const file = await locateWorkerTranscript({
					projectsDir: this.opts.projectsDir,
					worktree: meta.worktree,
					spawnedAt: meta.spawnedAt
				});
				return file ? { how: 'worktree', file } : null;
			},
			pollMs: this.opts.pollMs
		});
		this.feeds.set(taskId, feed);
		return feed;
	}

	stop(): void {
		for (const f of this.feeds.values()) f.stop();
		this.feeds.clear();
	}
}
