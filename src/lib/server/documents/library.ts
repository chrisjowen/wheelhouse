import { execFile } from 'node:child_process';
import { copyFile, mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import {
	isSlug,
	LIBRARY_STATUSES,
	tagOf,
	type LibraryDoc,
	type LibraryStatus
} from '$lib/documents';
import { frontList, frontString, readFront, writeFront } from './frontmatter';

/**
 * The document library: a private git repository Wheelhouse keeps in its own
 * state directory, one per Firstmate home. Documents are Markdown files on
 * shelves (a project, or `_fleet`) and in folders, `<shelf>/<folder>/<slug>.md`,
 * each starting with front matter (title, status, tags, where it came from);
 * a document's attachments sit beside it in `<shelf>/<folder>/<slug>/`.
 * Wheelhouse commits a promotion itself; edits are asked of Firstmate in
 * chat, which edits the file and commits. Never pushed anywhere.
 */

const run = promisify(execFile);
const GIT_ENV = {
	GIT_AUTHOR_NAME: 'Wheelhouse',
	GIT_AUTHOR_EMAIL: 'wheelhouse@localhost',
	GIT_COMMITTER_NAME: 'Wheelhouse',
	GIT_COMMITTER_EMAIL: 'wheelhouse@localhost',
	GIT_TERMINAL_PROMPT: '0'
};

export interface LibraryCommit {
	sha: string;
	subject: string;
	at: string;
}

export interface LibraryRead {
	doc: LibraryDoc;
	/** The document after its front matter. */
	markdown: string;
	/** Its file (absolute), which links inside it resolve against. */
	file: string;
	history: LibraryCommit[];
}

export interface PromoteInput {
	/** The record's key and its report. */
	from: string;
	markdown: string;
	/** The files the report links, relative to its folder, with where they are. */
	files: { rel: string; abs: string }[];
	title: string;
	shelf: string;
	folder: string;
	slug: string;
	tags: string[];
	prototypes: string[];
}

export type PromoteResult =
	| { ok: true; key: string; sha: string; message: string }
	| { ok: false; status: 400 | 409 | 500; error: string };

const statusOf = (v: string | null): LibraryStatus =>
	(LIBRARY_STATUSES as readonly string[]).includes(v ?? '') ? (v as LibraryStatus) : 'current';

export class Library {
	private queue: Promise<unknown> = Promise.resolve();

	constructor(readonly root: string) {}

	private async git(args: string[]): Promise<string> {
		const { stdout } = await run('git', ['-C', this.root, ...args], {
			env: { ...process.env, ...GIT_ENV },
			timeout: 20_000,
			maxBuffer: 8 * 1024 * 1024
		});
		return stdout;
	}

	/** One change at a time: promotions write and commit. */
	private serial<T>(fn: () => Promise<T>): Promise<T> {
		const next = this.queue.then(fn, fn);
		this.queue = next.catch(() => {});
		return next;
	}

	/** Make the repository the first time it is needed. */
	async ensure(): Promise<void> {
		await mkdir(this.root, { recursive: true });
		if (await stat(path.join(this.root, '.git')).catch(() => null)) return;
		await this.git(['init', '-q']);
		await writeFile(
			path.join(this.root, 'README.md'),
			'# Library\n\nDocuments promoted from task records in Wheelhouse, as `<shelf>/<folder>/<slug>.md`. Each starts with front matter: title, status (current, draft or superseded), tags, and the record it came from. Edit a document and commit it with a message that says what changed.\n'
		);
		await this.git(['add', 'README.md']);
		await this.git(['commit', '-q', '-m', 'library: start']);
	}

	/** Each document's file, relative to the root: `<shelf>/<folder>/<slug>.md`. */
	private async files(): Promise<string[]> {
		const out: string[] = [];
		const shelves = await readdir(this.root, { withFileTypes: true }).catch(() => []);
		for (const s of shelves) {
			if (!s.isDirectory() || !isSlug(s.name)) continue;
			const folders = await readdir(path.join(this.root, s.name), { withFileTypes: true }).catch(
				() => []
			);
			for (const f of folders) {
				if (!f.isDirectory() || !isSlug(f.name)) continue;
				const docs = await readdir(path.join(this.root, s.name, f.name), {
					withFileTypes: true
				}).catch(() => []);
				for (const d of docs)
					if (d.isFile() && d.name.endsWith('.md') && isSlug(d.name.slice(0, -3)))
						out.push(`${s.name}/${f.name}/${d.name}`);
			}
		}
		return out;
	}

	/** How many commits touched each file, and the newest one's time. */
	private async log(): Promise<Map<string, { commits: number; at: string }>> {
		const out = new Map<string, { commits: number; at: string }>();
		const text = await this.git(['log', '--format=@%cI', '--name-only']).catch(() => '');
		let at = '';
		for (const line of text.split('\n')) {
			if (line.startsWith('@')) at = line.slice(1);
			else if (line.endsWith('.md')) {
				const e = out.get(line);
				if (e) e.commits++;
				else out.set(line, { commits: 1, at });
			}
		}
		return out;
	}

	private docOf(rel: string, text: string, log?: { commits: number; at: string }): LibraryDoc {
		const [shelf, folder, name] = rel.split('/');
		const slug = name.slice(0, -3);
		const { data, body } = readFront(text);
		const heading = /^#\s+(.+?)\s*#*\s*$/m.exec(body)?.[1];
		return {
			key: `${shelf}/${folder}/${slug}`,
			shelf,
			folder,
			slug,
			title: frontString(data.title) ?? heading ?? slug,
			status: statusOf(frontString(data.status)),
			tags: [...new Set(frontList(data.tags).map(tagOf).filter(Boolean))],
			from: frontString(data.promoted_from)?.replace(/^records\//, '') ?? null,
			updated: log?.at || frontString(data.updated) || new Date(0).toISOString(),
			commits: log?.commits ?? 0
		};
	}

	/** Every document, newest first. An empty list before the first promotion. */
	async list(): Promise<LibraryDoc[]> {
		const [files, log] = await Promise.all([this.files(), this.log()]);
		const docs = await Promise.all(
			files.map(async (rel) =>
				this.docOf(
					rel,
					await readFile(path.join(this.root, rel), 'utf8').catch(() => ''),
					log.get(rel)
				)
			)
		);
		return docs.sort((a, b) => b.updated.localeCompare(a.updated));
	}

	/** One document with its text and history, by key; null when there is none. */
	async read(key: string): Promise<LibraryRead | null> {
		const parts = key.split('/');
		if (parts.length !== 3 || !parts.every(isSlug)) return null;
		const rel = `${key}.md`;
		const file = path.join(this.root, rel);
		const text = await readFile(file, 'utf8').catch(() => null);
		if (text === null) return null;
		const raw = await this.git(['log', '--format=%h%x09%cI%x09%s', '--', rel]).catch(() => '');
		const history = raw
			.trim()
			.split('\n')
			.filter(Boolean)
			.map((l) => {
				const [sha, at, ...s] = l.split('\t');
				return { sha, at, subject: s.join('\t') };
			});
		const doc = this.docOf(
			rel,
			text,
			history.length ? { commits: history.length, at: history[0].at } : undefined
		);
		return { doc, markdown: readFront(text).body, file, history };
	}

	/** The files beside a document, in `<shelf>/<folder>/<slug>/`, relative to that folder. */
	async attachments(key: string): Promise<string[]> {
		const parts = key.split('/');
		if (parts.length !== 3 || !parts.every(isSlug)) return [];
		const base = path.join(this.root, ...parts);
		const out: string[] = [];
		const walk = async (dir: string, rel: string, depth: number) => {
			if (depth > 4 || out.length >= 200) return;
			for (const e of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
				if (e.name.startsWith('.')) continue;
				const r = rel ? `${rel}/${e.name}` : e.name;
				if (e.isDirectory()) await walk(path.join(dir, e.name), r, depth + 1);
				else if (e.isFile()) out.push(r);
			}
		};
		await walk(base, '', 0);
		return out.sort();
	}

	/** The folders on each shelf, for the promote dialog. */
	async folders(): Promise<Record<string, string[]>> {
		const out: Record<string, string[]> = {};
		for (const rel of await this.files()) {
			const [shelf, folder] = rel.split('/');
			out[shelf] = [...new Set([...(out[shelf] ?? []), folder])].sort();
		}
		return out;
	}

	/**
	 * Copy a record's report and the files it links into the library and commit
	 * it as `promote: <shelf>/<folder>/<slug> from records/<key>`. The record is
	 * never changed. Refused when a document is already at that place.
	 */
	promote(input: PromoteInput): Promise<PromoteResult> {
		return this.serial(async () => {
			const { shelf, folder, slug } = input;
			if (![shelf, folder, slug].every(isSlug))
				return {
					ok: false,
					status: 400,
					error: 'Shelf, folder and name must be simple words: a-z, 0-9 and dashes.'
				};
			const title = input.title.trim().slice(0, 200);
			if (!title) return { ok: false, status: 400, error: 'Give the document a title.' };
			try {
				await this.ensure();
				const rel = `${shelf}/${folder}/${slug}.md`;
				const file = path.join(this.root, rel);
				if (await stat(file).catch(() => null))
					return {
						ok: false,
						status: 409,
						error: `There is already a document at ${shelf}/${folder}/${slug}.`
					};
				await mkdir(path.dirname(file), { recursive: true });
				let body = readFront(input.markdown).body;
				const added = [rel];
				for (const f of input.files) {
					const to = path.join(this.root, shelf, folder, slug, f.rel);
					await mkdir(path.dirname(to), { recursive: true });
					await copyFile(f.abs, to);
					added.push(`${shelf}/${folder}/${slug}/${f.rel}`);
					body = rewriteLink(body, f.rel, `${slug}/${f.rel}`);
				}
				await writeFile(
					file,
					writeFront(
						{
							title,
							status: 'current',
							tags: [...new Set(input.tags.map(tagOf).filter(Boolean))],
							promoted_from: `records/${input.from}`,
							prototypes: input.prototypes.length ? input.prototypes : null,
							updated: new Date().toISOString()
						},
						body
					)
				);
				const message = `promote: ${shelf}/${folder}/${slug} from records/${input.from}`;
				await this.git(['add', '--', ...added]);
				await this.git(['commit', '-q', '-m', message]);
				const sha = (await this.git(['rev-parse', '--short', 'HEAD'])).trim();
				return { ok: true, key: `${shelf}/${folder}/${slug}`, sha, message };
			} catch (e) {
				return {
					ok: false,
					status: 500,
					error: `The library could not commit it: ${(e as Error).message}`
				};
			}
		});
	}
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Point the links to `from` (as written, with or without `./`) at `to`. Pure. */
export function rewriteLink(md: string, from: string, to: string): string {
	const target = `(?:\\./)?${escape(from)}`;
	return md
		.replace(new RegExp(`(\\]\\(\\s*<?)${target}(?=[>)\\s#?])`, 'g'), `$1${to}`)
		.replace(new RegExp(`((?:src|href)\\s*=\\s*["'])${target}(?=["'#?])`, 'gi'), `$1${to}`);
}
