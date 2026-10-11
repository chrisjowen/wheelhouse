/**
 * A small background scheduler for passage checks. It never runs on the
 * collector's hot path: each collector round says which jobs are wanted now
 * (`want`), and the scheduler starts the ones that are due, at most
 * `maxConcurrent` at a time, and reports through `onChange` when a result
 * arrives.
 *
 * - interval: a job runs again `intervalMs` after its last run finished.
 * - terminal caching: a terminal result (a successful deploy of a commit) is
 *   kept and the job never runs again, even when it is wanted again later.
 * - give-up: after `giveUpAt` a job runs at most once more (so a task first
 *   seen after the window is still checked once), then stops; its last
 *   result is kept and the job reads as given up.
 * - jobs that are no longer wanted stop running; their last results are kept
 *   (bounded) so a passage does not flicker when a task comes back into view.
 */

export interface Job<T> {
	/** Stable identity, including every input the job depends on. */
	key: string;
	run: () => Promise<T>;
	intervalMs: number;
	/** Epoch ms after which the job runs at most once more, or null to keep checking. */
	giveUpAt: number | null;
	terminal: (result: T) => boolean;
}

export interface JobStatus<T> {
	result: T | null;
	running: boolean;
	/** The job will not run again: its give-up time passed. */
	gaveUp: boolean;
	/** When it last finished (epoch ms). */
	lastRunAt: number | null;
}

interface Entry<T> {
	job: Job<T>;
	status: JobStatus<T>;
	nextAt: number;
	terminal: boolean;
}

export interface SchedulerOptions {
	now?: () => number;
	maxConcurrent?: number;
	/** Results kept for jobs that are no longer wanted. */
	maxKept?: number;
	onChange?: () => void;
}

export class Scheduler<T> {
	private entries = new Map<string, Entry<T>>();
	private wanted = new Set<string>();
	private running = 0;
	private now: () => number;
	private maxConcurrent: number;
	private maxKept: number;
	private stopped = false;
	onChange: () => void;

	constructor(opts: SchedulerOptions = {}) {
		this.now = opts.now ?? Date.now;
		this.maxConcurrent = opts.maxConcurrent ?? 2;
		this.maxKept = opts.maxKept ?? 2000;
		this.onChange = opts.onChange ?? (() => {});
	}

	/** Replace the set of wanted jobs and start any that are due. */
	want(jobs: Job<T>[]): void {
		this.wanted = new Set(jobs.map((j) => j.key));
		for (const job of jobs) {
			const e = this.entries.get(job.key);
			if (e) {
				// Keep its state; take the newest closure and timing.
				e.job = job;
			} else {
				this.entries.set(job.key, {
					job,
					status: { result: null, running: false, gaveUp: false, lastRunAt: null },
					nextAt: this.now(),
					terminal: false
				});
			}
		}
		this.prune();
		this.pump();
	}

	status(key: string): JobStatus<T> | undefined {
		return this.entries.get(key)?.status;
	}

	/** Start due, wanted jobs up to the concurrency limit. */
	pump(): void {
		if (this.stopped) return;
		const now = this.now();
		const due = [...this.entries.values()]
			.filter(
				(e) =>
					this.wanted.has(e.job.key) &&
					!e.status.running &&
					!e.terminal &&
					!e.status.gaveUp &&
					e.nextAt <= now
			)
			.sort((a, b) => a.nextAt - b.nextAt);
		for (const e of due) {
			if (this.running >= this.maxConcurrent) break;
			this.start(e);
		}
	}

	stop(): void {
		this.stopped = true;
	}

	/** Jobs currently running. */
	active(): number {
		return this.running;
	}

	private start(e: Entry<T>): void {
		this.running++;
		e.status = { ...e.status, running: true };
		const job = e.job;
		void job
			.run()
			.then(
				(r) => ({ ok: true as const, r }),
				() => ({ ok: false as const })
			)
			.then((out) => {
				this.running--;
				const now = this.now();
				const result = out.ok ? out.r : e.status.result;
				e.terminal = out.ok && job.terminal(out.r);
				const gaveUp = !e.terminal && job.giveUpAt !== null && now >= job.giveUpAt;
				e.status = { result, running: false, gaveUp, lastRunAt: now };
				e.nextAt = now + job.intervalMs;
				if (this.stopped) return;
				this.onChange();
				this.pump();
			});
	}

	/** Forget the oldest results of jobs nobody wants any more. */
	private prune(): void {
		if (this.entries.size <= this.maxKept) return;
		for (const [key, e] of this.entries) {
			if (this.entries.size <= this.maxKept) break;
			if (!this.wanted.has(key) && !e.status.running) this.entries.delete(key);
		}
	}
}
