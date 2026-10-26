import { randomBytes } from 'node:crypto';
import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
	COMMENT_ID,
	emptySpec,
	IMAGE_NAME,
	isSectionId,
	MAX_TURNS,
	normalizeSpec,
	SPEC_ID,
	summarize,
	type SpecComment,
	type SpecDraft,
	type SpecSummary
} from '../../spec';
import type { ClaudeUsage } from '../claude/headless';
import { applyReply, type AgentReply } from './interview';

/**
 * The captain's spec drafts, kept in Wheelhouse's own state directory:
 * `<state>/specs/<id>.json`, and each spec's pictures in `<state>/specs/<id>/`.
 * Never in the Firstmate home. Ids and picture names are generated here and
 * checked against fixed patterns, so a request can never name another path.
 * Writes go to a temporary file renamed over the old one.
 */

/** Largest picture accepted. */
export const SPEC_IMAGE_MAX_BYTES = 10 * 1024 * 1024;
/** Picture types accepted, by content type. */
export const SPEC_IMAGE_TYPES: Record<string, string> = {
	'image/png': 'png',
	'image/jpeg': 'jpg',
	'image/webp': 'webp',
	'image/gif': 'gif'
};
const CONTENT_TYPE: Record<string, string> = {
	png: 'image/png',
	jpg: 'image/jpeg',
	jpeg: 'image/jpeg',
	webp: 'image/webp',
	gif: 'image/gif'
};

const token = () => randomBytes(6).toString('hex');

const addUsage = (d: SpecDraft, u: ClaudeUsage) => ({
	turns: d.interview.usage.turns + 1,
	inputTokens: d.interview.usage.inputTokens + u.inputTokens,
	outputTokens: d.interview.usage.outputTokens + u.outputTokens,
	costUsd: d.interview.usage.costUsd + u.costUsd
});

export class SpecStore {
	private queues = new Map<string, Promise<unknown>>();

	constructor(readonly dir: string) {}

	/** Run one read-change-write of a draft after any already under way for it. */
	private serial<T>(id: string, fn: () => Promise<T>): Promise<T> {
		const run = (this.queues.get(id) ?? Promise.resolve()).then(fn, fn);
		const tail = run.catch(() => {});
		this.queues.set(id, tail);
		void tail.then(() => {
			if (this.queues.get(id) === tail) this.queues.delete(id);
		});
		return run;
	}

	private file(id: string): string {
		return path.join(this.dir, `${id}.json`);
	}

	/** Where a spec's pictures live (also what the message to Firstmate names). */
	imageDir(id: string): string {
		return path.join(this.dir, id);
	}

	/** Every draft, most recently edited first. Unreadable files are skipped. */
	async list(): Promise<SpecSummary[]> {
		let names: string[];
		try {
			names = await readdir(this.dir);
		} catch {
			return [];
		}
		const out: SpecSummary[] = [];
		for (const n of names) {
			const id = n.endsWith('.json') ? n.slice(0, -5) : '';
			if (!SPEC_ID.test(id)) continue;
			const d = await this.get(id);
			if (d) out.push(summarize(d));
		}
		return out.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
	}

	async get(id: string): Promise<SpecDraft | null> {
		if (!SPEC_ID.test(id)) return null;
		try {
			return normalizeSpec(JSON.parse(await readFile(this.file(id), 'utf8')), id);
		} catch {
			return null;
		}
	}

	async create(now = new Date()): Promise<SpecDraft> {
		const d = emptySpec(`spec-${token()}`, now);
		await this.write(d);
		return d;
	}

	/**
	 * Save the captain's edits over an existing draft. The id, creation time,
	 * pictures (which only upload and remove change), when it was last sent
	 * (which only `markSent` changes), the interview and the comments (which
	 * only their own calls change) are kept from the stored draft.
	 */
	save(id: string, edit: unknown, now = new Date()): Promise<SpecDraft | null> {
		return this.serial(id, async () => {
			const before = await this.get(id);
			if (!before) return null;
			const next = normalizeSpec(edit, id, now);
			if (!next) return null;
			const captions = new Map(next.images.map((i) => [i.name, i.caption]));
			const d: SpecDraft = {
				...next,
				createdAt: before.createdAt,
				updatedAt: now.toISOString(),
				sentAt: before.sentAt,
				interview: before.interview,
				comments: before.comments,
				images: before.images.map((i) => ({
					...i,
					caption: captions.get(i.name) ?? i.caption
				}))
			};
			await this.write(d);
			return d;
		});
	}

	/** Record that the draft was sent to Firstmate, changing nothing else. */
	markSent(id: string, now = new Date()): Promise<SpecDraft | null> {
		return this.serial(id, async () => {
			const d = await this.get(id);
			if (!d) return null;
			const next: SpecDraft = { ...d, sentAt: now.toISOString() };
			await this.write(next);
			return next;
		});
	}

	/** Change a draft with `fn` (null when there is no such draft), stamped and written. */
	private change(
		id: string,
		now: Date,
		fn: (d: SpecDraft) => SpecDraft | null
	): Promise<SpecDraft | null> {
		return this.serial(id, async () => {
			const d = await this.get(id);
			const next = d && fn(d);
			if (!next) return null;
			const out = { ...next, updatedAt: now.toISOString() };
			await this.write(out);
			return out;
		});
	}

	/** Add what the captain said to the interview. */
	addAnswer(id: string, text: string, now = new Date()): Promise<SpecDraft | null> {
		return this.change(id, now, (d) => ({
			...d,
			mode: 'interview',
			interview: {
				...d.interview,
				turns: [
					...d.interview.turns,
					{
						role: 'captain' as const,
						text: text.slice(0, 20_000),
						at: now.toISOString(),
						options: [],
						recommended: null,
						changed: []
					}
				].slice(-MAX_TURNS)
			}
		}));
	}

	/**
	 * Apply the agent's reply to the draft as it is now (comments added while
	 * the agent worked are kept), and count what the turn cost.
	 */
	applyAgent(
		id: string,
		reply: AgentReply,
		usage: ClaudeUsage,
		now = new Date()
	): Promise<SpecDraft | null> {
		return this.change(id, now, (d) => {
			const { draft } = applyReply(d, reply, now);
			draft.interview.turns = draft.interview.turns.slice(-MAX_TURNS);
			draft.interview.usage = addUsage(d, usage);
			return draft;
		});
	}

	/** Count what a turn that produced no reply cost. */
	addUsage(id: string, usage: ClaudeUsage, now = new Date()): Promise<SpecDraft | null> {
		return this.change(id, now, (d) => ({
			...d,
			interview: { ...d.interview, usage: addUsage(d, usage) }
		}));
	}

	/** Leave a comment on a section of the spec, for the agent to address. */
	addComment(
		id: string,
		c: { section: unknown; quote: unknown; text: unknown },
		now = new Date()
	): Promise<SpecDraft | null> {
		const text = typeof c.text === 'string' ? c.text.trim().slice(0, 4000) : '';
		if (!isSectionId(c.section) || !text) return Promise.resolve(null);
		const comment: SpecComment = {
			id: `c-${token()}`,
			section: c.section,
			quote: typeof c.quote === 'string' ? c.quote.trim().slice(0, 2000) : '',
			text,
			at: now.toISOString(),
			resolvedAt: null,
			reply: ''
		};
		return this.change(id, now, (d) =>
			d.comments.length >= 100 ? null : { ...d, comments: [...d.comments, comment] }
		);
	}

	/** Take a comment back. */
	removeComment(id: string, commentId: string, now = new Date()): Promise<SpecDraft | null> {
		if (!COMMENT_ID.test(commentId)) return Promise.resolve(null);
		return this.change(id, now, (d) =>
			d.comments.some((c) => c.id === commentId)
				? { ...d, comments: d.comments.filter((c) => c.id !== commentId) }
				: null
		);
	}

	/**
	 * Write the whole spec beside the draft as `spec.md`, for a spec too long
	 * to send as one message; returns the file's path.
	 */
	async writeAttachment(id: string, markdown: string): Promise<string | null> {
		if (!SPEC_ID.test(id) || !(await this.get(id))) return null;
		const file = path.join(this.imageDir(id), 'spec.md');
		await mkdir(this.imageDir(id), { recursive: true });
		const tmp = `${file}.${token()}.tmp`;
		await writeFile(tmp, markdown);
		await rename(tmp, file);
		return file;
	}

	remove(id: string): Promise<boolean> {
		return this.serial(id, async () => {
			if (!SPEC_ID.test(id) || !(await this.get(id))) return false;
			await rm(this.file(id), { force: true });
			await rm(this.imageDir(id), { recursive: true, force: true });
			return true;
		});
	}

	/** Store a picture for a draft and list it on the draft. */
	addImage(
		id: string,
		type: string,
		bytes: Uint8Array,
		caption: string,
		now = new Date()
	): Promise<SpecDraft | null> {
		return this.serial(id, async () => {
			const ext = SPEC_IMAGE_TYPES[type];
			const d = await this.get(id);
			if (!ext || !d) return null;
			const name = `img-${token()}.${ext}`;
			await mkdir(this.imageDir(id), { recursive: true });
			await writeFile(path.join(this.imageDir(id), name), bytes);
			const next: SpecDraft = {
				...d,
				updatedAt: now.toISOString(),
				images: [...d.images, { name, caption: caption.slice(0, 500) }]
			};
			await this.write(next);
			return next;
		});
	}

	removeImage(id: string, name: string, now = new Date()): Promise<SpecDraft | null> {
		return this.serial(id, async () => {
			const d = await this.get(id);
			if (!d || !IMAGE_NAME.test(name)) return null;
			await rm(path.join(this.imageDir(id), name), { force: true });
			const next: SpecDraft = {
				...d,
				updatedAt: now.toISOString(),
				images: d.images.filter((i) => i.name !== name)
			};
			await this.write(next);
			return next;
		});
	}

	/** A picture the draft lists, with its content type; null for anything else. */
	async readImage(id: string, name: string): Promise<{ bytes: Buffer; type: string } | null> {
		if (!SPEC_ID.test(id) || !IMAGE_NAME.test(name)) return null;
		const d = await this.get(id);
		if (!d?.images.some((i) => i.name === name)) return null;
		try {
			const bytes = await readFile(path.join(this.imageDir(id), name));
			return {
				bytes,
				type: CONTENT_TYPE[name.split('.').pop() ?? ''] ?? 'application/octet-stream'
			};
		} catch {
			return null;
		}
	}

	private async write(d: SpecDraft): Promise<void> {
		await mkdir(this.dir, { recursive: true });
		const file = this.file(d.id);
		const tmp = `${file}.${token()}.tmp`;
		await writeFile(tmp, JSON.stringify(d, null, 2));
		await rename(tmp, file);
	}
}
