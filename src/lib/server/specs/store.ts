import { randomBytes } from 'node:crypto';
import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
	emptySpec,
	IMAGE_NAME,
	normalizeSpec,
	SPEC_ID,
	summarize,
	type SpecDraft,
	type SpecSummary
} from '../../spec';

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

export class SpecStore {
	constructor(readonly dir: string) {}

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
	 * Save the captain's edits over an existing draft. The id, creation time
	 * and pictures (which only upload and remove change) are kept from the
	 * stored draft; `sentAt` is taken from the edit.
	 */
	async save(id: string, edit: unknown, now = new Date()): Promise<SpecDraft | null> {
		const before = await this.get(id);
		if (!before) return null;
		const next = normalizeSpec(edit, id, now);
		if (!next) return null;
		const captions = new Map(next.images.map((i) => [i.name, i.caption]));
		const d: SpecDraft = {
			...next,
			createdAt: before.createdAt,
			updatedAt: now.toISOString(),
			images: before.images.map((i) => ({ ...i, caption: captions.get(i.name) ?? i.caption }))
		};
		await this.write(d);
		return d;
	}

	async remove(id: string): Promise<boolean> {
		if (!SPEC_ID.test(id) || !(await this.get(id))) return false;
		await rm(this.file(id), { force: true });
		await rm(this.imageDir(id), { recursive: true, force: true });
		return true;
	}

	/** Store a picture for a draft and list it on the draft. */
	async addImage(
		id: string,
		type: string,
		bytes: Uint8Array,
		caption: string,
		now = new Date()
	): Promise<SpecDraft | null> {
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
	}

	async removeImage(id: string, name: string, now = new Date()): Promise<SpecDraft | null> {
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
