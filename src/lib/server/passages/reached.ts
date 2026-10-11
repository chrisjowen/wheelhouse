import { randomBytes } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { storeFileFor } from '../store/store';
import { ID } from './schema';

/**
 * The passage steps a task has reached through its checks. `reached_when` is
 * a high-water mark, but some checks cannot observe the same thing again (a
 * newer commit is live, a deployment was superseded) and results are kept in
 * memory, so without this record a Deployed task would fall back to Landed
 * after a restart. Likewise a step the task has moved past keeps how it was
 * shown (done or skipped, and its note) once its checks stop running.
 *
 * The record lives beside the consent record, in Wheelhouse's own state
 * directory, keyed by project, task and step. It is bounded (the least
 * recently reached tasks are forgotten first); a missing or unreadable file
 * means nothing is recorded, and a failed write keeps the record in memory.
 */

export const REACHED_SCHEMA = 'wheelhouse-passage-reached.v1';
export const MAX_REACHED_TASKS = 2000;
const MAX_STEPS = 32;
const MAX_NOTE = 2000;

/** How a step the task moved past was shown. */
export interface PastStep {
	skipped: boolean;
	note: string | null;
}

interface Entry {
	project: string;
	task: string;
	steps: string[];
	past: Record<string, PastStep>;
}

function pastFrom(v: unknown): Record<string, PastStep> {
	const out: Record<string, PastStep> = {};
	if (!v || typeof v !== 'object' || Array.isArray(v)) return out;
	for (const [id, p] of Object.entries(v as Record<string, unknown>).slice(0, MAX_STEPS)) {
		const r = p as Partial<PastStep> | null;
		if (!ID.test(id) || typeof r?.skipped !== 'boolean') continue;
		const note = typeof r.note === 'string' ? r.note.slice(0, MAX_NOTE) : null;
		out[id] = { skipped: r.skipped, note };
	}
	return out;
}

export function reachedFileFor(stateDir: string, homeDir: string): string {
	return path.join(path.dirname(storeFileFor(stateDir, homeDir)), 'passage-reached.json');
}

const keyOf = (project: string, task: string) => JSON.stringify([project, task]);

export class ReachedStore {
	private entries = new Map<string, Entry>();
	private writing: Promise<void> = Promise.resolve();
	private queued: Promise<void> | null = null;

	private constructor(
		readonly file: string,
		private home: string,
		private max: number
	) {}

	static async open(file: string, home: string, max = MAX_REACHED_TASKS): Promise<ReachedStore> {
		const s = new ReachedStore(file, home, max);
		try {
			const doc = JSON.parse(await readFile(file, 'utf8'));
			if (doc?.schema === REACHED_SCHEMA && Array.isArray(doc.tasks)) {
				for (const t of (doc.tasks as unknown[]).slice(-max)) {
					const e = t as Partial<Entry> | null;
					if (typeof e?.project !== 'string' || typeof e.task !== 'string') continue;
					const steps = (Array.isArray(e.steps) ? e.steps : [])
						.filter((x): x is string => typeof x === 'string' && ID.test(x))
						.slice(0, MAX_STEPS);
					const past = pastFrom(e.past);
					if (steps.length || Object.keys(past).length) {
						s.entries.set(keyOf(e.project, e.task), {
							project: e.project,
							task: e.task,
							steps,
							past
						});
					}
				}
			}
		} catch {
			// nothing recorded yet
		}
		return s;
	}

	/** The steps this task has reached. */
	get(project: string, task: string): readonly string[] {
		return this.entries.get(keyOf(project, task))?.steps ?? [];
	}

	/** How the steps this task moved past were shown. */
	past(project: string, task: string): Readonly<Record<string, PastStep>> {
		return this.entries.get(keyOf(project, task))?.past ?? {};
	}

	/** Record that the task reached this step, and save. */
	add(project: string, task: string, step: string): Promise<void> {
		if (!ID.test(step) || this.get(project, task).includes(step)) return Promise.resolve();
		return this.update(project, task, (e) => ({
			...e,
			steps: [...e.steps, step].slice(-MAX_STEPS)
		}));
	}

	/** Record how a step the task moved past was shown, and save. */
	settle(project: string, task: string, step: string, past: PastStep): Promise<void> {
		if (!ID.test(step) || this.past(project, task)[step]) return Promise.resolve();
		return this.update(project, task, (e) => ({
			...e,
			past: pastFrom({ ...e.past, [step]: past })
		}));
	}

	private update(project: string, task: string, change: (e: Entry) => Entry): Promise<void> {
		const key = keyOf(project, task);
		const e = this.entries.get(key) ?? { project, task, steps: [], past: {} };
		this.entries.delete(key);
		this.entries.set(key, change(e));
		for (const k of this.entries.keys()) {
			if (this.entries.size <= this.max) break;
			this.entries.delete(k);
		}
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
		const text = `${JSON.stringify(
			{ schema: REACHED_SCHEMA, home: this.home, tasks: [...this.entries.values()] },
			null,
			'\t'
		)}\n`;
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
