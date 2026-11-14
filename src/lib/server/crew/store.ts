import { randomBytes } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { CREW_KINDS, type CrewDiscussion, type CrewMessage } from '../../crew';
import { storeFileFor } from '../store/store';

/**
 * The open crew discussions and what the captain said in each, so a restart
 * or another device shows the same. It lives beside the message store, in
 * Wheelhouse's own state directory; a missing or unreadable file means none is
 * open, and a failed write keeps them in memory. Ending a discussion removes
 * it. `memory()` keeps them only until Wheelhouse restarts (a state directory
 * inside the Firstmate home).
 */

export const DISCUSSIONS_SCHEMA = 'wheelhouse-crew-discussions.v1';
/** The most messages kept per discussion (the oldest are forgotten first). */
export const MAX_MESSAGES = 200;
/** The most discussions open at once. */
export const MAX_DISCUSSIONS = 20;

export function discussionsFileFor(stateDir: string, homeDir: string): string {
	return path.join(path.dirname(storeFileFor(stateDir, homeDir)), 'crew-discussions.json');
}

const str = (v: unknown): v is string => typeof v === 'string';

function readMessage(v: unknown): CrewMessage | null {
	const m = v as Record<string, unknown> | null;
	if (!m || typeof m !== 'object' || !str(m.id) || !str(m.text) || !str(m.at)) return null;
	if (!CREW_KINDS.includes(m.kind as CrewMessage['kind'])) return null;
	// A send cut off by a restart is not known to have landed: it can be sent again.
	const delivery =
		m.delivery === 'sent'
			? 'sent'
			: m.delivery === 'failed' || m.delivery === 'sending'
				? 'failed'
				: null;
	if (!delivery) return null;
	const told = ['sent', 'failed', 'off'].includes(m.told as string)
		? (m.told as CrewMessage['told'])
		: 'failed';
	return {
		id: m.id,
		kind: m.kind as CrewMessage['kind'],
		text: m.text,
		at: m.at,
		delivery,
		error:
			delivery === 'failed'
				? str(m.error)
					? m.error
					: 'Wheelhouse stopped before it knew whether this was delivered.'
				: null,
		seen: m.seen === true,
		told
	};
}

function readDiscussion(v: unknown): CrewDiscussion | null {
	const d = v as Record<string, unknown> | null;
	if (!d || typeof d !== 'object' || !str(d.taskId) || !str(d.openedAt)) return null;
	return {
		taskId: d.taskId,
		title: str(d.title) ? d.title : d.taskId,
		projectId: str(d.projectId) ? d.projectId : '',
		openedAt: d.openedAt,
		paused: d.paused === true,
		messages: (Array.isArray(d.messages) ? d.messages : [])
			.map(readMessage)
			.filter((m): m is CrewMessage => !!m)
			.slice(-MAX_MESSAGES)
	};
}

export class DiscussionStore {
	private items: CrewDiscussion[] = [];
	private writing: Promise<void> = Promise.resolve();

	private constructor(
		/** null: kept in memory only. */
		readonly file: string | null,
		private home: string
	) {}

	static async open(file: string, home: string): Promise<DiscussionStore> {
		const store = new DiscussionStore(file, home);
		try {
			const doc = JSON.parse(await readFile(file, 'utf8'));
			if (doc?.schema === DISCUSSIONS_SCHEMA && Array.isArray(doc.discussions)) {
				store.items = (doc.discussions as unknown[])
					.map(readDiscussion)
					.filter((d): d is CrewDiscussion => !!d)
					.slice(-MAX_DISCUSSIONS);
			}
		} catch {
			// none open yet
		}
		return store;
	}

	static memory(home = ''): DiscussionStore {
		return new DiscussionStore(null, home);
	}

	/** The open discussions, oldest first. */
	list(): readonly CrewDiscussion[] {
		return this.items;
	}

	get(taskId: string): CrewDiscussion | null {
		return this.items.find((d) => d.taskId === taskId) ?? null;
	}

	add(d: CrewDiscussion): void {
		this.items = [...this.items.filter((x) => x.taskId !== d.taskId), d].slice(-MAX_DISCUSSIONS);
	}

	remove(taskId: string): void {
		this.items = this.items.filter((d) => d.taskId !== taskId);
	}

	/** Write the discussions as they stand; writes run one after another. */
	save(): Promise<void> {
		for (const d of this.items) d.messages = d.messages.slice(-MAX_MESSAGES);
		const write = this.writing.then(() => this.write());
		this.writing = write.catch(() => {});
		return write;
	}

	private async write(): Promise<void> {
		if (!this.file) return;
		const doc = { schema: DISCUSSIONS_SCHEMA, home: this.home, discussions: this.items };
		const text = `${JSON.stringify(doc, null, '\t')}\n`;
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
