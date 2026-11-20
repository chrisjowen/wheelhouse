import { open, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import {
	isSlug,
	linkPrototype,
	parseRecordKey,
	recordForTask,
	slugify,
	tagOf,
	type DocFileEntry,
	type DocPrototype,
	type DocRecord,
	type DocumentsIndex,
	type LibraryDoc
} from '$lib/documents';
import type { FleetView } from '$lib/types';
import type { Library, LibraryRead, PromoteResult } from './library';
import {
	linkedFiles,
	readBacklog,
	recordSources,
	scanRecords,
	type RecordSource,
	type TaskInfo
} from './records';

/**
 * The Documents page's data: the home's task records and prototypes
 * (records.ts), and the library (library.ts), as one index the pages, the
 * search box and the link chips read. The index is rebuilt at most every few
 * seconds however many pages ask.
 */

const TTL_MS = 8_000;
const REPORT_BYTES = 1024 * 1024;

/** What a record's files are served as. HTML is only ever shown sandboxed, with scripts off. */
export const RECORD_FILE_TYPES: Record<string, string> = {
	'.png': 'image/png',
	'.jpg': 'image/jpeg',
	'.jpeg': 'image/jpeg',
	'.gif': 'image/gif',
	'.webp': 'image/webp',
	'.svg': 'image/svg+xml',
	'.html': 'text/html; charset=utf-8',
	'.htm': 'text/html; charset=utf-8',
	'.css': 'text/css; charset=utf-8',
	'.txt': 'text/plain; charset=utf-8',
	'.log': 'text/plain; charset=utf-8',
	'.md': 'text/plain; charset=utf-8',
	'.json': 'text/plain; charset=utf-8',
	'.csv': 'text/plain; charset=utf-8',
	'.pdf': 'application/pdf'
};
export const RECORD_FILE_BYTES = 15 * 1024 * 1024;

export interface RecordView {
	record: DocRecord;
	markdown: string;
	truncated: boolean;
	/** The report's real path, which links inside it resolve against. */
	file: string;
	/** The task folder as the home names it. */
	source: string;
	/** The files it links, beside report.md. */
	files: DocFileEntry[];
	prototypes: DocPrototype[];
	promotedTo: LibraryDoc | null;
	/** The backlog's kind and finish day, when it has a row. */
	finished: string | null;
}

export interface DocumentsDeps {
	home: string;
	library: Library | null;
	libraryProblem: string | null;
	fleet: () => FleetView | null;
	answers: (url: string) => Promise<boolean>;
}

export class DocumentsService {
	private cached: { at: number; value: Promise<Built> } | null = null;

	constructor(private readonly deps: DocumentsDeps) {}

	/** Forget the cached index, after a change Wheelhouse made itself. */
	invalidate(): void {
		this.cached = null;
	}

	private build(): Promise<Built> {
		if (this.cached && Date.now() - this.cached.at < TTL_MS) return this.cached.value;
		const value = this.load();
		this.cached = { at: Date.now(), value };
		value.catch(() => (this.cached = null));
		return value;
	}

	private async load(): Promise<Built> {
		const fleet = this.deps.fleet();
		const info = new Map<string, TaskInfo>();
		for (const t of fleet?.tasks ?? [])
			info.set(t.id, {
				title: t.title,
				project: t.projectId === 'unassigned' ? null : t.projectId,
				kind: t.kind
			});
		for (const m of fleet?.secondMates ?? [])
			for (const t of [...m.inFlight, ...m.queued, ...m.landed])
				info.set(`${t.id}@${m.id}`, { title: t.title, project: t.projectId, kind: null });
		const [backlog, sources] = await Promise.all([
			readBacklog(this.deps.home),
			recordSources(this.deps.home, fleet?.secondMates ?? [])
		]);
		const scanned = await scanRecords({
			home: this.deps.home,
			sources,
			backlog,
			info: (id) => info.get(id) ?? null,
			answers: this.deps.answers
		});
		const library = this.deps.library ? await this.deps.library.list().catch(() => []) : [];
		for (const d of library) {
			const r = d.from ? scanned.records.find((x) => x.key === d.from) : null;
			if (r && !r.promotedTo) r.promotedTo = d.key;
		}
		return {
			index: {
				records: scanned.records,
				prototypes: scanned.prototypes,
				library,
				libraryProblem: this.deps.library ? null : this.deps.libraryProblem,
				generatedAt: new Date().toISOString()
			},
			dirs: scanned.dirs,
			backlog
		};
	}

	async index(): Promise<DocumentsIndex> {
		return (await this.build()).index;
	}

	/** The record a key or a bare task id names (the short `/r/<task>` form). */
	async find(keyOrTask: string): Promise<DocRecord | null> {
		const { index } = await this.build();
		return (
			index.records.find((r) => r.key === keyOrTask) ??
			(keyOrTask.includes('/') ? null : recordForTask(index, keyOrTask))
		);
	}

	private async source(key: string): Promise<{ record: DocRecord; src: RecordSource } | null> {
		if (!parseRecordKey(key)) return null;
		const built = await this.build();
		const record = built.index.records.find((r) => r.key === key);
		const src = built.dirs.get(key);
		return record && src ? { record, src } : null;
	}

	/** A record with its report, the files it links, its prototypes and where it was promoted. */
	async record(key: string): Promise<RecordView | null> {
		const found = await this.source(key);
		if (!found) return null;
		const { record, src } = found;
		const file = path.join(src.dir, 'report.md');
		const fh = await open(file, 'r').catch(() => null);
		if (!fh) return null;
		let markdown: string;
		let truncated: boolean;
		try {
			const buf = Buffer.alloc(REPORT_BYTES + 1);
			const { bytesRead } = await fh.read(buf, 0, buf.length, 0);
			truncated = bytesRead > REPORT_BYTES;
			markdown = buf
				.subarray(0, Math.min(bytesRead, REPORT_BYTES))
				.toString('utf8')
				.replace(/�$/, '');
		} finally {
			await fh.close();
		}
		const { index, backlog } = await this.build();
		const row = record.mate ? null : backlog.get(record.task);
		return {
			record,
			markdown,
			truncated,
			file: await realpath(file).catch(() => file),
			source: src.shown,
			files: await linkedFiles(src.dir, markdown),
			prototypes: index.prototypes.filter((p) => record.prototypes.includes(p.id)),
			promotedTo: index.library.find((d) => d.key === record.promotedTo) ?? null,
			finished: row?.done ?? null
		};
	}

	/**
	 * One file a record holds: `report.md` or a file the report links. Null for
	 * anything else, however the path is written.
	 */
	async recordFile(
		key: string,
		rel: string
	): Promise<{ file: string; type: string; bytes: number } | null> {
		const view = await this.record(key);
		if (!view) return null;
		const want = rel.replace(/^\.\//, '');
		if (want !== 'report.md' && !view.files.some((f) => f.path === want)) return null;
		const type = RECORD_FILE_TYPES[path.extname(want).toLowerCase()];
		if (!type) return null;
		const src = (await this.source(key))!.src;
		const file = await realpath(path.join(src.dir, ...want.split('/'))).catch(() => null);
		const dir = await realpath(src.dir).catch(() => null);
		if (!file || !dir || !file.startsWith(dir + path.sep)) return null;
		const st = await stat(file).catch(() => null);
		if (!st?.isFile() || st.size > RECORD_FILE_BYTES) return null;
		return { file, type, bytes: st.size };
	}

	async prototype(
		id: string
	): Promise<{ prototype: DocPrototype; record: DocRecord | null } | null> {
		const { index } = await this.build();
		const prototype = index.prototypes.find((p) => p.id === id);
		if (!prototype) return null;
		return {
			prototype,
			record: prototype.record
				? (index.records.find((r) => r.key === prototype.record) ?? null)
				: null
		};
	}

	async libraryDoc(key: string): Promise<
		| (LibraryRead & {
				root: string;
				record: DocRecord | null;
				attachments: string[];
				prototypes: DocPrototype[];
		  })
		| null
	> {
		const lib = this.deps.library;
		if (!lib) return null;
		const read = await lib.read(key);
		if (!read) return null;
		const { index } = await this.build();
		const record = read.doc.from
			? (index.records.find((r) => r.key === read.doc.from) ?? null)
			: null;
		return {
			...read,
			root: lib.root,
			record,
			attachments: await lib.attachments(key),
			prototypes: index.prototypes.filter((p) => record?.prototypes.includes(p.id))
		};
	}

	/** A file beside a library document, by its path in the document's folder. */
	async libraryFile(key: string, rel: string): Promise<{ file: string; type: string } | null> {
		const lib = this.deps.library;
		if (!lib) return null;
		if (!(await lib.attachments(key)).includes(rel)) return null;
		const type = RECORD_FILE_TYPES[path.extname(rel).toLowerCase()];
		if (!type) return null;
		const base = await realpath(path.join(lib.root, ...key.split('/'))).catch(() => null);
		const file = await realpath(path.join(lib.root, ...key.split('/'), ...rel.split('/'))).catch(
			() => null
		);
		if (!base || !file || !file.startsWith(base + path.sep)) return null;
		const st = await stat(file).catch(() => null);
		return st?.isFile() && st.size <= RECORD_FILE_BYTES ? { file, type } : null;
	}

	async folders(): Promise<Record<string, string[]>> {
		return this.deps.library ? this.deps.library.folders().catch(() => ({})) : {};
	}

	/** Promote a record into the library (see Library.promote). */
	async promote(body: Record<string, unknown>): Promise<PromoteResult> {
		const lib = this.deps.library;
		if (!lib)
			return {
				ok: false,
				status: 500,
				error: this.deps.libraryProblem ?? 'The library is not available.'
			};
		const key = typeof body.record === 'string' ? body.record : '';
		const view = await this.record(key);
		if (!view) return { ok: false, status: 400, error: 'There is no such record.' };
		const src = (await this.source(key))!.src;
		const str = (v: unknown, d: string) => (typeof v === 'string' && v.trim() ? v.trim() : d);
		const shelf = str(body.shelf, view.record.project).toLowerCase();
		const folder = slugify(str(body.folder, 'reports'), 'reports');
		const slug = slugify(str(body.slug, view.record.slug), view.record.slug);
		const tags = Array.isArray(body.tags)
			? body.tags
					.filter((t): t is string => typeof t === 'string')
					.map(tagOf)
					.filter(Boolean)
					.slice(0, 24)
			: view.record.tags;
		if (!isSlug(shelf))
			return { ok: false, status: 400, error: 'Choose a shelf: a project, or the fleet shelf.' };
		const files = await Promise.all(
			view.files.map(async (f) => ({ rel: f.path, abs: path.join(src.dir, ...f.path.split('/')) }))
		);
		const r = await lib.promote({
			from: key,
			markdown: linkPrototype(view.markdown, view.record.prototypes[0]),
			files,
			title: str(body.title, view.record.title),
			shelf,
			folder,
			slug,
			tags,
			prototypes: view.record.prototypes
		});
		if (r.ok) this.invalidate();
		return r;
	}

	/**
	 * The text of documents for a Live discussion: each attached one in full
	 * (up to `budget` characters in all), and each listed one by title with the
	 * file the crew can open.
	 */
	async briefing(
		full: string[],
		titles: string[],
		budget = 64 * 1024
	): Promise<{ text: string; attached: string[]; listed: string[]; cut: string[] }> {
		const { index } = await this.build();
		const fullParts: string[] = [];
		const listParts: string[] = [];
		const attached: string[] = [];
		const listed: string[] = [];
		const cut: string[] = [];
		let left = budget;
		const where = async (ref: string) => {
			if (ref.startsWith('lib:')) {
				const d = await this.libraryDoc(ref.slice(4));
				return d
					? {
							title: d.doc.title,
							file: d.file,
							text: d.markdown,
							what: `library document (${d.doc.shelf}/${d.doc.folder})`
						}
					: null;
			}
			if (ref.startsWith('proto:')) {
				const p = index.prototypes.find((x) => x.id === ref.slice(6));
				return p
					? {
							title: p.title,
							file: null,
							text: null,
							what: `live prototype, ${p.state}${p.url ? `, last at ${p.url}` : ''}`
						}
					: null;
			}
			const v = await this.record(ref);
			return v
				? {
						title: v.record.title,
						file: v.file,
						text: v.markdown,
						what: `${v.record.kind === 'ship' ? 'ship summary' : 'report'} for ${v.record.project}`
					}
				: null;
		};
		for (const ref of full.slice(0, 12)) {
			const d = await where(ref);
			if (!d) continue;
			if (d.text === null) {
				listed.push(d.title);
				listParts.push(`- "${d.title}" (${d.what})`);
				continue;
			}
			if (d.text.length > left) {
				cut.push(d.title);
				listed.push(d.title);
				listParts.push(`- "${d.title}" (${d.what}), too long to attach in full: read ${d.file}`);
				continue;
			}
			left -= d.text.length;
			attached.push(d.title);
			fullParts.push(`### ${d.title} (${d.what})\n\n${d.text.trim()}\n`);
		}
		for (const ref of titles.slice(0, 60)) {
			const d = await where(ref);
			if (!d || attached.includes(d.title) || listed.includes(d.title)) continue;
			listed.push(d.title);
			listParts.push(`- "${d.title}" (${d.what})${d.file ? `: ${d.file}` : ''}`);
		}
		if (!attached.length && !listed.length) return { text: '', attached, listed, cut };
		const text = [
			'[From Wheelhouse, not the captain speaking: the captain added documents to this discussion. Acknowledge them in one short spoken sentence, then carry on.]',
			...(fullParts.length ? ['', 'Attached in full:', '', ...fullParts] : []),
			...(listParts.length
				? [
						'',
						'Listed by title, for you to open with your file tools if the discussion needs them:',
						...listParts
					]
				: [])
		].join('\n');
		return { text, attached, listed, cut };
	}
}

interface Built {
	index: DocumentsIndex;
	dirs: Map<string, RecordSource>;
	backlog: Awaited<ReturnType<typeof readBacklog>>;
}

/** The records of these projects, newest first, at most `n`, for a Live discussion's opening. */
export function titlesFor(index: DocumentsIndex, projects: Set<string>, n = 30): DocRecord[] {
	return index.records.filter((r) => projects.has(r.project)).slice(0, n);
}
