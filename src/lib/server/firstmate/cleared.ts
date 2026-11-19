import { randomBytes } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { storeFileFor } from '../store/store';

/**
 * When the captain last cleared the chat's view: the chat shows only what came
 * after it, with the rest a "Show earlier messages" away, on every device.
 * Clearing hides messages from the screen only; the stored history and
 * Firstmate's conversation are never touched, and nothing is sent to Firstmate.
 * It lives beside the message store, in Wheelhouse's own state directory; a
 * missing or unreadable file means the chat was never cleared, and a failed
 * write keeps the mark in memory.
 */

export const CLEARED_SCHEMA = 'wheelhouse-chat-cleared.v1';

export function clearedFileFor(stateDir: string, homeDir: string): string {
	return path.join(path.dirname(storeFileFor(stateDir, homeDir)), 'chat-cleared.json');
}

const isTime = (v: unknown): v is string =>
	typeof v === 'string' && v.length <= 40 && Number.isFinite(Date.parse(v));

export class ClearedStore {
	private at: string | null = null;
	private writing: Promise<void> = Promise.resolve();

	private constructor(
		readonly file: string,
		private home: string
	) {}

	static async open(file: string, home: string): Promise<ClearedStore> {
		const store = new ClearedStore(file, home);
		try {
			const doc = JSON.parse(await readFile(file, 'utf8'));
			if (doc?.schema === CLEARED_SCHEMA && isTime(doc.clearedAt))
				store.at = new Date(doc.clearedAt).toISOString();
		} catch {
			// never cleared
		}
		return store;
	}

	/** When the view was last cleared (ISO time), or null when it shows everything. */
	clearedAt(): string | null {
		return this.at;
	}

	/** Clears the view as of `at` (now by default), or with null shows everything again, and saves. */
	set(at: Date | null = new Date()): Promise<void> {
		this.at = at ? at.toISOString() : null;
		const write = this.writing.then(() => this.write());
		this.writing = write.catch(() => {});
		return write;
	}

	private async write(): Promise<void> {
		const text = `${JSON.stringify({ schema: CLEARED_SCHEMA, home: this.home, clearedAt: this.at }, null, '\t')}\n`;
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
