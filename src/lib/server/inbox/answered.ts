import { randomBytes } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { CHOICES, type AnsweredDecision, type InboxKind } from '../../inbox';
import { storeFileFor } from '../store/store';

/**
 * The questions the captain answered (or closed) from Wheelhouse, so the chat
 * can keep a decision's card, folded to its answer, after the question leaves
 * the inbox. One record per answer (its request id), written once Firstmate's
 * inbox has taken the answer. The message itself stays the message store's;
 * this keeps what the message does not carry (the project, when it was asked).
 *
 * It lives beside the message store, in Wheelhouse's own state directory. It
 * is bounded (the oldest answers are forgotten first); a missing or unreadable
 * file means nothing is recorded, and a failed write keeps the record in memory.
 */

export const ANSWERED_SCHEMA = 'wheelhouse-answered-decisions.v1';
export const MAX_ANSWERED = 300;

/** What the log keeps: the view's record without the delivery, which is read at view time. */
export type AnsweredRecord = Omit<AnsweredDecision, 'delivery'>;

const KINDS: readonly InboxKind[] = ['review', 'decision', 'blocked', 'hold', 'merge', 'preview'];
const MAX_TEXT = 2000;

export function answeredFileFor(stateDir: string, homeDir: string): string {
	return path.join(path.dirname(storeFileFor(stateDir, homeDir)), 'answered-decisions.json');
}

const str = (v: unknown, max = MAX_TEXT): string | null =>
	typeof v === 'string' && v ? v.slice(0, max) : null;

/** A record read back from the file, or null when it is not one. */
function recordFrom(v: unknown): AnsweredRecord | null {
	if (!v || typeof v !== 'object') return null;
	const r = v as Record<string, unknown>;
	const requestId = str(r.requestId, 200);
	const cardId = str(r.cardId, 400);
	const taskId = str(r.taskId, 200);
	const key = str(r.key, 200);
	const question = str(r.question);
	const answeredAt = str(r.answeredAt, 40);
	const label = str(r.label, 80);
	const kind = KINDS.find((k) => k === r.kind);
	const choice = r.choice === 'close' ? 'close' : CHOICES.find((c) => c === r.choice);
	if (
		!requestId ||
		!cardId ||
		!taskId ||
		!key ||
		!question ||
		!answeredAt ||
		!label ||
		!kind ||
		!choice
	)
		return null;
	return {
		requestId,
		cardId,
		taskId,
		taskTitle: str(r.taskTitle, 400) ?? taskId,
		projectId: str(r.projectId, 200),
		kind,
		key,
		question,
		askedAt: str(r.askedAt, 40),
		choice,
		label,
		picks: str(r.picks),
		note: str(r.note),
		answeredAt
	};
}

export class AnsweredLog {
	private records: AnsweredRecord[] = [];
	private writing: Promise<void> = Promise.resolve();
	private queued: Promise<void> | null = null;

	private constructor(
		readonly file: string,
		private home: string,
		private max: number
	) {}

	static async open(file: string, home: string, max = MAX_ANSWERED): Promise<AnsweredLog> {
		const log = new AnsweredLog(file, home, max);
		try {
			const doc = JSON.parse(await readFile(file, 'utf8'));
			if (doc?.schema === ANSWERED_SCHEMA && Array.isArray(doc.answered)) {
				const seen = new Set<string>();
				for (const v of (doc.answered as unknown[]).slice(-max)) {
					const r = recordFrom(v);
					if (r && !seen.has(r.requestId)) {
						seen.add(r.requestId);
						log.records.push(r);
					}
				}
			}
		} catch {
			// nothing recorded yet
		}
		return log;
	}

	/** Every answer recorded, oldest first. */
	list(): readonly AnsweredRecord[] {
		return this.records;
	}

	/** Record an answer once (a repeated request id changes nothing), and save. */
	record(r: AnsweredRecord): Promise<void> {
		const clean = recordFrom(r);
		if (!clean || this.records.some((x) => x.requestId === clean.requestId)) {
			return Promise.resolve();
		}
		this.records = [...this.records, clean].slice(-this.max);
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
			{ schema: ANSWERED_SCHEMA, home: this.home, answered: this.records },
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
