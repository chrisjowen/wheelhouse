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

	it('keeps a picture uploaded while an edit is being saved', async () => {
		const d = await store.create();
		let done = false;
		const upload = store.addImage(d.id, 'image/png', PNG, 'Filter bar').finally(() => {
			done = true;
		});
		const saves: Promise<unknown>[] = [];
		while (!done) {
			saves.push(store.save(d.id, { ...d, title: `Edit ${saves.length}` }));
			await new Promise((r) => setImmediate(r));
		}
		await Promise.all(saves);
		const name = (await upload)!.images[0].name;
		await store.save(d.id, { ...d, title: 'Saved searches, again' });
		const back = await store.get(d.id);
		expect(back?.title).toBe('Saved searches, again');
		expect(back?.images.map((i) => i.name)).toEqual([name]);
		expect(await store.readImage(d.id, name)).not.toBeNull();
	});

	it('marks a draft sent without touching later edits, and edits never change when it was sent', async () => {
		const d = await store.create(new Date('2026-10-26T08:00:00Z'));
		await store.save(d.id, { ...d, title: 'Newer' }, new Date('2026-10-26T09:00:00Z'));
		const sent = await store.markSent(d.id, new Date('2026-10-26T09:30:00Z'));
		expect(sent?.title).toBe('Newer');
		expect(sent?.sentAt).toBe('2026-10-26T09:30:00.000Z');
		const edited = await store.save(d.id, { ...d, title: 'Newest', sentAt: null });
		expect(edited?.sentAt).toBe('2026-10-26T09:30:00.000Z');
		expect(await store.markSent('spec-missing1')).toBeNull();
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

	it('keeps comments and the interview when the captain saves edits', async () => {
		const d = await store.create();
		await store.addAnswer(d.id, 'Shared albums');
		const commented = await store.addComment(d.id, {
			section: 'scope',
			quote: 'Sharing',
			text: 'Why not now?'
		});
		expect(commented?.comments).toHaveLength(1);
		const saved = await store.save(d.id, {
			...d,
			title: 'Albums',
			mode: 'form',
			comments: [],
			edited: ['title', 'mode']
		});
		expect(saved?.mode).toBe('form');
		expect(saved?.comments).toHaveLength(1);
		expect(saved?.interview.turns.map((t) => t.text)).toEqual(['Shared albums']);
	});

	it('keeps the spec a turn wrote over an edit made on a copy from before it', async () => {
		const d = await store.create();
		await store.addAnswer(d.id, 'Shared albums');
		await store.applyAgent(
			d.id,
			{
				message: 'Who adds photos?',
				spec: { title: 'Shared albums', summary: 'One album per trip.' },
				options: [],
				recommended: null,
				resolved: [],
				done: false
			},
			{ inputTokens: 0, outputTokens: 0, costUsd: 0 }
		);
		const saved = await store.save(d.id, {
			...d,
			project: 'photo-library',
			title: 'Trip albums',
			mode: 'form',
			summary: '',
			edited: ['project', 'title', 'mode']
		});
		expect(saved).toMatchObject({
			project: 'photo-library',
			title: 'Trip albums',
			mode: 'form',
			summary: 'One album per trip.'
		});
		expect(saved?.interview.turns.map((t) => t.text)).toEqual([
			'Shared albums',
			'Who adds photos?'
		]);
		expect(await store.get(d.id)).toEqual(saved);
		const current = (await store.get(d.id))!;
		expect((await store.save(d.id, { ...current, summary: 'Edited' }))?.summary).toBe('Edited');
	});

	it('keeps the title and project a turn wrote when a stale edit only changed the mode', async () => {
		const d = await store.create();
		await store.addAnswer(d.id, 'Shared albums for trips');
		await store.applyAgent(
			d.id,
			{
				message: 'Who adds photos?',
				spec: { title: 'Shared albums', project: 'photo-library' },
				options: [],
				recommended: null,
				resolved: [],
				done: false
			},
			{ inputTokens: 0, outputTokens: 0, costUsd: 0 }
		);
		const saved = await store.save(d.id, { ...d, mode: 'form', edited: ['mode'] });
		expect(saved).toMatchObject({ title: 'Shared albums', project: 'photo-library', mode: 'form' });
	});

	it('makes room for a comment by dropping the oldest resolved ones, and refuses past 100 open', async () => {
		const d = await store.create();
		const add = (text: string) => store.addComment(d.id, { section: 'scope', quote: '', text });
		for (let i = 0; i < 100; i++) await add(`Comment ${i}`);
		expect(await add('One too many')).toBeNull();
		const full = (await store.get(d.id))!;
		await store.applyAgent(
			d.id,
			{
				message: 'Done',
				spec: {},
				options: [],
				recommended: null,
				resolved: full.comments.slice(0, 2).map((c) => ({ id: c.id, reply: 'Done' })),
				done: false
			},
			{ inputTokens: 0, outputTokens: 0, costUsd: 0 }
		);
		const after = (await add('Room now'))!;
		expect(after.comments).toHaveLength(100);
		expect(after.comments[0].text).toBe('Comment 1');
		expect(after.comments.at(-1)?.text).toBe('Room now');
	});

	it('takes comments only on a known section, and takes them back', async () => {
		const d = await store.create();
		expect(await store.addComment(d.id, { section: 'nowhere', quote: '', text: 'x' })).toBeNull();
		expect(await store.addComment(d.id, { section: 'scope', quote: '', text: '  ' })).toBeNull();
		const c = (await store.addComment(d.id, { section: 'scope', quote: 7, text: 'Hm' }))!
			.comments[0];
		expect(c).toMatchObject({ section: 'scope', quote: '', text: 'Hm', resolvedAt: null });
		expect((await store.removeComment(d.id, c.id))?.comments).toEqual([]);
		expect(await store.removeComment(d.id, c.id)).toBeNull();
		expect(await store.removeComment(d.id, '../x')).toBeNull();
	});

	it('writes a long spec beside the draft as a file', async () => {
		const d = await store.create();
		const file = await store.writeAttachment(d.id, '# Long spec\n');
		expect(file).toBe(path.join(store.imageDir(d.id), 'spec.md'));
		expect(await readFile(file!, 'utf8')).toBe('# Long spec\n');
		expect(await store.writeAttachment('spec-missing1', 'x')).toBeNull();
	});
});
