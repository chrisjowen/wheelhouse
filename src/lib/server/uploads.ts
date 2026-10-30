import { randomBytes } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, open, readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { Attachment } from '$lib/chat/attachments';
import { UPLOAD_KEEP_DAYS, UPLOAD_MAX_BYTES } from '$lib/chat/attachments';
import { defaultStateDir, isInside } from './store/store';

/**
 * Files the captain attaches in the Firstmate chat. Each is saved under
 * Wheelhouse's state directory, outside any project clone and any git
 * repository, at uploads/<UTC day>/<random id>/<name>, readable only by the
 * captain's user (which the Firstmate session runs as). The message carries
 * the absolute path; Firstmate opens the file with its own tools. Day folders
 * older than UPLOAD_KEEP_DAYS are deleted when Wheelhouse starts and whenever
 * a file is attached. Nothing here runs or renders a file: the chat shows a
 * thumbnail only for files whose bytes are a raster image (see `uploadedImage`).
 */

export const uploadsDir = (env: NodeJS.ProcessEnv): string =>
	path.join(defaultStateDir(env), 'uploads');

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const ID = /^[a-f0-9]{12}$/;
const NAME_MAX = 120;

/**
 * A file name safe to keep on disk and quote in a message: no folders, no
 * control or shell-awkward characters, no leading dots, at most NAME_MAX
 * characters with the extension kept.
 */
export function safeName(raw: string): string {
	const base = raw.split(/[/\\]/).pop() ?? '';
	let name = base
		.normalize('NFC')
		.replace(/\s+/g, ' ')
		// eslint-disable-next-line no-control-regex -- control characters are exactly what is dropped
		.replace(/[\u0000-\u001f\u007f]/g, '')
		.replace(/[<>:"|?*[\]`$\\]/g, '_')
		.trim()
		.replace(/^[.\s-]+/, '');
	if (name.length > NAME_MAX) {
		const ext = /\.[A-Za-z0-9]{1,10}$/.exec(name)?.[0] ?? '';
		name = name.slice(0, NAME_MAX - ext.length).trimEnd() + ext;
	}
	return name || 'file';
}

/** A MIME type as the browser named it, or '' when it is missing or malformed. */
export function safeType(raw: string | null): string {
	const t = (raw ?? '').split(';')[0].trim().toLowerCase();
	return /^[a-z0-9][\w.+-]*\/[a-z0-9][\w.+-]*$/.test(t) && t.length <= 100 ? t : '';
}

export type Saved = { ok: true; upload: Attachment } | { ok: false; status: number; error: string };

export const TOO_LARGE = `That file is over ${UPLOAD_MAX_BYTES / (1024 * 1024)} MB, the most Wheelhouse takes.`;

/** Save one uploaded file's bytes, refusing (and leaving nothing behind) past UPLOAD_MAX_BYTES. */
export async function saveUpload(
	dir: string,
	opts: { name: string; type: string; body: ReadableStream<Uint8Array> | null; now?: Date }
): Promise<Saved> {
	if (!opts.body) return { ok: false, status: 400, error: 'The file is empty.' };
	const name = safeName(opts.name);
	const day = (opts.now ?? new Date()).toISOString().slice(0, 10);
	const folder = path.join(dir, day, randomBytes(6).toString('hex'));
	const file = path.join(folder, name);
	await mkdir(folder, { recursive: true, mode: 0o700 });
	let size = 0;
	const count = new Transform({
		transform(chunk: Buffer, _enc, done) {
			size += chunk.length;
			if (size > UPLOAD_MAX_BYTES) done(new RangeError(TOO_LARGE));
			else done(null, chunk);
		}
	});
	try {
		await pipeline(
			Readable.fromWeb(opts.body as import('node:stream/web').ReadableStream),
			count,
			createWriteStream(file, { mode: 0o600, flags: 'wx' })
		);
	} catch (e) {
		await rm(folder, { recursive: true, force: true });
		if (e instanceof RangeError) return { ok: false, status: 413, error: TOO_LARGE };
		return { ok: false, status: 500, error: 'Wheelhouse could not save the file.' };
	}
	if (size === 0) {
		await rm(folder, { recursive: true, force: true });
		return { ok: false, status: 400, error: 'The file is empty.' };
	}
	return { ok: true, upload: { path: file, name, size, type: opts.type } };
}

/** Delete day folders more than `keepDays` old. Never fails: a file in use is tried again next time. */
export async function cleanUploads(
	dir: string,
	now = new Date(),
	keepDays = UPLOAD_KEEP_DAYS
): Promise<string[]> {
	const cutoff = new Date(now.getTime() - keepDays * 86_400_000).toISOString().slice(0, 10);
	let days: string[];
	try {
		days = await readdir(dir);
	} catch {
		return [];
	}
	const old = days.filter((d) => DAY.test(d) && d < cutoff);
	await Promise.all(
		old.map((d) => rm(path.join(dir, d), { recursive: true, force: true }).catch(() => {}))
	);
	return old;
}

/** The raster image type a file's first bytes show, or null. SVG and anything else never count. */
export function sniffImage(head: Uint8Array): string | null {
	const b = Buffer.from(head);
	if (b.length >= 8 && b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])))
		return 'image/png';
	if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
	if (b.length >= 6 && /^GIF8[79]a$/.test(b.subarray(0, 6).toString('latin1'))) return 'image/gif';
	if (
		b.length >= 12 &&
		b.subarray(0, 4).toString('latin1') === 'RIFF' &&
		b.subarray(8, 12).toString('latin1') === 'WEBP'
	)
		return 'image/webp';
	if (b.length >= 12 && /^ftypavi[fs]$/.test(b.subarray(4, 12).toString('latin1')))
		return 'image/avif';
	return null;
}

/**
 * An uploaded file to show as a thumbnail: its path and sniffed image type, or
 * null when the parts do not name a file in the uploads folder or the file is
 * not a raster image.
 */
export async function uploadedImage(
	dir: string,
	day: string,
	id: string,
	name: string
): Promise<{ file: string; type: string; bytes: Buffer } | null> {
	if (!DAY.test(day) || !ID.test(id) || safeName(name) !== name) return null;
	const file = path.join(dir, day, id, name);
	if (!isInside(file, dir)) return null;
	let fh;
	try {
		fh = await open(file, 'r');
		const st = await fh.stat();
		if (!st.isFile() || st.size > UPLOAD_MAX_BYTES) return null;
		const bytes = await fh.readFile();
		const type = sniffImage(bytes.subarray(0, 16));
		return type ? { file, type, bytes } : null;
	} catch {
		return null;
	} finally {
		await fh?.close();
	}
}
