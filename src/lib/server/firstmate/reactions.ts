import { randomBytes } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { storeFileFor } from '../store/store';

/**
 * The captain's 👍 on Firstmate's chat messages, by message id (the chat's
 * part id, from the transcript record), so every device shows the same marks.
 * It lives beside the message store, in Wheelhouse's own state directory. It is
 * bounded (the oldest marks are forgotten first); a missing or unreadable file
 * means nothing is marked, and a failed write keeps the marks in memory.
 */

export const REACTIONS_SCHEMA = 'wheelhouse-chat-reactions.v1';
export const MAX_REACTIONS = 1000;
const ID = /^[\w:.-]{1,200}$/;

export function reactionsFileFor(stateDir: string, homeDir: string): string {
	return path.join(path.dirname(storeFileFor(stateDir, homeDir)), 'chat-reactions.json');
}

/** Whether `v` can name a chat message. */
export function isReactionId(v: unknown): v is string {
	return typeof v === 'string' && ID.test(v);
}

export class ReactionStore {
	private ids: string[] = [];
	private writing: Promise<void> = Promise.resolve();

	private constructor(
		readonly file: string,
		private home: string,
		private max: number
	) {}

	static async open(file: string, home: string, max = MAX_REACTIONS): Promise<ReactionStore> {
		const store = new ReactionStore(file, home, max);
		try {
			const doc = JSON.parse(await readFile(file, 'utf8'));
			if (doc?.schema === REACTIONS_SCHEMA && Array.isArray(doc.liked)) {
				store.ids = [...new Set((doc.liked as unknown[]).filter(isReactionId))].slice(-max);
			}
		} catch {
			// nothing marked yet
		}
		return store;
	}

	/** The marked message ids, oldest first. */
	list(): readonly string[] {
		return this.ids;
	}

	/** Marks or unmarks a message, and saves. */
	set(id: string, on: boolean): Promise<void> {
		if (!isReactionId(id) || this.ids.includes(id) === on) return Promise.resolve();
		this.ids = on ? [...this.ids, id].slice(-this.max) : this.ids.filter((x) => x !== id);
		const write = this.writing.then(() => this.write());
		this.writing = write.catch(() => {});
		return write;
	}

	private async write(): Promise<void> {
		const text = `${JSON.stringify({ schema: REACTIONS_SCHEMA, home: this.home, liked: this.ids }, null, '\t')}\n`;
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
