import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { RequestEvent } from '@sveltejs/kit';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SpecStore } from '$lib/server/specs/store';

const holder = vi.hoisted(() => ({ store: null as unknown }));
vi.mock('$lib/server/specs/access', () => ({
	specStoreOrResponse: async () => holder.store,
	notFound: () => new Response(null, { status: 404 })
}));

const { POST } = await import('./+server');

let root: string;
let store: SpecStore;
beforeEach(async () => {
	root = await mkdtemp(path.join(tmpdir(), 'wh-build-'));
	store = new SpecStore(path.join(root, 'specs'));
	holder.store = store;
});
afterEach(async () => {
	await rm(root, { recursive: true, force: true });
});

const post = async (id: string) => {
	const res = await POST({ params: { id } } as unknown as Parameters<typeof POST>[0] &
		RequestEvent);
	return { status: res.status, body: res.status === 200 ? await res.json() : null };
};

describe('POST /api/specs/[id]/build-request', () => {
	it('is the whole spec as one build request for the chosen project', async () => {
		const d = await store.create();
		await store.save(d.id, { ...d, project: 'photo-library', title: 'Shared albums' });
		const { body } = await post(d.id);
		expect(body.attachment).toBeNull();
		expect(body.message).toMatch(/^Build request for photo-library: Shared albums\./);
		expect(body.message).toContain('# Shared albums');
	});

	it('attaches a spec too long for one message as a file and points at it', async () => {
		const d = await store.create();
		await store.save(d.id, {
			...d,
			project: 'photo-library',
			title: 'Shared albums',
			summary: 'One album per trip.',
			requirements: Array.from({ length: 60 }, (_, i) => `Requirement ${i} ${'x'.repeat(300)}`)
		});
		const { body } = await post(d.id);
		expect(body.attachment).toBe(path.join(store.imageDir(d.id), 'spec.md'));
		expect(Buffer.byteLength(body.message)).toBeLessThan(16 * 1024);
		expect(body.message).toContain('One album per trip.');
		expect(body.message).toContain(`attached as a file: <${body.attachment}>`);
		const file = await readFile(body.attachment, 'utf8');
		expect(file).toContain('Requirement 59');
	});

	it('is not found for a spec that does not exist', async () => {
		expect((await post('spec-missing1')).status).toBe(404);
	});
});
