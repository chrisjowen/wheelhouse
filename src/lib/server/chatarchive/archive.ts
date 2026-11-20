import { createHash, randomBytes } from 'node:crypto';
import {
	appendFile,
	mkdir,
	open,
	readdir,
	readFile,
	rename,
	rm,
	stat,
	truncate,
	writeFile
} from 'node:fs/promises';
import path from 'node:path';
import type { Harness } from '../../harness';
import type { ChatArchiveStats, ChatSearchHit } from '../../types';
import { slim, type TranscriptRecord } from '../sessions/transcript';
import { storeFileFor } from '../store/store';

/**
 * The chat archive: every record the chat shows, from every Firstmate session
 * of one home, kept by Wheelhouse so the conversation survives Firstmate's
 * restarts, `/clear`, and transcripts too long to read whole. It lives in
 * Wheelhouse's state directory beside the home's message store:
 *
 *   chat-archive/index.json            the sessions, how far each source was read, the retention
 *   chat-archive/sessions/<key>.jsonl  the slimmed records of one session, append-only
 *
 * Records are slimmed as the chat slims them (sessions/transcript.ts) and kept
 * once each, by their `uuid`, across every session (a resumed session repeats
 * earlier records). The source is only ever read. A record is appended before
 * the index records how far its source was read, so a crash between the two
 * reads that part again and the duplicates are dropped.
 *
 * The sessions run in the order they started; each starts with a divider
 * record (`type: 'wh-session'`), which the chat shows as "Firstmate
 * restarted". Opening the archive reads only its index; the session files are
 * read on first use (a page, a search, the stats or the next record kept).
 * Pages of records, and the words a search reads, come from the files on demand:
 * only each record's id, time, place in its file and who wrote it are kept in
 * memory, and the words a search read for as long as searching goes on.
 */

export const ARCHIVE_SCHEMA = 'wheelhouse-chat-archive.v1';
/** A divider's record type, and its uuid's prefix (followed by the session key). */
export const DIVIDER = 'wh-session';
/** How long the words read for a search are kept after the last search. */
const SEARCH_KEEP_MS = 2 * 60_000;
/** Read a source at most this much at a time. */
const CHUNK_BYTES = 4 * 1024 * 1024;
/** A page goes back further than asked, to the start of the turn it would cut, by at most this many records. */
const TURN_SLACK = 2000;
/** Retention choices, in days (null keeps everything). */
export const RETENTION_DAYS = [null, 365, 180, 90, 30] as const;
export type Retention = (typeof RETENTION_DAYS)[number];

const DAY_MS = 86_400_000;
const SAFE_KEY = /^[\w.-]{1,100}$/;

export function archiveDirFor(stateDir: string, homeDir: string): string {
	return path.join(path.dirname(storeFileFor(stateDir, homeDir)), 'chat-archive');
}

/** The archive's key for the session a source file holds: its file name, else a hash of its path. */
export function sessionKey(file: string): string {
	const base = path.basename(file).replace(/\.jsonl?$/, '');
	return SAFE_KEY.test(base)
		? base
		: `s-${createHash('sha256').update(file).digest('hex').slice(0, 16)}`;
}

export const dividerId = (key: string) => `${DIVIDER}:${key}`;

export interface SessionMeta {
	key: string;
	harness: Harness;
	/** The source it was read from. */
	file: string;
	/** Its first and last record's time. */
	startedAt: string;
	endedAt: string;
}

interface IndexDoc {
	schema: string;
	home: string;
	retentionDays: Retention;
	sessions: SessionMeta[];
	/** How far each source file was read (whole lines only), whether or not it held records to keep. */
	offsets: Record<string, number>;
}

/** One record as memory keeps it: where it is in its session's file, and whose words a search reads. */
interface Entry {
	uuid: string;
	at: string;
	pos: number;
	len: number;
	/** The captain's words or Firstmate's reply; null for records that are neither. */
	who: 'captain' | 'firstmate' | null;
	/** A captain's message: a page may start here without cutting a turn. */
	start: boolean;
}

interface Session {
	meta: SessionMeta;
	entries: Entry[];
	bytes: number;
}

export interface ArchivePage {
	/** Oldest first, with a divider record before each session's first record. */
	records: TranscriptRecord[];
	/** Earlier records remain. */
	more: boolean;
}

export type SearchHit = ChatSearchHit;

export interface ArchiveStats extends ChatArchiveStats {
	retentionDays: Retention;
}

const isRetention = (v: unknown): v is Retention => RETENTION_DAYS.some((d) => d === v);

const captainString = (r: TranscriptRecord, c: string) =>
	!r.isMeta &&
	r.origin?.kind !== 'task-notification' &&
	!c.trimStart().startsWith('<task-notification>') &&
	!c.includes('<local-command-stdout>') &&
	!c.includes('<command-name>');

/** The words of a record a search reads: the captain's message or Firstmate's reply. */
export function searchable(
	r: TranscriptRecord
): { who: 'captain' | 'firstmate'; text: string } | null {
	if (r.isSidechain) return null;
	const c = r.message?.content;
	if (r.type === 'user') {
		if (typeof c === 'string') return captainString(r, c) ? { who: 'captain', text: c } : null;
		if (!Array.isArray(c) || r.isMeta || r.sourceToolUseID) return null;
		const text = c
			.filter((b: TranscriptRecord) => b?.type === 'text')
			.map((b: TranscriptRecord) => String(b.text ?? ''))
			.join('\n');
		return text.trim() ? { who: 'captain', text } : null;
	}
	if (r.type === 'attachment' && r.attachment?.type === 'queued_command') {
		const p = r.attachment.prompt;
		return typeof p === 'string' && p.trim() ? { who: 'captain', text: p } : null;
	}
	if (r.type === 'assistant' && Array.isArray(c)) {
		const text = c
			.filter((b: TranscriptRecord) => b?.type === 'text')
			.map((b: TranscriptRecord) => String(b.text ?? ''))
			.join('\n');
		return text.trim() ? { who: 'firstmate', text } : null;
	}
	return null;
}

/** Thread markers and other HTML comments, which a search neither reads nor shows. */
const COMMENT = /<!--[\s\S]*?-->/g;

/** The words of a record a search reads, without thread markers; null when it has none. */
function searchText(r: TranscriptRecord): { who: 'captain' | 'firstmate'; text: string } | null {
	const found = searchable(r);
	const text = found?.text.replace(COMMENT, '').trim() || null;
	return found && text ? { who: found.who, text } : null;
}

function entryOf(r: TranscriptRecord, pos: number, len: number): Entry {
	// Fresh strings: a slice of the line read would keep the whole read alive.
	const who = searchText(r)?.who ?? null;
	return {
		uuid: copy(String(r.uuid)),
		at: typeof r.timestamp === 'string' ? copy(r.timestamp) : '',
		pos,
		len,
		who,
		start: who === 'captain'
	};
}

const copy = (s: string) => Buffer.from(s, 'utf8').toString('utf8');

/** A record's id: its own `uuid`, else one made from its content, so a record without one is still kept once. */
function idOf(r: TranscriptRecord): string {
	if (typeof r.uuid === 'string' && r.uuid) return r.uuid;
	return `h:${createHash('sha256').update(JSON.stringify(r)).digest('hex').slice(0, 32)}`;
}

export class ChatArchive {
	private sessions = new Map<string, Session>();
	/** Session keys in the order they started. */
	private order: string[] = [];
	/** Every record's session and place in it, by uuid. */
	private where = new Map<string, { key: string; i: number }>();
	private retention: Retention = null;
	private offsets = new Map<string, number>();
	private queue: Promise<unknown> = Promise.resolve();
	/** The sessions the index names, until they are read (on first use). */
	private unread: SessionMeta[] = [];
	private loading: Promise<void> | null = null;
	/** Each session's searchable words, by record, while searching goes on (search). */
	private words = new Map<string, (string | null)[]>();
	private wordsTimer: ReturnType<typeof setTimeout> | null = null;

	private constructor(
		readonly dir: string,
		private home: string
	) {}

	/**
	 * Opens the archive in `dir`, reading only its index: what it holds is read
	 * back on first use (load). A missing or unreadable index starts an empty
	 * archive.
	 */
	static async open(dir: string, home: string): Promise<ChatArchive> {
		const a = new ChatArchive(dir, home);
		let doc: IndexDoc | null = null;
		try {
			const raw = JSON.parse(await readFile(a.indexFile, 'utf8'));
			if (raw?.schema === ARCHIVE_SCHEMA && Array.isArray(raw.sessions)) doc = raw as IndexDoc;
		} catch {
			// a new archive
		}
		a.retention = isRetention(doc?.retentionDays) ? doc!.retentionDays : null;
		for (const [file, n] of Object.entries(doc?.offsets ?? {}))
			if (typeof n === 'number' && n >= 0) a.offsets.set(file, n);
		const metas = (doc?.sessions ?? []).filter(
			(m) => m && typeof m.key === 'string' && SAFE_KEY.test(m.key.replace(/^s-/, ''))
		);
		// A session file the index lost (a crash before its first index write) is kept too.
		let files: string[] = [];
		try {
			files = (await readdir(a.sessionsDir)).filter((f) => f.endsWith('.jsonl'));
		} catch {
			// none yet
		}
		const known = new Set(metas.map((m) => m.key));
		for (const f of files) {
			const key = f.slice(0, -'.jsonl'.length);
			if (!known.has(key) && SAFE_KEY.test(key))
				metas.push({ key, harness: 'claude', file: '', startedAt: '', endedAt: '' });
		}
		a.unread = metas;
		return a;
	}

	/**
	 * Reads back every session the index named, once. A session file with an
	 * unfinished last line (a crash mid-write) is cut back to its last whole line.
	 */
	private loaded(): Promise<void> {
		this.loading ??= (async () => {
			const metas = this.unread;
			this.unread = [];
			for (const meta of metas) await this.load(meta);
			this.sort();
		})();
		return this.loading;
	}

	private get indexFile() {
		return path.join(this.dir, 'index.json');
	}

	private get sessionsDir() {
		return path.join(this.dir, 'sessions');
	}

	private fileOf(key: string) {
		return path.join(this.sessionsDir, `${key}.jsonl`);
	}

	private async load(meta: SessionMeta): Promise<void> {
		const file = this.fileOf(meta.key);
		let buf: Buffer;
		try {
			buf = await readFile(file);
		} catch {
			return; // its records are gone: the session is forgotten
		}
		const end = buf.lastIndexOf(0x0a) + 1;
		if (end < buf.length) await truncate(file, end).catch(() => {});
		const s: Session = { meta: { ...meta }, entries: [], bytes: end };
		let pos = 0;
		while (pos < end) {
			const nl = buf.indexOf(0x0a, pos);
			const len = nl - pos + 1;
			try {
				const r = JSON.parse(buf.subarray(pos, nl).toString('utf8')) as TranscriptRecord;
				const id = idOf(r);
				if (!this.where.has(id)) {
					this.where.set(id, { key: meta.key, i: s.entries.length });
					s.entries.push(entryOf({ ...r, uuid: id }, pos, len));
				}
			} catch {
				// a damaged line; skip it
			}
			pos = nl + 1;
		}
		if (!s.entries.length) return;
		s.meta.startedAt = s.meta.startedAt || s.entries[0].at;
		s.meta.endedAt = s.entries[s.entries.length - 1].at || s.meta.endedAt;
		this.sessions.set(meta.key, s);
	}

	private sort() {
		this.order = [...this.sessions.values()]
			.sort((a, b) => a.meta.startedAt.localeCompare(b.meta.startedAt))
			.map((s) => s.meta.key);
	}

	/** Runs `fn` after every change already asked for, one at a time. */
	private serial<T>(fn: () => Promise<T>): Promise<T> {
		const run = this.queue.then(fn, fn);
		this.queue = run.catch(() => {});
		return run;
	}

	/** Waits for every change asked for so far. */
	settled(): Promise<void> {
		return this.serial(async () => {});
	}

	/**
	 * Reads what is new in a source file since it was last read (all of it the
	 * first time) and keeps the records the chat shows. `decode` turns one parsed
	 * line into the shared record format (codex.ts, grok.ts). A file shorter than
	 * what was read was rewritten, and is read again from its start.
	 */
	ingestFile(
		file: string,
		harness: Harness,
		decode: (raw: unknown) => TranscriptRecord[] = (raw) =>
			raw && typeof raw === 'object' && !Array.isArray(raw) ? [raw as TranscriptRecord] : []
	): Promise<number> {
		return this.serial(async () => {
			await this.loaded();
			const key = sessionKey(file);
			let offset = this.offsets.get(file) ?? 0;
			let size: number;
			try {
				size = (await stat(file)).size;
			} catch {
				return 0;
			}
			if (size < offset) offset = 0;
			if (size === offset) return 0;
			let added = 0;
			let fh;
			try {
				fh = await open(file, 'r');
				let partial: Buffer = Buffer.alloc(0);
				while (offset + partial.length < size) {
					const want = Math.min(CHUNK_BYTES, size - offset - partial.length);
					const buf = Buffer.alloc(want);
					const { bytesRead } = await fh.read(buf, 0, want, offset + partial.length);
					if (!bytesRead) break;
					const chunk = Buffer.concat([partial, buf.subarray(0, bytesRead)]);
					const end = chunk.lastIndexOf(0x0a) + 1;
					partial = chunk.subarray(end);
					if (!end) continue;
					const records: TranscriptRecord[] = [];
					for (const line of chunk.subarray(0, end).toString('utf8').split('\n')) {
						if (!line.trim()) continue;
						try {
							records.push(...decode(JSON.parse(line)));
						} catch {
							// a malformed line; skip it
						}
					}
					added += await this.append(key, file, harness, records, offset + end);
					offset += end;
				}
			} finally {
				await fh?.close();
			}
			return added;
		});
	}

	/** Keeps the records of a conversation read whole (Pi, OpenCode), each once. */
	ingestRecords(file: string, harness: Harness, records: TranscriptRecord[]): Promise<number> {
		return this.serial(async () => {
			await this.loaded();
			return this.append(sessionKey(file), file, harness, records, null);
		});
	}

	/** Appends the records not kept yet to a session, then records how far its source was read. */
	private async append(
		key: string,
		file: string,
		harness: Harness,
		raw: TranscriptRecord[],
		/** How far the source has now been read; null for a conversation read whole. */
		offset: number | null
	): Promise<number> {
		let s = this.sessions.get(key);
		const lines: string[] = [];
		const fresh: { id: string; r: TranscriptRecord; line: string }[] = [];
		const ids = new Set<string>();
		for (const record of raw) {
			const r = slim(record);
			if (!r || r.isSidechain) continue;
			const id = idOf(r);
			if (this.where.has(id) || ids.has(id)) continue;
			ids.add(id);
			const line = `${JSON.stringify({ ...r, uuid: id })}\n`;
			lines.push(line);
			fresh.push({ id, r: { ...r, uuid: id }, line });
		}
		if (fresh.length) {
			await mkdir(this.sessionsDir, { recursive: true });
			await appendFile(this.fileOf(key), lines.join(''), { mode: 0o600 });
			if (!s) {
				s = {
					meta: { key, harness, file, startedAt: '', endedAt: '' },
					entries: [],
					bytes: 0
				};
				this.sessions.set(key, s);
			}
			const words = this.words.get(key);
			for (const { id, r, line } of fresh) {
				const len = Buffer.byteLength(line);
				this.where.set(id, { key, i: s.entries.length });
				s.entries.push(entryOf(r, s.bytes, len));
				words?.push(searchText(r)?.text ?? null);
				s.bytes += len;
			}
			s.meta.startedAt = s.meta.startedAt || s.entries[0].at;
			s.meta.endedAt = s.entries[s.entries.length - 1].at || s.meta.endedAt;
			this.sort();
		}
		if (s && fresh.length) {
			s.meta.file = file;
			s.meta.harness = harness;
		}
		const moved = offset !== null && this.offsets.get(file) !== offset;
		if (moved) this.offsets.set(file, offset);
		if (moved || fresh.length) await this.writeIndex();
		return fresh.length;
	}

	private async writeIndex(): Promise<void> {
		const doc: IndexDoc = {
			schema: ARCHIVE_SCHEMA,
			home: this.home,
			retentionDays: this.retention,
			sessions: this.order.map((k) => this.sessions.get(k)!.meta),
			offsets: Object.fromEntries(this.offsets)
		};
		await mkdir(this.dir, { recursive: true });
		const tmp = `${this.indexFile}.${randomBytes(6).toString('hex')}.tmp`;
		try {
			await writeFile(tmp, `${JSON.stringify(doc, null, '\t')}\n`, { mode: 0o600 });
			await rename(tmp, this.indexFile);
		} catch (e) {
			await rm(tmp, { force: true });
			throw e;
		}
	}

	/** Whether the archive holds a record (or a session's divider) with this id. */
	async has(id: string): Promise<boolean> {
		await this.loaded();
		if (id.startsWith(`${DIVIDER}:`)) return this.sessions.has(id.slice(DIVIDER.length + 1));
		return this.where.has(id);
	}

	/**
	 * Records before `before` (a record's or a divider's id, or several, the
	 * first the archive holds counting; else those older than the time `at`;
	 * the newest records when neither is given, none when neither is known):
	 * about `limit` of them, back to the start of the turn the page would cut
	 * (a captain's message or a divider), and with `until`, back to that record
	 * at least. Each session's divider comes before its first record.
	 */
	async page(o: {
		before?: string | readonly string[] | null;
		at?: string | null;
		until?: string | null;
		limit?: number;
	}): Promise<ArchivePage> {
		await this.loaded();
		const limit = Math.max(1, Math.min(o.limit ?? 1000, 20_000));
		const size = (si: number) => this.sessions.get(this.order[si])!.entries.length;
		// A position is (session, record), record -1 being the session's divider; the walk
		// starts just after the newest record, or at `before`.
		let si = this.order.length - 1;
		let ri = si >= 0 ? size(si) : 0;
		const befores = typeof o.before === 'string' ? [o.before] : (o.before ?? []);
		let at: [number, number] | null = null;
		for (const id of befores) if ((at = this.position(id))) break;
		if (!at && o.at) at = this.positionAt(o.at);
		if (at) [si, ri] = at;
		else if (befores.length || o.at) return { records: [], more: false };
		const back = (s: number, r: number): [number, number] | null =>
			r >= 0 ? [s, r - 1] : s > 0 ? [s - 1, size(s - 1) - 1] : null;
		const target = o.until ? this.position(o.until) : null;
		let reached = !target;
		let count = 0;
		let slack = 0;
		const taken: [number, number][] = [];
		for (let p = si >= 0 ? back(si, ri) : null; p; p = back(p[0], p[1])) {
			taken.push(p);
			const [s, r] = p;
			if (!reached && s === target![0] && r === target![1]) reached = true;
			if (r >= 0) count++;
			if (reached && count >= limit) {
				const e = r >= 0 ? this.sessions.get(this.order[s])!.entries[r] : null;
				if (!e || e.start || slack >= TURN_SLACK) break;
				slack++;
			}
		}
		const last = taken[taken.length - 1];
		const more = !!last && !!back(last[0], last[1]);
		const parts: (() => Promise<TranscriptRecord[]>)[] = [];
		taken.reverse();
		for (let i = 0; i < taken.length;) {
			const [s, r] = taken[i];
			if (r < 0) {
				const divider = this.divider(s);
				parts.push(async () => [divider]);
				i++;
				continue;
			}
			let j = i;
			while (j + 1 < taken.length && taken[j + 1][0] === s) j++;
			const session = this.sessions.get(this.order[s])!;
			const to = taken[j][1] + 1;
			parts.push(() => this.read(session, r, to));
			i = j + 1;
		}
		const records: TranscriptRecord[] = [];
		for (const part of parts) records.push(...(await part()));
		return { records, more };
	}

	/** Where a record or divider is, as (session index, record index or -1). */
	private position(id: string): [number, number] | null {
		if (id.startsWith(`${DIVIDER}:`)) {
			const k = this.order.indexOf(id.slice(DIVIDER.length + 1));
			return k >= 0 ? [k, -1] : null;
		}
		const w = this.where.get(id);
		return w ? [this.order.indexOf(w.key), w.i] : null;
	}

	/** The position just after the newest record older than `time`; null when the archive is empty. */
	private positionAt(time: string): [number, number] | null {
		const t = Date.parse(time);
		if (Number.isNaN(t) || !this.order.length) return null;
		for (let si = this.order.length - 1; si >= 0; si--) {
			const entries = this.sessions.get(this.order[si])!.entries;
			for (let ri = entries.length - 1; ri >= 0; ri--)
				if (Date.parse(entries[ri].at) < t) return [si, ri + 1];
		}
		return [0, -1];
	}

	private divider(si: number): TranscriptRecord {
		const s = this.sessions.get(this.order[si])!;
		return {
			type: DIVIDER,
			uuid: dividerId(s.meta.key),
			timestamp: s.meta.startedAt,
			harness: s.meta.harness,
			first: si === 0
		};
	}

	/** Records [from, to) of a session, read from its file in one go. */
	private async read(s: Session, from: number, to: number): Promise<TranscriptRecord[]> {
		const start = s.entries[from].pos;
		const end = s.entries[to - 1].pos + s.entries[to - 1].len;
		const fh = await open(this.fileOf(s.meta.key), 'r');
		try {
			const buf = Buffer.alloc(end - start);
			await fh.read(buf, 0, buf.length, start);
			const out: TranscriptRecord[] = [];
			for (let i = from; i < to; i++) {
				const e = s.entries[i];
				try {
					out.push(JSON.parse(buf.subarray(e.pos - start, e.pos - start + e.len).toString('utf8')));
				} catch {
					// damaged on disk since it was read; left out
				}
			}
			return out;
		} finally {
			await fh.close();
		}
	}

	/**
	 * The captain's messages and Firstmate's replies that hold every word of
	 * `query` (ignoring case), newest first. Their words are read from the
	 * session files, newest session first, as far back as the search goes, and
	 * kept while searching goes on (SEARCH_KEEP_MS after the last search).
	 */
	async search(query: string, limit = 50): Promise<SearchHit[]> {
		await this.loaded();
		const terms = searchTerms(query);
		if (!terms.length) return [];
		this.keepWords();
		const hits: SearchHit[] = [];
		for (let si = this.order.length - 1; si >= 0 && hits.length < limit; si--) {
			const s = this.sessions.get(this.order[si])!;
			const texts = await this.wordsOf(s);
			for (let i = s.entries.length - 1; i >= 0 && hits.length < limit; i--) {
				const e = s.entries[i];
				const text = texts[i];
				if (!text || !e.who) continue;
				const lower = text.toLowerCase();
				if (!terms.every((t) => lower.includes(t))) continue;
				hits.push({
					uuid: e.uuid,
					bubble: e.who === 'firstmate' ? `${e.uuid}-t` : e.uuid,
					session: s.meta.key,
					at: e.at,
					who: e.who,
					snippet: snippet(text, lower.indexOf(terms[0]), terms[0].length)
				});
			}
		}
		return hits;
	}

	/** Keeps the words read for searching a while longer, then lets them go. */
	private keepWords() {
		if (this.wordsTimer) clearTimeout(this.wordsTimer);
		this.wordsTimer = setTimeout(() => {
			this.words.clear();
			this.wordsTimer = null;
		}, SEARCH_KEEP_MS);
		this.wordsTimer.unref?.();
	}

	/** The words a search reads in each of a session's records (null for none), read from its file once. */
	private async wordsOf(s: Session): Promise<(string | null)[]> {
		const held = this.words.get(s.meta.key);
		if (held) return held;
		let buf: Buffer | null = null;
		try {
			buf = await readFile(this.fileOf(s.meta.key));
		} catch {
			// gone since it was read: nothing to find in it
		}
		const texts: (string | null)[] = new Array(s.entries.length).fill(null);
		// Records kept while the file was read are searched once it is read again.
		let whole = true;
		for (let i = 0; buf && i < s.entries.length; i++) {
			const e = s.entries[i];
			if (!e.who) continue;
			if (e.pos + e.len > buf.length) {
				whole = false;
				continue;
			}
			try {
				const r = JSON.parse(buf.subarray(e.pos, e.pos + e.len).toString('utf8'));
				texts[i] = searchText(r as TranscriptRecord)?.text ?? null;
			} catch {
				// damaged on disk since it was read; left out
			}
		}
		if (whole && this.sessions.get(s.meta.key) === s) this.words.set(s.meta.key, texts);
		return texts;
	}

	async stats(): Promise<ArchiveStats> {
		await this.loaded();
		return this.counts();
	}

	private counts(): ArchiveStats {
		let records = 0;
		let bytes = 0;
		for (const s of this.sessions.values()) {
			records += s.entries.length;
			bytes += s.bytes;
		}
		const first = this.sessions.get(this.order[0] ?? '');
		const last = this.sessions.get(this.order[this.order.length - 1] ?? '');
		return {
			dir: this.dir,
			sessions: this.order.length,
			records,
			bytes,
			oldest: first?.meta.startedAt || null,
			newest: last?.meta.endedAt || null,
			retentionDays: this.retention
		};
	}

	/** Sets how long sessions are kept (null: everything), and lets go of those now too old. */
	setRetention(days: Retention, now = Date.now()): Promise<ArchiveStats> {
		if (!isRetention(days)) return Promise.reject(new Error('Not a retention choice.'));
		return this.serial(async () => {
			await this.loaded();
			this.retention = days;
			await this.dropOld(now);
			await this.writeIndex();
			return this.counts();
		});
	}

	/** Lets go of sessions that ended before the retention; the newest session is always kept. */
	prune(now = Date.now()): Promise<number> {
		return this.serial(async () => {
			await this.loaded();
			const n = await this.dropOld(now);
			if (n) await this.writeIndex();
			return n;
		});
	}

	private async dropOld(now: number): Promise<number> {
		if (this.retention === null) return 0;
		const cutoff = new Date(now - this.retention * DAY_MS).toISOString();
		const old = this.order.slice(0, -1).filter((k) => {
			const end = this.sessions.get(k)!.meta.endedAt;
			return !!end && end < cutoff;
		});
		for (const key of old) {
			const s = this.sessions.get(key)!;
			for (const e of s.entries) this.where.delete(e.uuid);
			this.sessions.delete(key);
			this.words.delete(key);
			await rm(this.fileOf(key), { force: true });
		}
		if (old.length) this.sort();
		return old.length;
	}
}

/**
 * The words a search looks for, lower-cased: one-letter words are left out
 * when longer ones are given ("a", "I"), as they match almost everything.
 */
export function searchTerms(query: string): string[] {
	const all = query.toLowerCase().split(/\s+/).filter(Boolean);
	const long = all.filter((t) => t.length > 1);
	return long.length ? long : all;
}

/** About 160 characters of `text` around a match at `at`, on one line. */
function snippet(text: string, at: number, len: number): string {
	const flat = (s: string) => s.replace(/\s+/g, ' ');
	const from = Math.max(0, at - 60);
	const to = Math.min(text.length, at + len + 100);
	return `${from > 0 ? '…' : ''}${flat(text.slice(from, to)).trim()}${to < text.length ? '…' : ''}`;
}
