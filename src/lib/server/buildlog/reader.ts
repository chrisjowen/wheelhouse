import { open, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { runBounded } from '../firstmate/exec';
import { TASK_ID } from '../firstmate/adapter';
import type { EvidenceReader } from '../firstmate/evidence';
import type { LedgerTask } from '../firstmate/ledger';
import { checksView } from './checks';
import { conversation, parseInboxRecord, questionCounts, type InboxMessage } from './conversation';
import {
	docKind,
	docsFromTranscript,
	docTitle,
	githubBlob,
	githubRepo,
	isDocPath,
	readableName,
	sortDocs,
	type DocTouch
} from './docs';
import type { BuildHint, BuildInsight, DocRef, DocView } from '../../buildlog';
import type { BridgeMessage, DecisionView, TaskEvidence, TaskSummary } from '../../types';

/**
 * Reads what a task's build looks like from the inside, read-only and bounded:
 * - its steering inbox, state/<task>.inbox/*.msg and handled/*.msg (kept in
 *   memory once read, since cleanup removes the inbox);
 * - its latest validation run's step logs, ~/.no-mistakes/logs/<run>/<step>.log
 *   (tails), with the run's steps from the evidence reader;
 * - the pull request's body and files, through `gh pr view` (cached);
 * - the worker's Claude Code transcripts for its worktree, for the Read, Edit
 *   and Write calls it made on docs (only those fields are looked at);
 * - a doc's text, from the task worktree, else the project's clone.
 * Nothing here writes anywhere.
 */

export interface BuildReaderOptions {
	homeDir: string;
	evidence: EvidenceReader;
	/** no-mistakes run logs (null disables the checks report). */
	logsDir: string | null;
	/** Claude Code's projects directory (null: docs come from the change only). */
	claudeProjectsDir: string | null;
	env?: NodeJS.ProcessEnv;
	useGh?: boolean;
	now?: () => number;
}

/** What the caller already knows about the task. */
export interface BuildContext {
	task: TaskSummary;
	ledger: LedgerTask | null;
	/** The task worktree, while it is there. */
	worktree: string | null;
	/** The project's clone, for docs once the worktree is gone. */
	projectDir: string | null;
	/** Validation runs matched to the task (by the branch their logs name, or decision keys). */
	runs: string[];
	decided: DecisionView[];
	captain: BridgeMessage[];
	files: TaskEvidence['files'];
}

const MAX_INBOX = 80;
const MSG_BYTES = 64 * 1024;
const STEP_LOG_BYTES = 128 * 1024;
const TRANSCRIPT_BYTES = 16 * 1024 * 1024;
const MAX_TRANSCRIPTS = 30;
const DOC_BYTES = 512 * 1024;
const TITLE_BYTES = 16 * 1024;
const MAX_DOCS = 60;
const RUN_ID = /^[0-9A-Z]{26}$/;
const RUN_IN_DETAIL = /\brun: ([0-9A-Z]{26})\b/;
const STEP_KEYS = ['intent', 'rebase', 'review', 'test', 'document', 'lint', 'push', 'pr', 'ci'];

async function readHead(
	file: string,
	max: number
): Promise<{ text: string; whole: boolean } | null> {
	const st = await stat(file).catch(() => null);
	if (!st?.isFile()) return null;
	const fh = await open(file, 'r').catch(() => null);
	if (!fh) return null;
	try {
		const len = Math.min(st.size, max);
		const buf = Buffer.alloc(len);
		const { bytesRead } = await fh.read(buf, 0, len, 0);
		return { text: buf.subarray(0, bytesRead).toString('utf8'), whole: st.size <= max };
	} finally {
		await fh.close();
	}
}

async function readTail(file: string, max: number): Promise<string | null> {
	const st = await stat(file).catch(() => null);
	if (!st?.isFile()) return null;
	const fh = await open(file, 'r').catch(() => null);
	if (!fh) return null;
	try {
		const len = Math.min(st.size, max);
		const buf = Buffer.alloc(len);
		const { bytesRead } = await fh.read(buf, 0, len, st.size - len);
		return buf.subarray(0, bytesRead).toString('utf8');
	} finally {
		await fh.close();
	}
}

/** Bytes from..to of a file, at most the last `max` of them, and where the read ended. */
async function readRange(
	file: string,
	from: number,
	to: number,
	max: number
): Promise<{ text: string; end: number } | null> {
	const start = Math.max(from, to - max);
	if (to <= start) return { text: '', end: to };
	const fh = await open(file, 'r').catch(() => null);
	if (!fh) return null;
	try {
		const buf = Buffer.alloc(to - start);
		const { bytesRead } = await fh.read(buf, 0, to - start, start);
		return { text: buf.subarray(0, bytesRead).toString('utf8'), end: start + bytesRead };
	} finally {
		await fh.close();
	}
}

/** Claude Code's directory name for a working directory: every character outside [A-Za-z0-9] as `-`. */
export const transcriptDirName = (cwd: string) => cwd.replace(/[^A-Za-z0-9]/g, '-');

/** The Harbour card's hint, from the task's status lines and how many docs its change touches (both already read). */
export function buildHint(ledger: LedgerTask | null, docs: number | null): BuildHint | null {
	const q = ledger ? questionCounts(ledger.statuses) : { questions: 0, open: 0 };
	return q.questions || docs ? { ...q, docs: docs ?? 0 } : null;
}

interface Cached<T> {
	at: number;
	value: Promise<T>;
}

export class BuildReader {
	private env: NodeJS.ProcessEnv;
	private useGh: boolean;
	private now: () => number;
	private inbox = new Map<string, InboxMessage[]>();
	private inboxAt = new Map<string, number>();
	private touches = new Map<string, DocTouch[]>();
	private transcriptFiles = new Map<
		string,
		{ branch: string; size: number; touches: DocTouch[] }
	>();
	private prs = new Map<string, Cached<{ body: string | null; files: string[] } | null>>();
	private titles = new Map<string, string>();

	constructor(private opts: BuildReaderOptions) {
		this.env = opts.env ?? process.env;
		this.useGh = opts.useGh ?? true;
		this.now = opts.now ?? Date.now;
	}

	async insight(c: BuildContext): Promise<BuildInsight> {
		const [inbox, checks, docs] = await Promise.all([
			this.readInbox(c.task.id).catch(() => null),
			this.checks(c).catch((): BuildInsight['checks'] => ({
				available: false,
				reason: 'The validation run’s logs could not be read.'
			})),
			this.docs(c).catch((): BuildInsight['docs'] => ({
				available: false,
				reason: 'The docs could not be read.'
			}))
		]);
		const entries = conversation({
			statuses: c.ledger?.statuses ?? [],
			inbox: inbox ?? [],
			decided: c.decided,
			captain: c.captain,
			dispatchedAt: c.ledger?.dispatched?.ts ?? null
		});
		const talk: BuildInsight['conversation'] =
			c.ledger || inbox?.length || c.captain.length
				? {
						available: true,
						source: 'the worker’s status reports, Firstmate’s messages to the worker and yours',
						observedAt: new Date(this.now()).toISOString(),
						value: entries
					}
				: {
						available: false,
						reason:
							'Firstmate’s fleet ledger has no history for this task, so there is nothing to show.'
					};
		return { conversation: talk, checks, docs };
	}

	// ---------------------------------------------------------------- inbox

	private async readInbox(id: string): Promise<InboxMessage[]> {
		if (!TASK_ID.test(id)) return [];
		const last = this.inboxAt.get(id) ?? -Infinity;
		if (this.now() - last < 10_000) return this.inbox.get(id) ?? [];
		this.inboxAt.set(id, this.now());
		const dir = path.join(this.opts.homeDir, 'state', `${id}.inbox`);
		const list = async (d: string, handled: boolean) =>
			(await readdir(d).catch(() => [] as string[]))
				.filter((n) => /^[\w.-]+\.msg$/.test(n))
				.map((n) => ({ n, d, handled }));
		const names = [...(await list(dir, false)), ...(await list(path.join(dir, 'handled'), true))]
			.sort((a, b) => a.n.localeCompare(b.n))
			.slice(-MAX_INBOX);
		if (!names.length) return this.inbox.get(id) ?? [];
		const msgs: InboxMessage[] = [];
		for (const { n, d, handled } of names) {
			const r = await readHead(path.join(d, n), MSG_BYTES);
			if (!r) continue;
			const m = parseInboxRecord(n, r.text, handled);
			if (m.at === null) {
				const st = await stat(path.join(d, n)).catch(() => null);
				if (st) m.at = Math.floor(st.mtimeMs / 1000);
			}
			msgs.push(m);
		}
		// Keep what was read while the task lived: cleanup removes the inbox.
		this.inbox.set(id, msgs);
		return msgs;
	}

	// ---------------------------------------------------------------- checks

	private async latestRun(c: BuildContext): Promise<{ id: string; count: number } | null> {
		const crew = RUN_IN_DETAIL.exec(c.task.current?.detail ?? '')?.[1] ?? null;
		const ids = [...new Set([...(crew ? [crew] : []), ...c.runs])].filter((r) => RUN_ID.test(r));
		if (!ids.length || !this.opts.logsDir) return null;
		if (crew) return { id: crew, count: ids.length };
		const dated = await Promise.all(
			ids.map(async (id) => {
				const st = await stat(path.join(this.opts.logsDir!, id)).catch(() => null);
				return { id, at: st ? st.birthtimeMs || st.mtimeMs : 0 };
			})
		);
		dated.sort((a, b) => b.at - a.at || b.id.localeCompare(a.id));
		return { id: dated[0].id, count: ids.length };
	}

	private async checks(c: BuildContext): Promise<BuildInsight['checks']> {
		if (!this.opts.logsDir)
			return {
				available: false,
				reason: 'The validation run’s logs cannot be read on this machine.'
			};
		const run = await this.latestRun(c);
		if (!run) {
			return {
				available: false,
				reason:
					c.task.status === 'queued'
						? 'Work has not started.'
						: 'No validation run has been matched to this task yet. It runs once the work is ready.'
			};
		}
		const dir = path.join(this.opts.logsDir, run.id);
		const logs = new Map<string, string>();
		let startedAt: string | null = null;
		await Promise.all(
			STEP_KEYS.map(async (k) => {
				const text = await readTail(path.join(dir, `${k}.log`), STEP_LOG_BYTES);
				if (text !== null) logs.set(k, text);
			})
		);
		const first = await stat(path.join(dir, 'intent.log')).catch(() => null);
		if (first) startedAt = new Date(first.birthtimeMs || first.mtimeMs).toISOString();
		const pipeline = await this.opts.evidence.pipeline(run.id, c.worktree).catch(() => null);
		const pr = c.task.pr?.url ? await this.pr(c.task.pr.url) : null;
		const docs = await this.changedDocs(c, pr?.files ?? null);
		const view = checksView({
			pipeline,
			logs,
			startedAt,
			runs: run.count,
			prBody: pr?.body ?? null,
			docs: await Promise.all(docs.map(async (p) => ({ path: p, title: await this.title(c, p) }))),
			decided: c.decided
		});
		return {
			available: true,
			source: 'the validation run’s own step logs',
			observedAt: new Date(this.now()).toISOString(),
			value: view
		};
	}

	// ---------------------------------------------------------------- docs

	private async changedDocs(c: BuildContext, prFiles: string[] | null): Promise<string[]> {
		const files = c.files.available ? c.files.value.files.map((f) => f.path) : (prFiles ?? []);
		return files.filter(isDocPath);
	}

	private async docs(c: BuildContext): Promise<BuildInsight['docs']> {
		const pr = !c.files.available && c.task.pr?.url ? await this.pr(c.task.pr.url) : null;
		const changed = new Map<string, { additions: number | null; deletions: number | null }>();
		if (c.files.available) {
			for (const f of c.files.value.files)
				if (isDocPath(f.path))
					changed.set(f.path, { additions: f.additions, deletions: f.deletions });
		} else {
			for (const p of pr?.files ?? [])
				if (isDocPath(p)) changed.set(p, { additions: null, deletions: null });
		}
		const touched = await this.transcriptTouches(c);
		const paths = [...new Set([...changed.keys(), ...touched.map((t) => t.path)])].slice(
			0,
			MAX_DOCS
		);
		if (!paths.length && !c.files.available && !pr)
			return { available: false, reason: c.files.reason };
		const repo = githubRepo(c.task.pr?.url ?? null);
		const landed = c.task.status === 'landed' || !!c.task.mergedAt;
		const refs: DocRef[] = await Promise.all(
			paths.map(async (p) => {
				const t = touched.find((x) => x.path === p);
				const ch = changed.get(p);
				return {
					path: p,
					name: path.basename(p),
					title: await this.title(c, p),
					kind: docKind(p),
					changed: !!ch || !!t?.changed,
					read: !!t?.read,
					additions: ch?.additions ?? null,
					deletions: ch?.deletions ?? null,
					github: githubBlob(repo, c.task.branch, p, !!ch && !landed)
				};
			})
		);
		return {
			available: true,
			source: this.opts.claudeProjectsDir
				? 'the change itself and the files the worker’s session opened'
				: 'the change itself',
			observedAt: new Date(this.now()).toISOString(),
			value: sortDocs(refs)
		};
	}

	/** Docs the worker's Claude Code session read or changed, from its transcripts for the worktree. */
	private async transcriptTouches(c: BuildContext): Promise<DocTouch[]> {
		const id = c.task.id;
		const branch = c.task.branch ?? `fm/${id}`;
		if (!this.opts.claudeProjectsDir || !c.worktree) return this.touches.get(id) ?? [];
		const dir = path.join(this.opts.claudeProjectsDir, transcriptDirName(c.worktree));
		const since = (c.ledger?.dispatched?.ts ?? 0) * 1000;
		const names = (await readdir(dir).catch(() => [] as string[])).filter((n) =>
			n.endsWith('.jsonl')
		);
		const files = (
			await Promise.all(
				names.map(async (n) => {
					const st = await stat(path.join(dir, n)).catch(() => null);
					return st?.isFile() && st.mtimeMs >= since ? { n, st } : null;
				})
			)
		)
			.filter((x): x is NonNullable<typeof x> => !!x)
			.sort((a, b) => b.st.mtimeMs - a.st.mtimeMs)
			.slice(0, MAX_TRANSCRIPTS);
		const merged = new Map<string, DocTouch>();
		for (const { n, st } of files) {
			const file = path.join(dir, n);
			let hit = this.transcriptFiles.get(file);
			// Transcripts only grow: read just what was appended since the last read.
			const from = hit && hit.branch === branch && hit.size <= st.size ? hit.size : 0;
			if (!hit || hit.branch !== branch || hit.size !== st.size) {
				const read = await readRange(file, from, st.size, TRANSCRIPT_BYTES);
				const lines = read ? read.text.split('\n') : [];
				// A partial last line is read again next time.
				const partial = read && !read.text.endsWith('\n') ? (lines.pop() ?? '') : '';
				const found = docsFromTranscript(lines, c.worktree, branch);
				const touches = from ? [...(hit?.touches ?? [])] : [];
				for (const t of found) {
					const m = touches.find((x) => x.path === t.path);
					if (m) {
						m.read ||= t.read;
						m.changed ||= t.changed;
					} else touches.push(t);
				}
				hit = { branch, size: read ? read.end - Buffer.byteLength(partial) : st.size, touches };
				this.transcriptFiles.set(file, hit);
			}
			for (const t of hit.touches) {
				const m = merged.get(t.path) ?? { ...t };
				m.read ||= t.read;
				m.changed ||= t.changed;
				merged.set(t.path, m);
			}
		}
		const out = [...merged.values()];
		// Keep what was found while the worktree existed: the transcripts no longer match once it is gone.
		if (out.length) this.touches.set(id, out);
		return out.length ? out : (this.touches.get(id) ?? []);
	}

	/** A doc's first heading, else its file name in words. */
	private async title(c: BuildContext, p: string): Promise<string> {
		const key = `${c.task.id} ${p}`;
		const known = this.titles.get(key);
		if (known) return known;
		const text = await this.docText(c, p, TITLE_BYTES).catch(() => null);
		const t = text ? docTitle(text.text, p) : readableName(p);
		if (text) this.titles.set(key, t);
		return t;
	}

	/** A doc's text: from the worktree, else the project's clone at its default branch. */
	private async docText(
		c: BuildContext,
		p: string,
		max: number
	): Promise<{ text: string; whole: boolean; from: string } | null> {
		if (!isDocPath(p)) return null;
		if (c.worktree) {
			const file = path.join(c.worktree, p);
			if (file.startsWith(c.worktree + path.sep)) {
				const r = await readHead(file, max);
				if (r) return { ...r, from: 'the task’s working copy' };
			}
		}
		if (c.projectDir && path.isAbsolute(c.projectDir)) {
			for (const ref of ['origin/HEAD', 'origin/main', 'origin/master', 'HEAD']) {
				const r = await runBounded(
					'git',
					['--no-optional-locks', '-C', c.projectDir, 'show', `${ref}:${p}`],
					{
						env: { ...this.env, GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0' },
						timeoutMs: 5000,
						maxOutputBytes: max
					}
				);
				if (r.ok) return { text: r.stdout, whole: true, from: 'the project’s main branch' };
				if (r.kind === 'output-limit') return null;
			}
		}
		return null;
	}

	/** One doc for the reader page: only a doc the task's list names. */
	async doc(c: BuildContext, p: string): Promise<DocView> {
		const docs = await this.docs(c);
		if (!docs.available) return { available: false, reason: docs.reason };
		const ref = docs.value.find((d) => d.path === p);
		if (!ref)
			return { available: false, reason: 'That document is not in this task’s list of docs.' };
		const text = await this.docText(c, p, DOC_BYTES);
		if (!text) {
			return {
				available: false,
				reason: ref.github
					? 'Its text is not on this machine any more; it can still be read on GitHub.'
					: 'Its text is not on this machine any more.'
			};
		}
		return {
			available: true,
			source: text.from,
			observedAt: new Date(this.now()).toISOString(),
			value: {
				path: ref.path,
				name: ref.name,
				title: ref.title,
				kind: ref.kind,
				markdown: text.text,
				truncated: !text.whole,
				github: ref.github,
				changed: ref.changed
			}
		};
	}

	// ---------------------------------------------------------------- pull request

	/** The pull request's body and changed files (`gh pr view`, cached for a minute); null without gh. */
	private pr(url: string): Promise<{ body: string | null; files: string[] } | null> {
		if (!this.useGh || !/^https:\/\/\S+\/pull\/\d+/.test(url)) return Promise.resolve(null);
		const hit = this.prs.get(url);
		if (hit && this.now() - hit.at < 60_000) return hit.value;
		const value = (async () => {
			const r = await runBounded('gh', ['pr', 'view', url, '--json', 'body,files'], {
				env: { ...this.env, GH_PROMPT_DISABLED: '1' },
				timeoutMs: 10_000,
				maxOutputBytes: 2 * 1024 * 1024
			});
			if (!r.ok) return null;
			try {
				const v = JSON.parse(r.stdout);
				return {
					body: typeof v.body === 'string' ? v.body : null,
					files: Array.isArray(v.files)
						? v.files
								.map((f: { path?: unknown }) => f?.path)
								.filter((x: unknown) => typeof x === 'string')
						: []
				};
			} catch {
				return null;
			}
		})();
		this.prs.set(url, { at: this.now(), value });
		if (this.prs.size > 200) this.prs.delete(this.prs.keys().next().value!);
		return value;
	}
}
