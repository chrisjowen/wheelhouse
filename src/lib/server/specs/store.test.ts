import { mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SpecStore } from './store';

let root: string;
let store: SpecStore;

beforeEach(async () => {
	root = await mkdtemp(path.join(tmpdir(), 'wh-specs-'));
	store = new SpecStore(path.join(root, 'specs'));
});
afterEach(async () => {
	await rm(root, { recursive: true, force: true });
});

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);

describe('SpecStore', () => {
	it('lists nothing before the first draft', async () => {
		expect(await store.list()).toEqual([]);
	});

	it('creates, saves and lists drafts, most recently edited first', async () => {
		const a = await store.create(new Date('2026-10-26T08:00:00Z'));
		const b = await store.create(new Date('2026-10-26T08:30:00Z'));
		await store.save(a.id, { ...a, title: 'Saved searches' }, new Date('2026-10-26T09:00:00Z'));
		const list = await store.list();
		expect(list.map((s) => s.title)).toEqual(['Saved searches', 'Untitled spec']);
		expect(list[1].id).toBe(b.id);
		const back = await store.get(a.id);
		expect(back?.title).toBe('Saved searches');
		expect(back?.createdAt).toBe('2026-10-26T08:00:00.000Z');
		expect(back?.updatedAt).toBe('2026-10-26T09:00:00.000Z');
	});

	it('refuses ids that are not its own', async () => {
		expect(await store.get('../../etc/passwd')).toBeNull();
		expect(await store.save('spec-missing1', {})).toBeNull();
		expect(await store.remove('../x')).toBe(false);
	});

	it('keeps pictures to upload and removal, but takes caption edits', async () => {
		const d = await store.create();
		const withImg = await store.addImage(d.id, 'image/png', PNG, 'Filter bar');
		const img = withImg!.images[0];
		expect(img.name).toMatch(/^img-[0-9a-f]{12}\.png$/);
		const saved = await store.save(d.id, {
			...withImg,
			images: [
				{ ...img, caption: 'The filter bar' },
				{ name: 'img-forged1.png', caption: '' }
			]
		});
		expect(saved?.images).toEqual([{ name: img.name, caption: 'The filter bar' }]);
		const read = await store.readImage(d.id, img.name);
		expect(read?.type).toBe('image/png');
		expect([...read!.bytes]).toEqual([...PNG]);
		expect(await store.readImage(d.id, 'img-forged1.png')).toBeNull();

		const after = await store.removeImage(d.id, img.name);
		expect(after?.images).toEqual([]);
		expect(await readdir(store.imageDir(d.id))).toEqual([]);
	});

	it('refuses picture types it does not show', async () => {
		const d = await store.create();
		expect(await store.addImage(d.id, 'image/svg+xml', PNG, '')).toBeNull();
	});

	it('deletes a draft and its pictures', async () => {
		const d = await store.create();
		await store.addImage(d.id, 'image/png', PNG, '');
		expect(await store.remove(d.id)).toBe(true);
		expect(await store.get(d.id)).toBeNull();
		await expect(stat(store.imageDir(d.id))).rejects.toThrow();
	});

	it('writes plain JSON files', async () => {
		const d = await store.create();
		const doc = JSON.parse(await readFile(path.join(store.dir, `${d.id}.json`), 'utf8'));
		expect(doc.schema).toBe('wheelhouse-spec.v1');
	});
});
