import { open, readdir, readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import {
	FLEET_SHELF,
	isTaskId,
	slugify,
	tagOf,
	type DocFileEntry,
	type DocPrototype,
	type DocRecord
} from '$lib/documents';
import { previewNoteOf } from '$lib/previewnote';
import { docTitle } from '../buildlog/docs';
import { backlogIndex, type BacklogRow } from './backlog';
import { frontList, frontString, readFront } from './frontmatter';

/**
 * Task records read from the Firstmate home as it already is: each
 * `data/<task>/report.md` and the files it links, and each prototype a task
 * kept in `data/<task>/prototype/`. Nothing is copied, moved or written: the
 * record's identity is its project and task id, and its title comes from the
 * report's first heading, else the backlog row. A second mate's records come
 * from the copies this home already keeps of their reports
 * (`data/remote-secondmates/<mate>/data/<task>/report.md`) and, for a second
 * mate on this computer, from its own home's data folder.
 */

/** Folders in `data/` that are not a task's. */
const NOT_TASKS = new Set(['remote-secondmates', 'records', 'prototypes', 'library']);
const HEAD_BYTES = 48 * 1024;
const SHOT_EXT = /\.(?:png|jpe?g|gif|webp|svg)$/i;
const SHOT_DIRS = ['shots', 'screenshots', 'prototype/shots', 'prototype/screenshots'];
const MAX_SHOTS = 8;

/** Where one task's record lives on disk. */
export interface RecordSource {
	task: string;
	mate: string | null;
	/** The task's data folder (absolute). */
	dir: string;
	/** The folder as the home names it, e.g. `data/<task>` (for a second mate, its own path). */
	shown: string;
	/** The second mate's own home, for one on this computer. */
	mateHome?: string;
}

/** What else is known about a task: from the fleet, and from second mates' summaries. */
export interface TaskInfo {
	title: string | null;
	project: string | null;
	kind: string | null;
}

export interface MateHome {
	id: string;
	where: 'local' | 'remote';
	home: string | null;
}

const isDir = (p: string) =>
	stat(p).then(
		(s) => s.isDirectory(),
		() => false
	);

async function taskDirs(data: string): Promise<string[]> {
	const entries = await readdir(data, { withFileTypes: true }).catch(() => []);
	return entries
		.filter((e) => e.isDirectory() && !e.name.startsWith('.') && !NOT_TASKS.has(e.name))
		.map((e) => e.name)
		.filter(isTaskId);
}

/** Every task folder that may hold a record or a prototype: the home's, then second mates'. */
export async function recordSources(home: string, mates: MateHome[]): Promise<RecordSource[]> {
	const out: RecordSource[] = [];
	const data = path.join(home, 'data');
	for (const task of await taskDirs(data))
		out.push({ task, mate: null, dir: path.join(data, task), shown: `data/${task}` });
	const remote = path.join(data, 'remote-secondmates');
	const fetched = await readdir(remote, { withFileTypes: true }).catch(() => []);
	for (const m of fetched) {
		if (!m.isDirectory() || !isTaskId(m.name)) continue;
		const mdata = path.join(remote, m.name, 'data');
		for (const task of await taskDirs(mdata))
			out.push({
				task,
				mate: m.name,
				dir: path.join(mdata, task),
				shown: `data/remote-secondmates/${m.name}/data/${task}`
			});
	}
	const seen = new Set(out.filter((s) => s.mate).map((s) => `${s.task}@${s.mate}`));
	for (const m of mates) {
		if (m.where !== 'local' || !m.home || !isTaskId(m.id)) continue;
		const mdata = path.join(m.home, 'data');
		for (const task of await taskDirs(mdata)) {
			if (seen.has(`${task}@${m.id}`)) continue;
			out.push({
				task,
				mate: m.id,
				dir: path.join(mdata, task),
				shown: path.join(mdata, task),
				mateHome: m.home
			});
		}
	}
	return out;
}

/** The start of a file and its size and time, or null when it is not a file. */
async function head(file: string): Promise<{ text: string; bytes: number; at: Date } | null> {
	const st = await stat(file).catch(() => null);
	if (!st?.isFile()) return null;
	const fh = await open(file, 'r').catch(() => null);
	if (!fh) return null;
	try {
		const buf = Buffer.alloc(Math.min(HEAD_BYTES, st.size));
		const { bytesRead } = await fh.read(buf, 0, buf.length, 0);
		return {
			text: buf.subarray(0, bytesRead).toString('utf8').replace(/�$/, ''),
			bytes: st.size,
			at: st.mtime
		};
	} finally {
		await fh.close();
	}
}

/** A task id as words, for a record with neither a heading nor a backlog title. */
const fromId = (id: string) => {
	const s = id.replace(/[-_.]+/g, ' ').trim();
	return s.charAt(0).toUpperCase() + s.slice(1);
};

/** The report's own title: its front matter or first heading, else null. */
function reportTitle(md: string): string | null {
	const t = docTitle(md, 'report.md');
	return t && t !== 'Report' ? t : null;
}

/** Tags a report names in its front matter (`tags: [a, b]`). */
function reportTags(md: string): string[] {
	return [...new Set(frontList(readFront(md).data.tags).map(tagOf).filter(Boolean))];
}

/** The newest preview address the task's status lines named, from its status log. */
async function lastPreview(home: string, task: string): Promise<string | null> {
	const file = path.join(home, 'state', `${task}.status`);
	const text = await readFile(file, 'utf8').catch(() => '');
	const lines = text.trim().split('\n').reverse();
	for (const line of lines.slice(0, 400)) {
		const url = previewNoteOf(line.replace(/\s*\[at=\d+\]/, '')).preview;
		if (url) return url;
	}
	return null;
}

async function shotsIn(dir: string): Promise<{ name: string; path: string }[]> {
	const out: { name: string; path: string }[] = [];
	for (const sub of SHOT_DIRS) {
		const d = path.join(dir, sub);
		const names = (await readdir(d).catch(() => [] as string[]))
			.filter((n) => SHOT_EXT.test(n) && !n.startsWith('.'))
			.sort();
		for (const n of names) out.push({ name: n, path: path.join(d, n) });
	}
	return out.slice(0, MAX_SHOTS);
}

export interface ScanInput {
	home: string;
	sources: RecordSource[];
	/** Backlog rows by task id (see backlog.ts). */
	backlog: Map<string, BacklogRow>;
	/** What the fleet knows about a task, by its id (`<task>@<mate>` for a second mate's). */
	info: (id: string) => TaskInfo | null;
	/** Whether a prototype answers at its last address. */
	answers: (url: string) => Promise<boolean>;
}

export interface Scanned {
	records: DocRecord[];
	prototypes: DocPrototype[];
	/** Each record's task folder, by key, for its page and its files. */
	dirs: Map<string, RecordSource>;
}

/** Read the records and prototypes in every source folder. Never writes. */
export async function scanRecords(input: ScanInput): Promise<Scanned> {
	const records: DocRecord[] = [];
	const prototypes: DocPrototype[] = [];
	const dirs = new Map<string, RecordSource>();
	await Promise.all(
		input.sources.map(async (src) => {
			const id = src.mate ? `${src.task}@${src.mate}` : src.task;
			const row = src.mate ? null : (input.backlog.get(src.task) ?? null);
			const info = input.info(id);
			const project = row?.repo ?? info?.project ?? FLEET_SHELF;
			const named = row?.title ?? info?.title ?? null;
			const report = await head(path.join(src.dir, 'report.md'));
			const key = `${project}/${src.task}${src.mate ? `@${src.mate}` : ''}`;
			const title = (report && reportTitle(report.text)) ?? named ?? fromId(src.task);
			const protoDir = path.join(src.dir, 'prototype');
			const proto = await isDir(protoDir);
			if (report) {
				const kind = (row?.kind ?? info?.kind) === 'ship' ? 'ship' : 'report';
				const front = readFront(report.text).data;
				records.push({
					key,
					project,
					task: src.task,
					mate: src.mate,
					title,
					slug: frontString(front.slug) ?? slugify(title),
					kind,
					at: report.at.toISOString(),
					tags: reportTags(report.text),
					path: `${src.shown}/report.md`,
					bytes: report.bytes,
					prototypes: proto ? [`${project}/${src.task}/main`] : [],
					promotedTo: null
				});
				dirs.set(key, src);
			}
			if (proto) {
				const meta = await readFile(path.join(protoDir, 'prototype.json'), 'utf8')
					.then((t) => JSON.parse(t) as Record<string, unknown>)
					.catch(() => null);
				const ptitle =
					(typeof meta?.title === 'string' && meta.title.trim()) ||
					(report ? title : named) ||
					fromId(src.task);
				const st = await stat(protoDir);
				const url = src.mate ? null : await lastPreview(input.home, src.task);
				const running = url ? await input.answers(url).catch(() => false) : false;
				prototypes.push({
					id: `${project}/${src.task}/main`,
					project,
					task: src.task,
					name: 'main',
					mate: src.mate,
					title: ptitle,
					slug: slugify(ptitle),
					state: running ? 'running' : 'stopped',
					source: `${src.shown}/prototype`,
					url,
					at: (report?.at ?? st.mtime).toISOString(),
					shots: await shotsIn(src.dir),
					record: report ? key : null
				});
				if (!report) dirs.set(`${project}/${src.task}${src.mate ? `@${src.mate}` : ''}`, src);
			}
		})
	);
	const newest = (a: { at: string }, b: { at: string }) => b.at.localeCompare(a.at);
	return { records: records.sort(newest), prototypes: prototypes.sort(newest), dirs };
}

/** The backlog rows of a home: `data/backlog.md`, then the newer of those over `data/done-archive.md`. */
export async function readBacklog(home: string): Promise<Map<string, BacklogRow>> {
	const [archive, backlog] = await Promise.all(
		['done-archive.md', 'backlog.md'].map((f) =>
			readFile(path.join(home, 'data', f), 'utf8').catch(() => '')
		)
	);
	return backlogIndex(archive, backlog);
}

// ---------------------------------------------------------------- the files a report links

/** Where a report's Markdown links and images point, as written. */
export function linkTargets(md: string): string[] {
	const out: string[] = [];
	const text = md.replace(/```[\s\S]*?```/g, '');
	for (const m of text.matchAll(/!?\[[^\]]*\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g))
		out.push(m[1]);
	for (const m of text.matchAll(/^\s*\[[^\]]+\]:\s*<?(\S+?)>?(?:\s+.*)?$/gm)) out.push(m[1]);
	for (const m of text.matchAll(/\b(?:src|href)\s*=\s*["']([^"']+)["']/gi)) out.push(m[1]);
	return out;
}

const SCHEME = /^[a-z][a-z\d+.-]*:/i;

/**
 * The files inside the task's folder that its report links to, by relative
 * path, with their size: what the record holds besides `report.md`. Links into
 * the prototype folder are left out: a prototype is never part of a record.
 */
export async function linkedFiles(dir: string, md: string): Promise<DocFileEntry[]> {
	const real = await realpath(dir).catch(() => null);
	if (!real) return [];
	const out = new Map<string, DocFileEntry>();
	for (const raw of linkTargets(md)) {
		const t = raw.trim();
		if (!t || t.startsWith('#') || t.startsWith('//') || SCHEME.test(t) || t.startsWith('/'))
			continue;
		let rel = t.replace(/[?#].*$/, '');
		try {
			rel = decodeURIComponent(rel);
		} catch {
			// as written
		}
		const abs = path.resolve(dir, rel);
		const relOf = path.relative(dir, abs);
		if (!relOf || relOf.startsWith('..') || path.isAbsolute(relOf)) continue;
		if (relOf === 'report.md' || relOf.split(path.sep)[0] === 'prototype') continue;
		const file = await realpath(abs).catch(() => null);
		if (!file || !(file === real || file.startsWith(real + path.sep))) continue;
		const st = await stat(file).catch(() => null);
		if (!st?.isFile()) continue;
		const key = relOf.split(path.sep).join('/');
		out.set(key, { path: key, bytes: st.size });
	}
	return [...out.values()];
}
