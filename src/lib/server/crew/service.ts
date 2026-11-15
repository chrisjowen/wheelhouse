import { randomBytes } from 'node:crypto';
import { open, readdir } from 'node:fs/promises';
import path from 'node:path';
import {
	canDiscuss,
	closedText,
	CREW_KINDS,
	CREW_SCHEMA,
	CREW_TEXT_MAX,
	crewBody,
	crewRef,
	crewText,
	digestText,
	parseCrewBody,
	type CrewDiscussion,
	type CrewKind,
	type CrewMessage,
	type CrewView
} from '../../crew';
import { NOTE_MAX_BYTES, TASK_ID } from '../firstmate/adapter';
import { parseInboxRecord } from '../buildlog/conversation';
import type { DiscussionStore } from './store';

/**
 * Crew discussions (lib/crew.ts): opening and ending them, and sending what
 * the captain says to the worker.
 *
 * A message is recorded before fm-send.sh runs, and its inbox record carries
 * the message's reference, so sending one again after a failure or a restart
 * first looks for that record and never puts a second copy in the inbox. While
 * a sent message is unread, the task's inbox is looked at every few seconds:
 * the worker moving its record to handled/ marks it seen. Firstmate is handed
 * a short note of each message (and of the end of a discussion where
 * something was said or the worker was left paused), so it knows the captain
 * spoke to its worker.
 */

export type CrewResult<T> =
	{ ok: true; value: T } | { ok: false; status: 400 | 404 | 409 | 413 | 503; error: string };

/** The task facts a discussion needs, from the fleet. */
export interface CrewTask {
	id: string;
	title: string;
	projectId: string;
	status: string;
	secondMate?: unknown;
}

export interface CrewServiceOptions {
	store: DiscussionStore;
	/** Firstmate's operational home: tasks' inboxes are under its state/. */
	homeDir: string;
	/** fm-send.sh for one task (adapter.steer). */
	steer: (taskId: string, body: string) => Promise<{ ok: true } | { ok: false; error: string }>;
	/** Hand Firstmate a note (the messenger, no task); null when messaging is off. */
	tell: ((requestId: string, text: string) => Promise<boolean>) | null;
	/** A task in the fleet, or null. */
	task: (id: string) => CrewTask | null;
	now?: () => number;
	/** How often unread messages' receipts are looked for. */
	pollMs?: number;
}

/** A record's head holds its headers and the marker line. */
const HEAD_BYTES = 1024;
const MSG_NAME = /^[\w.-]+\.msg$/;
/** fm-inbox.sh's request id rule, kept short enough for Firstmate's note to add `.fm`. */
const CREW_REQUEST_ID = /^(?!\.)[A-Za-z0-9._:-]{1,100}$/;

async function readHead(file: string): Promise<string | null> {
	const fh = await open(file, 'r').catch(() => null);
	if (!fh) return null;
	try {
		const buf = Buffer.alloc(HEAD_BYTES);
		const { bytesRead } = await fh.read(buf, 0, HEAD_BYTES, 0);
		return buf.subarray(0, bytesRead).toString('utf8');
	} finally {
		await fh.close();
	}
}

export class CrewService {
	private opts: CrewServiceOptions;
	private now: () => number;
	private listeners = new Set<(v: CrewView) => void>();
	private lastEmitted = '';
	/** The reference each inbox record carries (null for none), by `<task>/<dir>/<name>`. */
	private refs = new Map<string, string | null>();
	private timer: ReturnType<typeof setInterval> | null = null;
	private polling: Promise<void> | null = null;

	constructor(opts: CrewServiceOptions) {
		this.opts = opts;
		this.now = opts.now ?? Date.now;
		this.arm();
	}

	view(): CrewView {
		return {
			schema: CREW_SCHEMA,
			available: true,
			reason: this.opts.store.file
				? null
				: 'Discussions are kept only until Wheelhouse restarts: its state directory is inside the Firstmate home.',
			discussions: structuredClone([...this.opts.store.list()])
		};
	}

	subscribe(fn: (v: CrewView) => void): () => void {
		this.listeners.add(fn);
		return () => this.listeners.delete(fn);
	}

	private emit(): void {
		const v = this.view();
		const key = JSON.stringify(v);
		if (key === this.lastEmitted) return;
		this.lastEmitted = key;
		for (const fn of this.listeners) {
			try {
				fn(v);
			} catch {
				// a broken subscriber must not stop the others
			}
		}
	}

	private iso(): string {
		return new Date(this.now()).toISOString();
	}

	/** Save, and say what changed; a failed write keeps the state in memory. */
	private async commit(): Promise<void> {
		await this.opts.store.save().catch(() => {});
		this.emit();
		this.arm();
	}

	/** Open a discussion on a task (opening one already open just returns it). */
	async open(taskId: string): Promise<CrewResult<CrewDiscussion>> {
		if (!TASK_ID.test(taskId))
			return { ok: false, status: 400, error: 'The task id is not valid.' };
		const known = this.opts.store.get(taskId);
		if (known) return { ok: true, value: known };
		const task = this.opts.task(taskId);
		if (!task) return { ok: false, status: 404, error: 'There is no such task in the fleet.' };
		if (!canDiscuss(task)) {
			return {
				ok: false,
				status: 409,
				error: task.secondMate
					? 'A second mate’s worker cannot be talked to directly yet.'
					: 'This task’s worker is not at work, so there is no one to talk to.'
			};
		}
		const d: CrewDiscussion = {
			taskId,
			title: task.title,
			projectId: task.projectId,
			openedAt: this.iso(),
			paused: false,
			messages: []
		};
		this.opts.store.add(d);
		await this.commit();
		return { ok: true, value: d };
	}

	/** End a discussion; Firstmate is told when something was said in it or the worker is paused. */
	async close(taskId: string): Promise<CrewResult<null>> {
		const d = this.opts.store.get(taskId);
		if (!d) return { ok: true, value: null };
		this.opts.store.remove(taskId);
		await this.commit();
		if ((d.paused || d.messages.some((m) => m.delivery === 'sent')) && this.opts.tell) {
			const id = `wh-crew-end-${this.now()}-${randomBytes(4).toString('hex')}`;
			await this.opts.tell(id, closedText(taskId, d.paused)).catch(() => {});
		}
		return { ok: true, value: null };
	}

	/**
	 * Send the captain's message (or a quick action) to the worker. The request
	 * id makes it safe to repeat: the same id returns the message, sending it
	 * again only when it failed.
	 */
	async send(
		taskId: string,
		requestId: string | null,
		kind: unknown,
		text: unknown
	): Promise<CrewResult<CrewMessage>> {
		if (!requestId || !CREW_REQUEST_ID.test(requestId)) {
			return { ok: false, status: 400, error: 'A valid Idempotency-Key header is required.' };
		}
		if (!CREW_KINDS.includes(kind as CrewKind)) {
			return { ok: false, status: 400, error: 'Say what kind of message this is.' };
		}
		const k = kind as CrewKind;
		if (k === 'say' && (typeof text !== 'string' || !text.trim())) {
			return { ok: false, status: 400, error: 'The message is empty.' };
		}
		const words = crewText(k, typeof text === 'string' ? text : '');
		if (words.length > CREW_TEXT_MAX) {
			return {
				ok: false,
				status: 413,
				error: `Messages to a worker are limited to ${CREW_TEXT_MAX} characters.`
			};
		}
		if (Buffer.byteLength(crewBody(crewRef(requestId), words)) > NOTE_MAX_BYTES) {
			return {
				ok: false,
				status: 413,
				error: `Messages to a worker are limited to ${NOTE_MAX_BYTES} bytes.`
			};
		}
		const d = this.opts.store.get(taskId);
		if (!d) {
			return {
				ok: false,
				status: 404,
				error: 'This discussion has ended. Start a new one from the task’s page.'
			};
		}
		let m = d.messages.find((x) => x.id === requestId);
		if (m) {
			if (m.kind !== k || m.text !== words) {
				return {
					ok: false,
					status: 409,
					error: 'This Idempotency-Key was already used for a different message.'
				};
			}
			if (m.delivery !== 'failed') return { ok: true, value: m };
		} else {
			m = {
				id: requestId,
				kind: k,
				text: words,
				at: this.iso(),
				delivery: 'sending',
				error: null,
				seen: false,
				told: 'sending'
			};
			d.messages.push(m);
		}
		m.delivery = 'sending';
		m.error = null;
		await this.commit();
		await this.deliver(d, m);
		return { ok: true, value: m };
	}

	private async deliver(d: CrewDiscussion, m: CrewMessage): Promise<void> {
		const ref = crewRef(m.id);
		// It may have landed before a failure or a restart cut the send off.
		const landed = (await this.findRecords(d.taskId)).get(ref);
		if (landed !== undefined) {
			m.delivery = 'sent';
			m.seen = landed;
		} else {
			const r = await this.opts.steer(d.taskId, crewBody(ref, m.text));
			m.delivery = r.ok ? 'sent' : 'failed';
			m.error = r.ok ? null : r.error;
		}
		if (m.delivery === 'sent' && m.kind === 'pause') d.paused = true;
		if (m.delivery === 'sent' && m.kind === 'resume') d.paused = false;
		await this.commit();
		if (m.delivery !== 'sent' || m.told === 'sent') return;
		if (!this.opts.tell) {
			m.told = 'off';
		} else {
			const told = await this.opts
				.tell(`${m.id}.fm`, digestText(d.taskId, m.kind, m.text))
				.catch(() => false);
			m.told = told ? 'sent' : 'failed';
		}
		await this.commit();
	}

	/**
	 * The captain sidebar records in a task's inbox, by reference: true once the
	 * worker has moved one to handled/. Records already read are remembered.
	 */
	private async findRecords(taskId: string): Promise<Map<string, boolean>> {
		const found = new Map<string, boolean>();
		if (!TASK_ID.test(taskId)) return found;
		const inbox = path.join(this.opts.homeDir, 'state', `${taskId}.inbox`);
		for (const [dir, handled] of [
			[inbox, false],
			[path.join(inbox, 'handled'), true]
		] as const) {
			const names = (await readdir(dir).catch(() => [] as string[])).filter((n) =>
				MSG_NAME.test(n)
			);
			for (const n of names) {
				const key = `${taskId}/${handled ? 'handled' : 'inbox'}/${n}`;
				let ref = this.refs.get(key);
				if (ref === undefined) {
					const head = await readHead(path.join(dir, n));
					if (head === null) continue;
					ref = parseCrewBody(parseInboxRecord(n, head, handled).body)?.ref ?? null;
					this.refs.set(key, ref);
				}
				if (ref) found.set(ref, handled || (found.get(ref) ?? false));
			}
		}
		return found;
	}

	/** Look for the worker reading any sent, unread message. */
	poll(): Promise<void> {
		this.polling ??= (async () => {
			let changed = false;
			for (const d of this.opts.store.list()) {
				const unread = d.messages.filter((m) => m.delivery === 'sent' && !m.seen);
				if (!unread.length) continue;
				const found = await this.findRecords(d.taskId);
				for (const m of unread) {
					if (found.get(crewRef(m.id))) {
						m.seen = true;
						changed = true;
					}
				}
			}
			if (changed) await this.commit();
			else this.arm();
		})().finally(() => (this.polling = null));
		return this.polling;
	}

	/** Poll while any sent message is unread; stop when none is. */
	private arm(): void {
		const waiting = this.opts.store
			.list()
			.some((d) => d.messages.some((m) => m.delivery === 'sent' && !m.seen));
		if (waiting && !this.timer) {
			this.timer = setInterval(() => void this.poll(), this.opts.pollMs ?? 3000);
			this.timer.unref?.();
		} else if (!waiting && this.timer) {
			clearInterval(this.timer);
			this.timer = null;
		}
	}

	stop(): void {
		if (this.timer) clearInterval(this.timer);
		this.timer = null;
	}
}
