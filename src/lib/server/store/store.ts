import { createHash, randomBytes } from 'node:crypto';
import { realpathSync } from 'node:fs';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { isChangeRequest } from '../firstmate/changes';
import type { Delivery } from '../../types';

/**
 * Wheelhouse's own record of the messages it sent to Firstmate: each message's
 * stable request id and body, its delivery outcome, the receipts Wheelhouse has
 * seen, and the receipts cursor. It lives under a Wheelhouse state directory,
 * never in the Firstmate home, with one file per Firstmate home so messages
 * sent to one home never show up against another.
 *
 * A task's change requests (preview feedback, a change asked from the PR
 * review, a Decisions "Fix") are its runs' record, so they are never dropped.
 *
 * Writes go to a temporary file that is renamed over the old one, so a crash
 * leaves either the old or the new record, never a torn one.
 */

export const STORE_SCHEMA = 'wheelhouse-message-store.v1';
/** The store keeps this many messages; the oldest are dropped beyond it, except change requests. */
export const STORE_MAX_MESSAGES = 500;

export interface StoredMessage {
	requestId: string;
	text: string;
	taskId: string | null;
	/** Exactly what was written to fm-inbox.sh (the text with any task prefix). */
	body: string;
	submittedAt: string;
	delivery: Delivery;
	deliveryDetail: string | null;
	noteId: string | null;
	acknowledged: boolean | null;
	announced: boolean | null;
	reply: { body: string; at: string | null; cursor: string } | null;
	/** How many times Wheelhouse has run `note` for this request id. */
	attempts: number;
	lastAttemptAt: string | null;
}

interface StoreFile {
	schema: typeof STORE_SCHEMA;
	home: string;
	receiptCursor: string;
	messages: StoredMessage[];
}

/** WHEELHOUSE_STATE_DIR, else $XDG_STATE_HOME/wheelhouse, else ~/.local/state/wheelhouse. */
export function defaultStateDir(env: NodeJS.ProcessEnv): string {
	if (env.WHEELHOUSE_STATE_DIR) return path.resolve(env.WHEELHOUSE_STATE_DIR);
	if (env.XDG_STATE_HOME) return path.join(path.resolve(env.XDG_STATE_HOME), 'wheelhouse');
	return path.join(env.HOME ?? '', '.local', 'state', 'wheelhouse');
}

/** The real path of `p`, resolving symlinks in the part of it that exists. */
function real(p: string): string {
	const abs = path.resolve(p);
	try {
		return realpathSync(abs);
	} catch {
		const parent = path.dirname(abs);
		return parent === abs ? abs : path.join(real(parent), path.basename(abs));
	}
}

/** The store file for one Firstmate home: <stateDir>/homes/<hash of the home path>/messages.json. */
export function storeFileFor(stateDir: string, homeDir: string): string {
	const key = createHash('sha256').update(real(homeDir)).digest('hex').slice(0, 16);
	return path.join(stateDir, 'homes', key, 'messages.json');
}

/** True when `p` is `dir` or inside it (after resolving symlinks that exist). */
export function isInside(p: string, dir: string): boolean {
	const rel = path.relative(real(dir), real(p));
	return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

const DELIVERIES: readonly Delivery[] = [
	'sending',
	'delivered',
	'saved-unannounced',
	'uncertain',
	'failed'
];

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);
const bool = (v: unknown): boolean | null => (typeof v === 'boolean' ? v : null);

function parseMessage(v: unknown): StoredMessage | null {
	if (!isObj(v)) return null;
	const requestId = str(v.requestId);
	const body = str(v.body);
	if (!requestId || body === null) return null;
	const delivery = DELIVERIES.includes(v.delivery as Delivery) ? (v.delivery as Delivery) : null;
	const reply = isObj(v.reply)
		? { body: str(v.reply.body) ?? '', at: str(v.reply.at), cursor: str(v.reply.cursor) ?? '' }
		: null;
	return {
		requestId,
		text: str(v.text) ?? body,
		taskId: str(v.taskId),
		body,
		submittedAt: str(v.submittedAt) ?? new Date(0).toISOString(),
		delivery: delivery ?? 'uncertain',
		deliveryDetail: str(v.deliveryDetail),
		noteId: str(v.noteId),
		acknowledged: bool(v.acknowledged),
		announced: bool(v.announced),
		reply,
		attempts: typeof v.attempts === 'number' ? v.attempts : 0,
		lastAttemptAt: str(v.lastAttemptAt)
	};
}

export class MessageStore {
	readonly file: string;
	readonly home: string;
	receiptCursor = '';
	/** Set when an unreadable store file was moved aside on load. */
	recovered: string | null = null;
	private list: StoredMessage[] = [];
	private writing: Promise<void> = Promise.resolve();

	private constructor(file: string, home: string) {
		this.file = file;
		this.home = home;
	}

	/**
	 * Load the store for `home`. A missing file is an empty store. An unreadable
	 * one is moved aside (never deleted) and the store starts empty. A message
	 * left `sending` by a Wheelhouse that stopped mid-send becomes `uncertain`,
	 * so the next reconciliation re-checks it with the same request id.
	 */
	static async open(file: string, home: string): Promise<MessageStore> {
		const store = new MessageStore(file, home);
		let text: string | null = null;
		try {
			text = await readFile(file, 'utf8');
		} catch (e) {
			if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
		}
		if (text !== null) {
			let parsed: unknown = null;
			try {
				parsed = JSON.parse(text);
			} catch {
				parsed = null;
			}
			if (isObj(parsed) && parsed.schema === STORE_SCHEMA && Array.isArray(parsed.messages)) {
				store.receiptCursor = str(parsed.receiptCursor) ?? '';
				store.list = parsed.messages
					.map(parseMessage)
					.filter((m): m is StoredMessage => m !== null);
			} else {
				const aside = `${file}.unreadable-${Date.now()}`;
				await rename(file, aside);
				store.recovered = aside;
			}
		}
		for (const m of store.list) {
			if (m.delivery === 'sending') {
				m.delivery = 'uncertain';
				m.deliveryDetail = 'Wheelhouse stopped while sending this; it is checking again.';
			}
		}
		return store;
	}

	messages(): readonly StoredMessage[] {
		return this.list;
	}

	get(requestId: string): StoredMessage | undefined {
		return this.list.find((m) => m.requestId === requestId);
	}

	add(m: StoredMessage): void {
		this.list.push(m);
		const over = this.list.length - STORE_MAX_MESSAGES;
		if (over > 0) {
			const drop = new Set(this.list.filter((x) => !isChangeRequest(x)).slice(0, over));
			this.list = this.list.filter((x) => !drop.has(x));
		}
	}

	remove(requestId: string): void {
		this.list = this.list.filter((m) => m.requestId !== requestId);
	}

	/** Write the store as it is now. Writes are serialised, so the latest save wins. */
	save(): Promise<void> {
		const data: StoreFile = {
			schema: STORE_SCHEMA,
			home: this.home,
			receiptCursor: this.receiptCursor,
			messages: this.list
		};
		const text = JSON.stringify(data, null, '\t') + '\n';
		this.writing = this.writing.catch(() => {}).then(() => this.write(text));
		return this.writing;
	}

	private async write(text: string): Promise<void> {
		await mkdir(path.dirname(this.file), { recursive: true, mode: 0o700 });
		const tmp = `${this.file}.tmp-${process.pid}-${randomBytes(4).toString('hex')}`;
		try {
			await writeFile(tmp, text, { mode: 0o600 });
			await rename(tmp, this.file);
		} catch (e) {
			await rm(tmp, { force: true });
			throw e;
		}
	}
}
