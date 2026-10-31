import {
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	statSync,
	symlinkSync,
	writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { UPLOAD_MAX_BYTES } from '$lib/chat/attachments';
import {
	cleanUploads,
	safeName,
	safeType,
	saveUpload,
	sniffImage,
	uploadedImage,
	uploadsDir
} from './uploads';

const PNG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82]);
const NOW = new Date('2026-10-31T12:00:00Z');

const body = (...chunks: Uint8Array[]) =>
	new ReadableStream<Uint8Array>({
		start(c) {
			for (const ch of chunks) c.enqueue(ch);
			c.close();
		}
	});

let dir: string;
beforeEach(() => {
	dir = path.join(mkdtempSync(path.join(tmpdir(), 'wh-uploads-')), 'uploads');
});

describe('uploadsDir', () => {
	it('sits in Wheelhouse’s state directory, not in Firstmate’s home or a project', () => {
		expect(uploadsDir({ WHEELHOUSE_STATE_DIR: '/s' })).toBe('/s/uploads');
		expect(uploadsDir({ HOME: '/h' })).toBe('/h/.local/state/wheelhouse/uploads');
	});
});

describe('safeName', () => {
	it.each([
		['report.pdf', 'report.pdf'],
		['../../etc/passwd', 'passwd'],
		['C:\\Users\\me\\shot.png', 'shot.png'],
		['.bashrc', 'bashrc'],
		['..', 'file'],
		['', 'file'],
		['a\u0000b\nc\u2028.txt', 'ab c .txt'],
		['$(rm -rf ~) `x` [1].sh', '_(rm -rf ~) _x_ _1_.sh'],
		['  lots   of\tspace .md ', 'lots of space .md'],
		['-rf.txt', 'rf.txt']
	])('%j → %j', (raw, safe) => {
		expect(safeName(raw)).toBe(safe);
	});

	it('shortens a long name but keeps its extension', () => {
		const s = safeName(`${'x'.repeat(300)}.jpeg`);
		expect(s).toHaveLength(120);
		expect(s.endsWith('.jpeg')).toBe(true);
	});
});

describe('safeType', () => {
	it('keeps a plain MIME type and drops anything else', () => {
		expect(safeType('Image/PNG')).toBe('image/png');
		expect(safeType('text/plain; charset=utf-8')).toBe('text/plain');
		expect(safeType('text/html, x]')).toBe('');
		expect(safeType(null)).toBe('');
	});
});

describe('saveUpload', () => {
	it('saves the bytes under the day and a random folder, readable only by this user', async () => {
		const r = await saveUpload(dir, {
			name: '../shot.png',
			type: 'image/png',
			body: body(PNG),
			now: NOW
		});
		expect(r.ok).toBe(true);
		if (!r.ok) return;
		expect(r.upload).toMatchObject({ name: 'shot.png', size: PNG.length, type: 'image/png' });
		expect(r.upload.path).toMatch(
			new RegExp(
				`^${dir.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/2026-10-31/[a-f0-9]{12}/shot\\.png$`
			)
		);
		expect(readFileSync(r.upload.path)).toEqual(PNG);
		expect(statSync(r.upload.path).mode & 0o777).toBe(0o600);
		expect(statSync(path.dirname(r.upload.path)).mode & 0o777).toBe(0o700);
	});

	it('keeps two files of the same name apart', async () => {
		const a = await saveUpload(dir, { name: 'a.txt', type: '', body: body(Buffer.from('1')) });
		const b = await saveUpload(dir, { name: 'a.txt', type: '', body: body(Buffer.from('2')) });
		expect(a.ok && b.ok && a.upload.path !== b.upload.path).toBe(true);
	});

	it('refuses a file over the limit and leaves nothing behind', async () => {
		const mb = new Uint8Array(1024 * 1024);
		const chunks = Array.from({ length: UPLOAD_MAX_BYTES / mb.length + 1 }, () => mb);
		const r = await saveUpload(dir, { name: 'big.bin', type: '', body: body(...chunks), now: NOW });
		expect(r).toMatchObject({ ok: false, status: 413 });
		expect(readdirSync(path.join(dir, '2026-10-31'))).toEqual([]);
	});

	it('refuses an empty file', async () => {
		const r = await saveUpload(dir, { name: 'e.txt', type: '', body: body(), now: NOW });
		expect(r).toMatchObject({ ok: false, status: 400 });
		expect(readdirSync(path.join(dir, '2026-10-31'))).toEqual([]);
		expect(await saveUpload(dir, { name: 'e.txt', type: '', body: null })).toMatchObject({
			ok: false,
			status: 400
		});
	});
});

describe('cleanUploads', () => {
	it('deletes day folders past the keeping time and nothing else', async () => {
		for (const d of ['2026-10-20', '2026-10-23', '2026-10-24', '2026-10-31', 'notes']) {
			mkdirSync(path.join(dir, d, 'aaaaaaaaaaaa'), { recursive: true });
		}
		expect(await cleanUploads(dir, NOW, 7)).toEqual(['2026-10-20', '2026-10-23']);
		expect(readdirSync(dir).sort()).toEqual(['2026-10-24', '2026-10-31', 'notes']);
	});

	it('does nothing when there is no uploads folder yet', async () => {
		expect(await cleanUploads(path.join(dir, 'missing'), NOW)).toEqual([]);
	});
});

describe('sniffImage', () => {
	it('knows raster images by their bytes', () => {
		expect(sniffImage(PNG)).toBe('image/png');
		expect(sniffImage(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg');
		expect(sniffImage(Buffer.from('GIF89a......'))).toBe('image/gif');
		expect(sniffImage(Buffer.from('RIFF....WEBPVP8 '))).toBe('image/webp');
		expect(sniffImage(Buffer.from('\0\0\0\x1cftypavif'))).toBe('image/avif');
	});

	it('never takes SVG, HTML or anything else for an image', () => {
		expect(sniffImage(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg">'))).toBeNull();
		expect(sniffImage(Buffer.from('<!doctype html><script>'))).toBeNull();
		expect(sniffImage(Buffer.from('%PDF-1.7'))).toBeNull();
	});
});

describe('uploadedImage', () => {
	const put = (day: string, id: string, name: string, bytes: Buffer) => {
		mkdirSync(path.join(dir, day, id), { recursive: true });
		writeFileSync(path.join(dir, day, id, name), bytes);
	};

	it('serves an uploaded image with the type its bytes show', async () => {
		put('2026-10-31', '0a1b2c3d4e5f', 'shot.png', PNG);
		const img = await uploadedImage(dir, '2026-10-31', '0a1b2c3d4e5f', 'shot.png');
		expect(img?.type).toBe('image/png');
		expect(img?.bytes).toEqual(PNG);
	});

	it('refuses a file that is not a raster image, whatever its name says', async () => {
		put('2026-10-31', '0a1b2c3d4e5f', 'evil.png', Buffer.from('<svg onload="alert(1)"/>'));
		expect(await uploadedImage(dir, '2026-10-31', '0a1b2c3d4e5f', 'evil.png')).toBeNull();
	});

	it.each([
		['..', '0a1b2c3d4e5f', 'shot.png'],
		['2026-10-31', '..', 'shot.png'],
		['2026-10-31', '0a1b2c3d4e5f', '../shot.png'],
		['2026-10-31', '0a1b2c3d4e5f', '.shot.png'],
		['2026-10-31', '0a1b2c3d4e5f', 'missing.png']
	])('refuses %s/%s/%s', async (day, id, name) => {
		put('2026-10-31', '0a1b2c3d4e5f', 'shot.png', PNG);
		expect(await uploadedImage(dir, day, id, name)).toBeNull();
	});

	it('refuses a link that leads out of the uploads folder', async () => {
		const outside = path.join(path.dirname(dir), 'secret.png');
		writeFileSync(outside, PNG);
		mkdirSync(path.join(dir, '2026-10-31', '0a1b2c3d4e5f'), { recursive: true });
		symlinkSync(outside, path.join(dir, '2026-10-31', '0a1b2c3d4e5f', 'link.png'));
		expect(await uploadedImage(dir, '2026-10-31', '0a1b2c3d4e5f', 'link.png')).toBeNull();
	});
});
