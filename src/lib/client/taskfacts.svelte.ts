import { mergeFacts, type MergeFacts } from '$lib/calls';
import type { TaskDetail } from '$lib/types';

/** Read again after this long, when a card asks again. */
const FRESH_MS = 60_000;

/**
 * What a merge call rests on, read from its task's record (/api/tasks/<id>)
 * once and kept for a minute: the change's size, the pull request's checks,
 * the pictures and the captain's ask (lib/calls.ts mergeFacts). Null while
 * it is read, or when it cannot be.
 */
class TaskFacts {
	byTask = $state<Record<string, { facts: MergeFacts | null; at: number }>>({});
	private reading = new Set<string>();

	get(taskId: string): MergeFacts | null {
		const had = this.byTask[taskId];
		if (!had || Date.now() - had.at > FRESH_MS) void this.read(taskId);
		return had?.facts ?? null;
	}

	private async read(taskId: string) {
		if (this.reading.has(taskId)) return;
		this.reading.add(taskId);
		try {
			const r = await fetch(`/api/tasks/${encodeURIComponent(taskId)}`);
			const detail = r.ok ? ((await r.json()) as TaskDetail) : null;
			this.byTask = {
				...this.byTask,
				[taskId]: { facts: detail ? mergeFacts(detail) : null, at: Date.now() }
			};
		} catch {
			this.byTask = { ...this.byTask, [taskId]: { facts: null, at: Date.now() } };
		} finally {
			this.reading.delete(taskId);
		}
	}
}

export const taskFacts = new TaskFacts();
