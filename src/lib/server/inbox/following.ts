import { randomBytes } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { storeFileFor } from '../store/store';

/**
 * The decisions the captain is following up with Firstmate in the main chat
 * (Chat with Firstmate about this), by task id, with when they started. Kept
 * in Wheelhouse's own state directory, beside the answered log, so every
 * browser shows the same and it survives a restart. A decision being followed
 * up stays listed but no longer counts as waiting on the captain; answering or
 * dismissing it, its question closing, or the captain putting it back to
 * waiting, ends that.
 *
 * It is bounded (the oldest are forgotten first); a missing or unreadable file
 * means nothing is being followed up, and a failed write keeps the change in
 * memory.
 */

export const FOLLOWING_SCHEMA = 'wheelhouse-following-decisions.v1';
export const MAX_FOLLOWING = 200;

/** A task id as Firstmate writes them: no spaces, brackets or separators. */
const TASK_ID = /^[A-Za-z0-9][\w.@-]{0,199}$/;

export const followableId = (id: unknown): id is string =>
	typeof id === 'string' && TASK_ID.test(id);

export function followingFileFor(stateDir: string, homeDir: string): string {
	return path.join(path.dirname(storeFileFor(stateDir, homeDir)), 'following-decisions.json');
}

export class FollowingLog {
	private records = new Map<string, string>();
	private writing: Promise<void> = Promise.resolve();
	private queued: Promise<void> | null = null;

	private constructor(
		readonly file: string,
		private home: string,
		private max: number
	) {}

	static async open(file: string, home: string, max = MAX_FOLLOWING): Promise<FollowingLog> {
		const log = new FollowingLog(file, home, max);
		try {
			const doc = JSON.parse(await readFile(file, 'utf8'));
			if (doc?.schema === FOLLOWING_SCHEMA && Array.isArray(doc.following)) {
				for (const v of (doc.following as unknown[]).slice(-max)) {
					const r = v as { taskId?: unknown; at?: unknown } | null;
					if (
						followableId(r?.taskId) &&
						typeof r.at === 'string' &&
						!Number.isNaN(Date.parse(r.at))
					)
						log.records.set(r.taskId, r.at);
				}
			}
		} catch {
			// nothing followed up yet
		}
		return log;
	}

	/** When the captain started following up this task's decision, or null. */
	get(taskId: string): string | null {
		return this.records.get(taskId) ?? null;
	}

	/** Start following up a task's decision, from now, and save. */
	follow(taskId: string, at: string): Promise<void> {
		if (!followableId(taskId)) return Promise.resolve();
		this.records.delete(taskId);
		this.records.set(taskId, at);
		while (this.records.size > this.max) {
			this.records.delete(this.records.keys().next().value as string);
		}
		return this.save();
	}

	/** Stop following it up: back to waiting, or settled. Nothing to do when it was not. */
	unfollow(taskId: string): Promise<void> {
		if (!this.records.delete(taskId)) return Promise.resolve();
		return this.save();
	}

	/** Stop following up every task but these: those whose questions are still open. */
	retain(open: ReadonlySet<string>): Promise<void> {
		const gone = [...this.records.keys()].filter((id) => !open.has(id));
		if (!gone.length) return Promise.resolve();
		for (const id of gone) this.records.delete(id);
		return this.save();
	}

	private save(): Promise<void> {
		if (!this.queued) {
			const write = this.writing.then(() => {
				this.queued = null;
				return this.write();
			});
			this.queued = write;
			this.writing = write.catch(() => {});
		}
		return this.queued;
	}

	private async write(): Promise<void> {
		const following = [...this.records].map(([taskId, at]) => ({ taskId, at }));
		const text = `${JSON.stringify({ schema: FOLLOWING_SCHEMA, home: this.home, following }, null, '\t')}\n`;
		await mkdir(path.dirname(this.file), { recursive: true });
		const tmp = `${this.file}.${randomBytes(6).toString('hex')}.tmp`;
		try {
			await writeFile(tmp, text, { mode: 0o600 });
			await rename(tmp, this.file);
		} catch (e) {
			await rm(tmp, { force: true });
			throw e;
		}
	}
}
