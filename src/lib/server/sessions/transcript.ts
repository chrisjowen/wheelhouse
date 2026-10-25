import { watch, type FSWatcher } from 'node:fs';
import { open, readdir, readFile, realpath, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { FirstmateSessionView, TranscriptSource } from '../../types';

/**
 * Following the Firstmate session's Claude Code transcript (one JSON record
 * per line, appended as the session works) for the chat on the home page.
 * Read-only: the file is only ever opened for reading.
 *
 * Which file: Claude Code starts a new transcript on /clear and on a fresh
 * start, so the file is found again on every poll, in this order:
 *   1. hook - the input Wheelhouse's own SessionStart hook recorded for the
 *      session Wheelhouse runs (it names `transcript_path` exactly);
 *   2. lock - the Claude session id Firstmate records beside its session lock
 *      (`state/.lock-session`), looked up as `<id>.jsonl` under Claude Code's
 *      projects directory, which finds a session started outside Wheelhouse;
 *   3. newest - the newest transcript whose records name Firstmate's checkout
 *      as their working directory.
 * The projects directory's own folder names are never rebuilt by hand.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
export type TranscriptRecord = Record<string, any>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Read at most this much of a transcript when first opening it; earlier records are left out. */
export const INITIAL_BYTES = 8 * 1024 * 1024;
/** Keep at most this many records in memory for new viewers. */
export const MAX_RECORDS = 6000;
/** Tool output longer than this is cut (the full text stays in the transcript and the terminal). */
export const MAX_RESULT_CHARS = 16_000;
/** Bytes read from a candidate transcript to learn its working directory. */
const PEEK_BYTES = 64 * 1024;

/** Claude Code's projects directory (`$CLAUDE_CONFIG_DIR/projects`, else `~/.claude/projects`). */
export function projectsDir(env: NodeJS.ProcessEnv): string {
	return path.join(
		env.CLAUDE_CONFIG_DIR || path.join(env.HOME || os.homedir(), '.claude'),
		'projects'
	);
}

async function exists(file: string): Promise<boolean> {
	try {
		return (await stat(file)).isFile();
	} catch {
		return false;
	}
}

async function real(p: string): Promise<string> {
	try {
		return await realpath(p);
	} catch {
		return path.resolve(p);
	}
}

export interface LocateOptions {
	firstmateDir: string;
	homeDir: string;
	/** Wheelhouse's hook record (FirstmateSession.hookFile). */
	hookFile: string;
	projectsDir: string;
}

/** The session id beside Firstmate's lock, or null. */
async function lockSessionId(homeDir: string): Promise<string | null> {
	try {
		const id = (await readFile(path.join(homeDir, 'state', '.lock-session'), 'utf8'))
			.split('\n')[0]
			.trim();
		return UUID.test(id) ? id : null;
	} catch {
		return null;
	}
}

async function fromHook(
	o: LocateOptions,
	dir: string
): Promise<{ file: string; id: string | null } | null> {
	try {
		const rec = JSON.parse(await readFile(o.hookFile, 'utf8')) as Record<string, unknown>;
		const file = typeof rec.transcript_path === 'string' ? rec.transcript_path : null;
		const cwd = typeof rec.cwd === 'string' ? rec.cwd : null;
		if (!file || !path.isAbsolute(file) || !cwd || (await real(cwd)) !== dir) return null;
		if (!isInsideDir(file, o.projectsDir) || !(await exists(file))) return null;
		return { file, id: typeof rec.session_id === 'string' ? rec.session_id : null };
	} catch {
		return null;
	}
}

const isInsideDir = (file: string, dir: string) => {
	const rel = path.relative(dir, file);
	return !!rel && !rel.startsWith('..') && !path.isAbsolute(rel);
};

async function byId(o: LocateOptions, id: string): Promise<string | null> {
	let dirs: string[];
	try {
		dirs = await readdir(o.projectsDir);
	} catch {
		return null;
	}
	for (const d of dirs) {
		const file = path.join(o.projectsDir, d, `${id}.jsonl`);
		if (await exists(file)) return file;
	}
	return null;
}

/** The working directory a transcript's records name, from its first lines. */
async function transcriptCwd(file: string): Promise<string | null> {
	let fh;
	try {
		fh = await open(file, 'r');
		const buf = Buffer.alloc(PEEK_BYTES);
		const { bytesRead } = await fh.read(buf, 0, PEEK_BYTES, 0);
		for (const line of buf.subarray(0, bytesRead).toString('utf8').split('\n')) {
			const m = line.match(/"cwd":"((?:[^"\\]|\\.)*)"/);
			if (m) return JSON.parse(`"${m[1]}"`) as string;
		}
	} catch {
		// unreadable: not a candidate
	} finally {
		await fh?.close();
	}
	return null;
}

async function newestFor(o: LocateOptions, dir: string): Promise<string | null> {
	let dirs: string[];
	try {
		dirs = await readdir(o.projectsDir);
	} catch {
		return null;
	}
	let best: { file: string; mtime: number } | null = null;
	for (const d of dirs) {
		const folder = path.join(o.projectsDir, d);
		let files: string[];
		try {
			files = (await readdir(folder)).filter((f) => f.endsWith('.jsonl'));
		} catch {
			continue;
		}
		let newest: { file: string; mtime: number } | null = null;
		for (const f of files) {
			try {
				const s = await stat(path.join(folder, f));
				if (!newest || s.mtimeMs > newest.mtime)
					newest = { file: path.join(folder, f), mtime: s.mtimeMs };
			} catch {
				// vanished
			}
		}
		if (!newest || (best && newest.mtime <= best.mtime)) continue;
		const cwd = await transcriptCwd(newest.file);
		if (cwd && (await real(cwd)) === dir) best = newest;
	}
	return best?.file ?? null;
}

/** Find the transcript the chat should follow for the session in `state`. */
export async function locateTranscript(
	o: LocateOptions,
	state: FirstmateSessionView['state']
): Promise<Omit<TranscriptSource, 'truncated'> | null> {
	const dir = await real(o.firstmateDir);
	const lockId = await lockSessionId(o.homeDir);
	const hook = await fromHook(o, dir);
	// The hook record describes the session Wheelhouse runs; trust it for another only when ids agree.
	if (hook && (state === 'ours' || (lockId && hook.id === lockId)))
		return { how: 'hook', file: hook.file };
	if (lockId) {
		const file = await byId(o, lockId);
		if (file) return { how: 'lock', file };
	}
	const file = await newestCached(o, dir);
	return file ? { how: 'newest', file } : null;
}

/** The newest-transcript search reads every project folder, so its answer is kept briefly. */
const NEWEST_TTL_MS = 30_000;
const newest = new Map<string, { at: number; file: string | null }>();

async function newestCached(o: LocateOptions, dir: string): Promise<string | null> {
	const key = `${o.projectsDir}\0${dir}`;
	const hit = newest.get(key);
	if (hit && Date.now() - hit.at < NEWEST_TTL_MS && (!hit.file || (await exists(hit.file)))) {
		return hit.file;
	}
	const file = await newestFor(o, dir);
	newest.set(key, { at: Date.now(), file });
	return file;
}

const KEEP_TYPES = new Set(['user', 'assistant', 'system', 'attachment', 'ai-title']);
const KEEP_ATTACHMENTS = new Set(['queued_command', 'hook_additional_context']);
const KEEP_SYSTEM = new Set(['turn_duration', 'away_summary', 'local_command']);

const cut = (s: string) =>
	s.length > MAX_RESULT_CHARS
		? `${s.slice(0, MAX_RESULT_CHARS)}\n… (${s.length - MAX_RESULT_CHARS} more characters in the terminal)`
		: s;

/**
 * The parts of a record the chat reads, or null for records it never shows.
 * Heavy fields (usage, structured tool results, file snapshots) are dropped
 * and long tool output is cut, so a day-long session stays small.
 */
export function slim(r: TranscriptRecord): TranscriptRecord | null {
	if (!r || typeof r !== 'object' || !KEEP_TYPES.has(r.type)) return null;
	if (r.type === 'attachment' && !KEEP_ATTACHMENTS.has(r.attachment?.type)) return null;
	if (r.type === 'system' && !KEEP_SYSTEM.has(r.subtype)) return null;
	const out: TranscriptRecord = {
		type: r.type,
		uuid: r.uuid,
		timestamp: r.timestamp
	};
	for (const k of [
		'isSidechain',
		'isMeta',
		'origin',
		'sourceToolUseID',
		'subtype',
		'durationMs',
		'content',
		'aiTitle',
		'attachment'
	]) {
		if (r[k] !== undefined) out[k] = r[k];
	}
	if (r.toolUseResult && typeof r.toolUseResult === 'object' && r.toolUseResult.answers) {
		out.toolUseResult = { answers: r.toolUseResult.answers };
	}
	const m = r.message;
	if (m && typeof m === 'object') {
		let content = m.content;
		if (Array.isArray(content)) {
			content = content.map((b: TranscriptRecord) => {
				if (b?.type !== 'tool_result') return b;
				const c =
					typeof b.content === 'string'
						? cut(b.content)
						: Array.isArray(b.content)
							? b.content.map((x: TranscriptRecord) =>
									x?.type === 'text'
										? { ...x, text: cut(String(x.text ?? '')) }
										: x?.type === 'image'
											? { type: 'image' }
											: x
								)
							: b.content;
				return { ...b, content: c };
			});
		}
		out.message = { id: m.id, role: m.role, content };
	}
	return out;
}

export type FeedEvent =
	| { type: 'session'; data: FirstmateSessionView }
	| { type: 'reset'; data: TranscriptSource | null }
	| { type: 'records'; data: TranscriptRecord[] };

export interface ChatFeedOptions {
	/** The session's current status. */
	status: () => Promise<FirstmateSessionView>;
	/** Which transcript to follow for that status. */
	locate: (
		state: FirstmateSessionView['state']
	) => Promise<Omit<TranscriptSource, 'truncated'> | null>;
	pollMs?: number;
	/** How much of a large file to read when first opening it (INITIAL_BYTES). */
	initialBytes?: number;
}

/**
 * One shared follower of the Firstmate transcript for every open page: it
 * re-checks the session and which file to follow every few seconds, reads new
 * complete lines as the file grows (holding back a line still being written),
 * starts over when the file changes or shrinks, and keeps the latest records
 * for pages that connect later.
 */
export class ChatFeed {
	private opts: ChatFeedOptions;
	private listeners = new Set<(e: FeedEvent) => void>();
	private records: TranscriptRecord[] = [];
	private source: TranscriptSource | null = null;
	private session: FirstmateSessionView | null = null;
	private offset = 0;
	private partial = '';
	private watcher: FSWatcher | null = null;
	private timer: ReturnType<typeof setInterval> | null = null;
	private busy: Promise<void> | null = null;
	private again = false;

	constructor(opts: ChatFeedOptions) {
		this.opts = opts;
	}

	/** Start polling while anyone listens. */
	subscribe(listener: (e: FeedEvent) => void): () => void {
		this.listeners.add(listener);
		if (this.session) listener({ type: 'session', data: this.session });
		listener({ type: 'reset', data: this.source });
		if (this.records.length) listener({ type: 'records', data: this.records });
		if (!this.timer) {
			this.timer = setInterval(() => void this.refresh(), this.opts.pollMs ?? 2000);
			void this.refresh();
		}
		return () => {
			this.listeners.delete(listener);
			if (!this.listeners.size) this.stop();
		};
	}

	private emit(e: FeedEvent) {
		for (const l of this.listeners) l(e);
	}

	/** Re-check the session and the file, and read anything new. Coalesces overlapping calls. */
	refresh(): Promise<void> {
		if (this.busy) {
			this.again = true;
			return this.busy;
		}
		this.busy = (async () => {
			do {
				this.again = false;
				await this.step();
			} while (this.again);
		})().finally(() => (this.busy = null));
		return this.busy;
	}

	private async step() {
		const session = await this.opts.status();
		if (JSON.stringify(session) !== JSON.stringify(this.session)) {
			this.session = session;
			this.emit({ type: 'session', data: session });
		}
		const found = await this.opts.locate(session.state);
		if (found?.file !== this.source?.file) {
			this.watcher?.close();
			this.watcher = null;
			this.records = [];
			this.offset = 0;
			this.partial = '';
			const source: TranscriptSource | null = found ? { ...found, truncated: false } : null;
			this.source = source;
			if (source) {
				try {
					const { size } = await stat(source.file);
					const initial = this.opts.initialBytes ?? INITIAL_BYTES;
					if (size > initial) {
						this.offset = size - initial;
						source.truncated = true;
					}
					this.watcher = watch(source.file, () => void this.refresh());
					this.watcher.on('error', () => {});
				} catch {
					// read below reports nothing; the next poll tries again
				}
			}
			this.emit({ type: 'reset', data: this.source });
		}
		if (this.source) await this.read(this.source.file);
	}

	private async read(file: string) {
		let fh;
		try {
			const { size } = await stat(file);
			if (size < this.offset) {
				// Rewritten from the start: follow it afresh.
				this.records = [];
				this.offset = 0;
				this.partial = '';
				this.emit({ type: 'reset', data: this.source });
			}
			if (size === this.offset) return;
			fh = await open(file, 'r');
			const buf = Buffer.alloc(size - this.offset);
			const { bytesRead } = await fh.read(buf, 0, buf.length, this.offset);
			const startedMidway =
				this.offset > 0 &&
				this.records.length === 0 &&
				this.partial === '' &&
				this.source?.truncated;
			this.offset += bytesRead;
			const lines = (this.partial + buf.subarray(0, bytesRead).toString('utf8')).split('\n');
			this.partial = lines.pop() ?? '';
			if (startedMidway) lines.shift(); // the first line was cut by the starting offset
			const fresh: TranscriptRecord[] = [];
			for (const line of lines) {
				if (!line.trim()) continue;
				try {
					const r = slim(JSON.parse(line));
					if (r) fresh.push(r);
				} catch {
					// a malformed line; skip it
				}
			}
			if (!fresh.length) return;
			this.records.push(...fresh);
			if (this.records.length > MAX_RECORDS)
				this.records.splice(0, this.records.length - MAX_RECORDS);
			this.emit({ type: 'records', data: fresh });
		} catch {
			// gone or unreadable for now; the next poll looks again
		} finally {
			await fh?.close();
		}
	}

	/** Records currently held (newest last). */
	snapshot(): TranscriptRecord[] {
		return this.records;
	}

	stop() {
		if (this.timer) clearInterval(this.timer);
		this.timer = null;
		this.watcher?.close();
		this.watcher = null;
	}
}
