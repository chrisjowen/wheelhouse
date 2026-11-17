import { watch, type FSWatcher } from 'node:fs';
import { open, readdir, readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import type { FirstmateSessionView, TranscriptSource } from '../../types';
import type { Harness } from '../../harness';
import { claudeConfigDir } from './commands';
import { trackFeed } from '../soundings/counters';

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
/** MCP tool calls kept for the chat's apps, newest last. */
export const MAX_TOOL_CALLS = 1000;
/** An MCP tool result larger than this is not kept for an app (it stays in the chat, cut). */
export const MAX_TOOL_RESULT_BYTES = 2 * 1024 * 1024;

/** Claude Code's projects directory (`$CLAUDE_CONFIG_DIR/projects`, else `~/.claude/projects`). */
export function projectsDir(env: NodeJS.ProcessEnv): string {
	return path.join(claudeConfigDir(env), 'projects');
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
export async function transcriptCwd(file: string): Promise<string | null> {
	return (await transcriptFacts(file)).cwd;
}

/**
 * What a transcript's first lines say about it: the working directory its
 * records name, and how Claude Code was started (`cli` for an interactive
 * session; `sdk-cli` for `claude -p`, as Firstmate's supervision helpers run).
 */
async function transcriptFacts(
	file: string
): Promise<{ cwd: string | null; entrypoint: string | null }> {
	let fh;
	let cwd: string | null = null;
	let entrypoint: string | null = null;
	try {
		fh = await open(file, 'r');
		const buf = Buffer.alloc(PEEK_BYTES);
		const { bytesRead } = await fh.read(buf, 0, PEEK_BYTES, 0);
		for (const line of buf.subarray(0, bytesRead).toString('utf8').split('\n')) {
			const m: RegExpMatchArray | null = cwd ? null : line.match(/"cwd":"((?:[^"\\]|\\.)*)"/);
			if (m) cwd = JSON.parse(`"${m[1]}"`) as string;
			const e: RegExpMatchArray | null = entrypoint ? null : line.match(/"entrypoint":"([\w-]*)"/);
			if (e) entrypoint = e[1];
			if (cwd && entrypoint) break;
		}
	} catch {
		// unreadable: not a candidate
	} finally {
		await fh?.close();
	}
	return { cwd, entrypoint };
}

/**
 * Every Claude Code transcript of Firstmate's own sessions in its checkout,
 * for the chat archive: those whose records name Firstmate's checkout as their
 * working directory, leaving out `claude -p` helpers (entrypoint `sdk-cli`),
 * which the chat never shows. A project folder holds the transcripts of one
 * working directory, so only one transcript per folder is read to choose it.
 * What a transcript or folder says about itself never changes, so each is
 * read once (`known` keeps it between calls, by path).
 */
export async function homeTranscripts(
	o: { firstmateDir: string; projectsDir: string },
	known: Map<string, boolean> = new Map()
): Promise<string[]> {
	const dir = await real(o.firstmateDir);
	let dirs: string[];
	try {
		dirs = await readdir(o.projectsDir);
	} catch {
		return [];
	}
	const out: string[] = [];
	for (const d of dirs) {
		const folder = path.join(o.projectsDir, d);
		let files: string[];
		try {
			files = (await readdir(folder)).filter((f) => f.endsWith('.jsonl')).sort();
		} catch {
			continue;
		}
		let ours = known.get(folder);
		for (const f of files) {
			if (ours === false) break;
			const file = path.join(folder, f);
			let keep = known.get(file);
			if (keep === undefined) {
				const facts = await transcriptFacts(file);
				if (!facts.cwd) continue; // nothing written yet: looked at again next time
				if (ours === undefined) {
					ours = (await real(facts.cwd)) === dir;
					known.set(folder, ours);
				}
				keep = ours && facts.entrypoint !== 'sdk-cli';
				known.set(file, keep);
			}
			if (keep) out.push(file);
		}
	}
	return out;
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

/**
 * An MCP tool call Firstmate made, as its transcript records it: the tool's
 * name as Claude Code gives it (`mcp__<server>__<tool>`), its arguments, and
 * its result's text content, uncut, once it has one. Claude Code keeps only a
 * result's content blocks, never its structured content; images are left out.
 */
export interface ToolCall {
	id: string;
	name: string;
	input: Record<string, unknown>;
	result:
		{ content: { type: 'text'; text: string }[]; isError: boolean } | { tooLarge: true } | null;
}

/** A tool result's text, as MCP text content blocks, or null when it is too large to keep. */
function toolContent(content: unknown): { type: 'text'; text: string }[] | null {
	const blocks: { type: 'text'; text: string }[] =
		typeof content === 'string'
			? [{ type: 'text', text: content }]
			: Array.isArray(content)
				? content
						.filter((b: TranscriptRecord) => b?.type === 'text')
						.map((b: TranscriptRecord) => ({ type: 'text' as const, text: String(b.text ?? '') }))
				: [];
	const bytes = blocks.reduce((n, b) => n + Buffer.byteLength(b.text), 0);
	return bytes > MAX_TOOL_RESULT_BYTES ? null : blocks;
}

export type FeedEvent =
	| { type: 'session'; data: FirstmateSessionView }
	| { type: 'reset'; data: TranscriptSource | null }
	| { type: 'records'; data: TranscriptRecord[] }
	| { type: 'replace'; data: TranscriptRecord[] }
	/** Sent to one page once it has the transcript as it stands (after a fresh read of the file). */
	| { type: 'synced'; data: null };

export interface ChatFeedOptions {
	/** The session's current status. */
	status: () => Promise<FirstmateSessionView>;
	/** Which transcript to follow for that status. */
	locate: (
		state: FirstmateSessionView['state'],
		harness?: Harness
	) => Promise<Omit<TranscriptSource, 'truncated'> | null>;
	/** Parse one native record into the shared conversation format before slimming or app lookup. */
	decode?: (raw: unknown, harness: Harness) => TranscriptRecord[];
	/** Native sources whose messages or active branch can change in place. */
	snapshot?: (session: FirstmateSessionView) => Promise<ConversationSnapshot | null>;
	pollMs?: number;
	/** How much of a large file to read when first opening it (INITIAL_BYTES). */
	initialBytes?: number;
	/** Keeps what the chat follows in the chat archive (chatarchive/archive.ts), in the background. */
	archive?: ArchiveHook;
}

/** The chat archive as the feed hands it what it follows; neither call is waited for. */
export interface ArchiveHook {
	/** The archive's key for the session a source holds. */
	key: (file: string) => string;
	/** A transcript file to keep up with, and how to read its lines. */
	file: (file: string, harness: Harness, decode: (raw: unknown) => TranscriptRecord[]) => void;
	/** A conversation read whole (Pi, OpenCode). */
	records: (file: string, harness: Harness, records: TranscriptRecord[]) => void;
}

export interface ConversationSnapshot {
	source: TranscriptSource;
	records: TranscriptRecord[];
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
	private calls = new Map<string, ToolCall>();
	private source: TranscriptSource | null = null;
	private session: FirstmateSessionView | null = null;
	private offset = 0;
	private partial: Buffer = Buffer.alloc(0);
	private watcher: FSWatcher | null = null;
	private timer: ReturnType<typeof setInterval> | null = null;
	private busy: Promise<void> | null = null;
	private again = false;
	private background: ReturnType<typeof setInterval> | null = null;

	constructor(opts: ChatFeedOptions) {
		this.opts = opts;
		trackFeed(this);
	}

	/** Whether no page listens (so it is not polling). */
	get idle(): boolean {
		return !this.listeners.size;
	}

	/** How many pages listen now (Soundings' count). */
	get listening(): number {
		return this.listeners.size;
	}

	/**
	 * Whether it watches its file or polls for pages now (Soundings' count): the watcher kept for
	 * the archive in the background (keepArchiving) is meant to stay, so it does not count.
	 */
	get watching(): boolean {
		return this.timer !== null || (this.watcher !== null && !this.background);
	}

	/** Start polling while anyone listens. */
	subscribe(listener: (e: FeedEvent) => void): () => void {
		this.listeners.add(listener);
		if (this.session) listener({ type: 'session', data: this.session });
		listener({ type: 'reset', data: this.source });
		if (this.records.length) listener({ type: 'records', data: this.records });
		if (!this.timer) this.timer = setInterval(() => void this.refresh(), this.opts.pollMs ?? 2000);
		// What it holds may be behind the file (or not read yet): read it now, then tell this page
		// it has the transcript so far, so it can place what depends on it (Chat about this).
		const synced = () => {
			if (this.listeners.has(listener)) listener({ type: 'synced', data: null });
		};
		void this.refresh().then(synced, synced);
		return () => {
			this.listeners.delete(listener);
			if (!this.listeners.size) this.stop();
		};
	}

	/**
	 * Re-check every `ms` while no page listens too, so the archive keeps up with
	 * the session when nobody has the chat open.
	 */
	keepArchiving(ms = 30_000): void {
		if (this.background || !this.opts.archive) return;
		this.background = setInterval(() => {
			if (!this.listeners.size) void this.refresh().catch(() => {});
		}, ms);
		this.background.unref?.();
		void this.refresh().catch(() => {});
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
		if (this.opts.snapshot && (session.harness === 'opencode' || session.harness === 'pi')) {
			let snapshot: ConversationSnapshot | null;
			try {
				snapshot = await this.opts.snapshot(session);
			} catch (error) {
				this.publishSession({
					...session,
					canSend: false,
					reason: error instanceof Error ? error.message : 'The conversation could not be read.'
				});
				return;
			}
			this.publishSession(session);
			this.watcher?.close();
			this.watcher = null;
			const source = snapshot?.source ?? null;
			if (source) {
				source.session = this.opts.archive?.key(source.file);
				if (snapshot && session.harness)
					this.opts.archive?.records(source.file, session.harness, snapshot.records);
			}
			const changed = source?.file !== this.source?.file;
			if (changed) this.emit({ type: 'reset', data: source });
			this.source = source;
			const records: TranscriptRecord[] = [];
			this.calls.clear();
			for (const record of snapshot?.records ?? []) {
				this.noteToolCalls(record);
				const compact = slim(record);
				if (compact) records.push(compact);
			}
			if (records.length > MAX_RECORDS) {
				records.splice(0, records.length - MAX_RECORDS);
				if (source) source.truncated = true;
			}
			if (changed || JSON.stringify(records) !== JSON.stringify(this.records)) {
				this.records = records;
				this.emit({ type: 'replace', data: records });
			}
			return;
		}
		this.publishSession(session);
		const found =
			session.harness && session.harness !== 'claude' && !this.opts.decode
				? null
				: await this.opts.locate(session.state, session.harness ?? 'claude');
		if (found?.file !== this.source?.file) {
			this.watcher?.close();
			this.watcher = null;
			this.records = [];
			this.calls.clear();
			this.offset = 0;
			this.partial = Buffer.alloc(0);
			const source: TranscriptSource | null = found
				? { ...found, truncated: false, session: this.opts.archive?.key(found.file) }
				: null;
			this.source = source;
			if (source) {
				try {
					const { size } = await stat(source.file);
					const initial = this.opts.initialBytes ?? INITIAL_BYTES;
					if (size > initial) {
						this.offset = size - initial;
						source.truncated = true;
					}
				} catch {
					// read below reports nothing; the next poll tries again
				}
			}
			this.emit({ type: 'reset', data: this.source });
		}
		// Only while a page listens or the archive is kept up in the background: a re-check
		// still running when the last page left must not start a watcher nothing stops.
		if (this.source && !this.watcher && (this.listeners.size || this.background)) {
			try {
				this.watcher = watch(this.source.file, () => void this.refresh());
				this.watcher.on('error', () => {});
			} catch {
				// not there yet; the next poll tries again
			}
		}
		if (this.source && this.opts.archive) {
			const harness = session.harness ?? 'claude';
			const decode = this.opts.decode;
			this.opts.archive.file(
				this.source.file,
				harness,
				decode
					? (raw) => decode(raw, harness)
					: (raw) =>
							raw && typeof raw === 'object' && !Array.isArray(raw) ? [raw as TranscriptRecord] : []
			);
		}
		if (this.source) await this.read(this.source.file);
	}

	private publishSession(session: FirstmateSessionView): void {
		if (JSON.stringify(session) !== JSON.stringify(this.session)) {
			this.session = session;
			this.emit({ type: 'session', data: session });
		}
	}

	private async read(file: string) {
		let fh;
		try {
			const { size } = await stat(file);
			if (size < this.offset) {
				// Rewritten from the start: follow it afresh.
				this.records = [];
				this.calls.clear();
				this.offset = 0;
				this.partial = Buffer.alloc(0);
				this.emit({ type: 'reset', data: this.source });
			}
			if (size === this.offset) return;
			fh = await open(file, 'r');
			const buf = Buffer.alloc(size - this.offset);
			const { bytesRead } = await fh.read(buf, 0, buf.length, this.offset);
			const startedMidway =
				this.offset > 0 &&
				this.records.length === 0 &&
				this.partial.length === 0 &&
				this.source?.truncated;
			this.offset += bytesRead;
			const chunk = Buffer.concat([this.partial, buf.subarray(0, bytesRead)]);
			const end = chunk.lastIndexOf(0x0a) + 1;
			// A copy: a view would keep the whole read alive until the next one.
			this.partial = Buffer.from(chunk.subarray(end));
			const lines = chunk.subarray(0, end).toString('utf8').split('\n');
			lines.pop();
			if (startedMidway) lines.shift(); // the first line was cut by the starting offset
			const fresh: TranscriptRecord[] = [];
			const seen = new Set(this.records.map((record) => record.uuid));
			for (const line of lines) {
				if (!line.trim()) continue;
				try {
					const raw = JSON.parse(line);
					const decoded = this.opts.decode
						? this.opts.decode(raw, this.session?.harness ?? 'claude')
						: [raw];
					for (const record of decoded) {
						// A native tool's completed event repeats the start so replay also works without it.
						if (this.opts.decode && this.session?.harness !== 'claude' && seen.has(record.uuid))
							continue;
						this.noteToolCalls(record);
						const r = slim(record);
						if (r) {
							fresh.push(r);
							seen.add(r.uuid);
						}
					}
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

	/** Keep the MCP tool calls in a raw record, and the results they get, for the chat's apps. */
	private noteToolCalls(r: TranscriptRecord) {
		if (!r || typeof r !== 'object' || r.isSidechain) return;
		const content = r.message?.content;
		if (!Array.isArray(content)) return;
		for (const b of content) {
			if (r.type === 'assistant' && b?.type === 'tool_use' && typeof b.id === 'string') {
				const name = String(b.name ?? '');
				if (!name.startsWith('mcp__')) continue;
				const input =
					b.input && typeof b.input === 'object' && !Array.isArray(b.input) ? b.input : {};
				this.calls.set(b.id, { id: b.id, name, input, result: null });
				if (this.calls.size > MAX_TOOL_CALLS) {
					this.calls.delete(this.calls.keys().next().value!);
				}
			} else if (r.type === 'user' && b?.type === 'tool_result') {
				const call = this.calls.get(b.tool_use_id);
				if (!call) continue;
				const c = toolContent(b.content);
				call.result = c ? { content: c, isError: !!b.is_error } : { tooLarge: true };
			}
		}
	}

	/** An MCP tool call in the transcript, by its `tool_use` id, or null. */
	toolCall(id: string): ToolCall | null {
		return this.calls.get(id) ?? null;
	}

	/** Records currently held (newest last). */
	snapshot(): TranscriptRecord[] {
		return this.records;
	}

	/** Stops the background re-checks too. */
	close() {
		if (this.background) clearInterval(this.background);
		this.background = null;
		this.stop();
	}

	stop() {
		if (this.timer) clearInterval(this.timer);
		this.timer = null;
		this.watcher?.close();
		this.watcher = null;
	}
}
