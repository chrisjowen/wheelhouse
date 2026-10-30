import { randomBytes } from 'node:crypto';
import { appendFile, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { GatewayChannel } from '../../gateway';
import type { InboxChoice } from '../../inbox';
import type { SentRef } from './adapter';

/**
 * What the gateway remembers between restarts, in Wheelhouse's state
 * directory beside the home's message store (never in the Firstmate home):
 *
 *   notes    each message the captain sent from a channel: its request id and
 *            where it came from, so Firstmate's reply goes back under it and
 *            its delivery marks are put on once;
 *   sent     the messages the gateway sent, so a reply to one carries its task;
 *   buttons  the server-side side of every button: an opaque random token
 *            stands for an action, single-use and expiring, so the platform
 *            never holds anything that confers authority.
 *
 * Writes go to a temporary file renamed over the old one. The audit log
 * (AuditLog) is a separate append-only file.
 */

export const RECORD_SCHEMA = 'wheelhouse-gateway-record.v1';
const NOTES_CAP = 500;
const SENT_CAP = 500;
const BUTTONS_CAP = 1000;

export interface ChannelNote {
	requestId: string;
	channel: GatewayChannel;
	from: string;
	/** The captain's message. */
	ref: SentRef;
	taskId: string | null;
	at: string;
	/** Marks put on the captain's message: Firstmate has it, Firstmate read it. */
	delivered: boolean;
	read: boolean;
	/** Firstmate refused it and the captain was told. */
	failed: boolean;
	/** Which reply of Firstmate's was sent back (its time and a digest), so it goes once. */
	replied: string | null;
}

export interface SentMessage {
	channel: GatewayChannel;
	ref: SentRef;
	taskId: string | null;
	at: string;
	/** The text and link buttons, so a used button can settle the message without losing them. */
	text: string;
	links: { label: string; url: string }[];
}

export type ButtonAction =
	| { kind: 'note'; requestId: string; text: string; sent: string; taskId: string | null }
	| { kind: 'answer'; cardId: string; choice: InboxChoice; label: string };

export interface ButtonGrant {
	token: string;
	channel: GatewayChannel;
	action: ButtonAction;
	ref: SentRef | null;
	expiresAt: string;
	used: boolean;
}

interface RecordFile {
	schema: typeof RECORD_SCHEMA;
	notes: ChannelNote[];
	sent: SentMessage[];
	buttons: ButtonGrant[];
}

const sameRef = (a: SentRef | null, b: SentRef | null) =>
	!!a && !!b && a.chat === b.chat && a.id === b.id;

export class GatewayRecord {
	notes: ChannelNote[] = [];
	sent: SentMessage[] = [];
	buttons: ButtonGrant[] = [];
	private writing: Promise<void> = Promise.resolve();

	private constructor(
		readonly file: string,
		private now: () => number
	) {}

	/** Load the record; a missing or unreadable one starts empty (an unreadable one is moved aside). */
	static async open(file: string, now: () => number = Date.now): Promise<GatewayRecord> {
		const r = new GatewayRecord(file, now);
		let text: string | null = null;
		try {
			text = await readFile(file, 'utf8');
		} catch (e) {
			if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
		}
		if (text === null) return r;
		try {
			const parsed = JSON.parse(text) as Partial<RecordFile>;
			if (parsed.schema !== RECORD_SCHEMA) throw new Error('not a gateway record');
			r.notes = Array.isArray(parsed.notes) ? parsed.notes : [];
			r.sent = Array.isArray(parsed.sent) ? parsed.sent : [];
			r.buttons = Array.isArray(parsed.buttons) ? parsed.buttons : [];
		} catch {
			await rename(file, `${file}.unreadable-${Date.now()}`).catch(() => {});
		}
		return r;
	}

	note(requestId: string): ChannelNote | undefined {
		return this.notes.find((n) => n.requestId === requestId);
	}

	addNote(n: ChannelNote): void {
		if (this.note(n.requestId)) return;
		this.notes = [...this.notes, n].slice(-NOTES_CAP);
	}

	sentAt(ref: SentRef): SentMessage | undefined {
		return this.sent.find((s) => sameRef(s.ref, ref)) ?? this.sentNote(ref);
	}

	/** A reply to the captain's own earlier message carries that message's task. */
	private sentNote(ref: SentRef): SentMessage | undefined {
		const n = this.notes.find((x) => sameRef(x.ref, ref));
		return n
			? { channel: n.channel, ref: n.ref, taskId: n.taskId, at: n.at, text: '', links: [] }
			: undefined;
	}

	addSent(s: SentMessage): void {
		this.sent = [...this.sent, s].slice(-SENT_CAP);
	}

	/** A new button token for an action; it works until `ttlMs` from now, once. */
	grant(channel: GatewayChannel, action: ButtonAction, ttlMs: number): string {
		const token = randomBytes(16).toString('base64url');
		this.buttons.push({
			token,
			channel,
			action,
			ref: null,
			expiresAt: new Date(this.now() + ttlMs).toISOString(),
			used: false
		});
		return token;
	}

	/** Bind granted tokens to the message they were sent on. */
	attach(tokens: string[], ref: SentRef): void {
		for (const b of this.buttons) if (tokens.includes(b.token)) b.ref = ref;
	}

	/** Forget granted tokens whose message could not be sent. */
	revoke(tokens: string[]): void {
		this.buttons = this.buttons.filter((b) => !tokens.includes(b.token));
	}

	/** The grant behind a token: why it no longer works, or the grant. */
	button(token: string): { ok: true; grant: ButtonGrant } | { ok: false; why: string } {
		const b = this.buttons.find((x) => x.token === token);
		if (!b) return { ok: false, why: 'This button no longer works. Open Wheelhouse to act on it.' };
		if (b.used) return { ok: false, why: 'This button was already used.' };
		if (Date.parse(b.expiresAt) <= this.now()) {
			return { ok: false, why: 'This button has expired. Open Wheelhouse to act on it.' };
		}
		return { ok: true, grant: b };
	}

	/** Use up every button on a message (one press settles the message). */
	spend(ref: SentRef | null, token: string): void {
		for (const b of this.buttons) if (b.token === token || sameRef(b.ref, ref)) b.used = true;
	}

	save(): Promise<void> {
		const now = this.now();
		// Used and expired tokens are kept a day, so a late press still says why it does nothing.
		this.buttons = this.buttons
			.filter((b) => Date.parse(b.expiresAt) > now - 24 * 3600_000)
			.slice(-BUTTONS_CAP);
		const data: RecordFile = {
			schema: RECORD_SCHEMA,
			notes: this.notes,
			sent: this.sent,
			buttons: this.buttons
		};
		const text = JSON.stringify(data, null, '\t') + '\n';
		this.writing = this.writing.catch(() => {}).then(() => write(this.file, text));
		return this.writing;
	}
}

async function write(file: string, text: string): Promise<void> {
	await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
	const tmp = `${file}.tmp-${process.pid}-${randomBytes(4).toString('hex')}`;
	try {
		await writeFile(tmp, text, { mode: 0o600 });
		await rename(tmp, file);
	} catch (e) {
		await rm(tmp, { force: true });
		throw e;
	}
}

/** One line of the audit log. Never message text from a stranger, and never a token. */
export interface AuditEntry {
	event:
		| 'accept'
		| 'refuse'
		| 'send'
		| 'button'
		| 'pair'
		| 'unpair'
		| 'connect'
		| 'disconnect'
		| 'error';
	from?: string;
	/** The platform message (or press) id. */
	id?: string;
	requestId?: string;
	taskId?: string | null;
	/** What was sent (an alert kind, a reply, a notice), or what a button did. */
	what?: string;
	reason?: string;
}

/** Rotated to `<file>.1` past this size. */
const AUDIT_MAX_BYTES = 1024 * 1024;

/**
 * `<state-dir>/gateway/<channel>.jsonl`: every message accepted, every one
 * refused (with the reason), every send and every button press.
 */
export class AuditLog {
	private writing: Promise<void> = Promise.resolve();

	constructor(
		readonly file: string,
		private now: () => number = Date.now
	) {}

	/** Wait for the lines written so far. */
	flushed(): Promise<void> {
		return this.writing;
	}

	write(entry: AuditEntry): Promise<void> {
		const line = JSON.stringify({ at: new Date(this.now()).toISOString(), ...entry }) + '\n';
		this.writing = this.writing
			.catch(() => {})
			.then(async () => {
				await mkdir(path.dirname(this.file), { recursive: true, mode: 0o700 });
				const size = await stat(this.file).then(
					(s) => s.size,
					() => 0
				);
				if (size > AUDIT_MAX_BYTES) await rename(this.file, `${this.file}.1`);
				await appendFile(this.file, line, { mode: 0o600 });
			})
			.catch(() => {
				// the audit log must never stop the gateway
			});
		return this.writing;
	}
}
