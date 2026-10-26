import path from 'node:path';
import type { DocRef } from '../../buildlog';

/**
 * Which files are documentation or decision records, what they are called,
 * and which of them a worker's Claude Code session read or changed. Pure, so
 * it is unit-tested; the reader (reader.ts) supplies the file text.
 */

const DOC_EXT = /\.(?:md|mdx|markdown|rst|adoc)$/i;
const DECISION_DIR = /^(?:adrs?|decisions?|decision-records?|rfcs?)$/i;
/** Folders whose Markdown is not the project's documentation. */
const SKIP =
	/(?:^|\/)(?:node_modules|\.git|vendor|dist|build|coverage|\.svelte-kit|testdata|fixtures?|__snapshots__)\//;

/** A repository path that is documentation or a decision record. */
export function isDocPath(p: string): boolean {
	if (!DOC_EXT.test(p) || SKIP.test(p) || p.startsWith('/') || p.includes('..')) return false;
	// The docket keeps project knowledge; only its decisions and constraints read as records.
	if (p.startsWith('.docket/')) return /^\.docket\/(?:decisions|constraints)\//.test(p);
	// Other hidden folders (.github templates, .claude skills) are tooling, not docs.
	return !/(?:^|\/)\.[^/]+\//.test(p) && !/^CHANGELOG/i.test(path.basename(p));
}

export function docKind(p: string): DocRef['kind'] {
	const parts = p.split('/');
	if (parts.slice(0, -1).some((d) => DECISION_DIR.test(d)) || p.startsWith('.docket/'))
		return 'decision';
	if (/^readme(?:\.|$)/i.test(parts.at(-1) ?? '')) return 'readme';
	return 'doc';
}

/** A file name as words: `0007-use-postgres.md` → "Use postgres". */
export function readableName(p: string): string {
	const base = path.basename(p).replace(DOC_EXT, '');
	if (/^readme$/i.test(base)) {
		const dir = path.dirname(p);
		return dir === '.' ? 'Project readme' : `Readme for ${path.basename(dir)}`;
	}
	const s = base
		.replace(/^\d{1,5}[-_ ]+/, '')
		.replace(/[-_]+/g, ' ')
		.trim();
	return s ? s.charAt(0).toUpperCase() + s.slice(1) : base;
}

/** The document's own title: YAML front matter `title:`/`name:`, else its first heading. */
export function docTitle(md: string, p: string): string {
	// A readme's heading is usually just the project's name; say what it is instead.
	if (docKind(p) === 'readme') return readableName(p);
	const text = md.replace(/\r\n?/g, '\n');
	const front = /^---\n([\s\S]*?)\n---/.exec(text);
	const named = front && /^(?:title|name):\s*["']?(.+?)["']?\s*$/m.exec(front[1]);
	if (named) return named[1].trim();
	const body = front ? text.slice(front[0].length) : text;
	const h = /^#{1,2}\s+(.+?)\s*#*\s*$/m.exec(body) ?? /^(.+)\n=+\s*$/m.exec(body);
	const t = h?.[1]
		.replace(/`([^`]+)`/g, '$1')
		.replace(/\*\*?([^*]+)\*\*?/g, '$1')
		.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
		.trim();
	return t || readableName(p);
}

const FILE_TOOLS = new Set(['Read', 'Edit', 'MultiEdit', 'Write', 'NotebookEdit']);

export interface DocTouch {
	path: string;
	read: boolean;
	changed: boolean;
}

/**
 * Docs a session touched, from Claude Code transcript lines: Read, Edit and
 * Write tool calls on a file inside the worktree, made on the task's branch.
 * Only those fields are looked at. Lines that do not parse are skipped.
 */
export function docsFromTranscript(
	lines: Iterable<string>,
	worktree: string,
	branch: string
): DocTouch[] {
	const root = worktree.endsWith('/') ? worktree : `${worktree}/`;
	const seen = new Map<string, DocTouch>();
	for (const line of lines) {
		if (!line.includes('"tool_use"') || !line.includes(branch)) continue;
		let rec: {
			gitBranch?: unknown;
			message?: { content?: unknown };
		};
		try {
			rec = JSON.parse(line);
		} catch {
			continue;
		}
		if (rec.gitBranch !== branch || !Array.isArray(rec.message?.content)) continue;
		for (const c of rec.message.content as {
			type?: string;
			name?: string;
			input?: { file_path?: unknown; notebook_path?: unknown };
		}[]) {
			if (c?.type !== 'tool_use' || !FILE_TOOLS.has(c.name ?? '')) continue;
			const file = c.input?.file_path ?? c.input?.notebook_path;
			if (typeof file !== 'string' || !file.startsWith(root)) continue;
			const rel = path.normalize(file.slice(root.length));
			if (!isDocPath(rel)) continue;
			const t = seen.get(rel) ?? { path: rel, read: false, changed: false };
			if (c.name === 'Read') t.read = true;
			else t.changed = true;
			seen.set(rel, t);
		}
	}
	return [...seen.values()];
}

/** owner/repo of a github.com pull request URL. */
export function githubRepo(prUrl: string | null): string | null {
	const m =
		prUrl && /^https:\/\/github\.com\/([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)\/pull\/\d+/.exec(prUrl);
	return m ? m[1] : null;
}

/**
 * The file on GitHub: on the task's branch while it is changed there and not
 * merged, else on the default branch.
 */
export function githubBlob(
	repo: string | null,
	branch: string | null,
	p: string,
	onBranch: boolean
): string | null {
	if (!repo) return null;
	const ref = onBranch && branch ? branch : 'HEAD';
	return `https://github.com/${repo}/blob/${ref.split('/').map(encodeURIComponent).join('/')}/${p
		.split('/')
		.map(encodeURIComponent)
		.join('/')}`;
}

/** Order for the list: decision records first, then changed docs, then docs read; by title. */
export function sortDocs(docs: DocRef[]): DocRef[] {
	const rank = (d: DocRef) => (d.kind === 'decision' ? 0 : 2) + (d.changed ? 0 : 1);
	return [...docs].sort((a, b) => rank(a) - rank(b) || a.title.localeCompare(b.title));
}
