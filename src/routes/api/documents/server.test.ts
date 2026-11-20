import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { RequestEvent } from '@sveltejs/kit';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { FleetView } from '$lib/types';
import { DocumentsService } from '$lib/server/documents/service';

const rt = vi.hoisted(() => ({ documents: null as unknown, configured: true }));
vi.mock('$lib/server/runtime', () => ({
	getRuntime: async () =>
		rt.configured
			? { configured: true, documents: rt.documents }
			: { configured: false, error: 'Firstmate is not set up.' }
}));

const index = await import('./+server');
const briefing = await import('./briefing/+server');
const promote = await import('../library/promote/+server');
const short = await import('../../r/[task]/+server');
const files = await import('../../records/[project]/[task]/files/[...path]/+server');

let tmp: string;

beforeAll(async () => {
	tmp = await realpath(await mkdtemp(path.join(os.tmpdir(), 'wh-docroutes-')));
	const task = path.join(tmp, 'data', 'wh-pal');
	await mkdir(path.join(tmp, 'state'), { recursive: true });
	await mkdir(task, { recursive: true });
	await writeFile(
		path.join(tmp, 'data', 'done-archive.md'),
		'- [x] wh-pal - Palette (repo: wheelhouse) (kind: scout) (reported 2026-11-10)\n'
	);
	await writeFile(path.join(task, 'report.md'), '# Command palette\n\n[poster](poster.html)\n');
	await writeFile(path.join(task, 'poster.html'), '<script>alert(1)</script>');
	await writeFile(path.join(task, 'secret.txt'), 'not linked');
	rt.documents = new DocumentsService({
		home: tmp,
		library: null,
		libraryProblem: 'The state directory is inside the home.',
		fleet: () => ({ tasks: [], secondMates: [] }) as unknown as FleetView,
		answers: async () => false
	});
});
afterAll(() => rm(tmp, { recursive: true, force: true }));

const event = (url: string, init?: RequestInit, params: Record<string, string> = {}) =>
	({
		url: new URL(url, 'http://127.0.0.1:4310'),
		request: new Request(new URL(url, 'http://127.0.0.1:4310'), init),
		params
	}) as unknown as RequestEvent;
const post = (body: unknown) => ({
	method: 'POST',
	headers: { 'content-type': 'application/json' },
	body: JSON.stringify(body)
});

describe('GET /api/documents', () => {
	it('lists the records by title, read only', async () => {
		const res = await index.GET(event('/api/documents') as never);
		expect(res.status).toBe(200);
		expect(res.headers.get('cache-control')).toBe('no-store');
		const body = await res.json();
		expect(body.records.map((r: { key: string; title: string }) => [r.key, r.title])).toEqual([
			['wheelhouse/wh-pal', 'Command palette']
		]);
		expect(body.libraryProblem).toBe('The state directory is inside the home.');
	});

	it('says why when Firstmate is not set up', async () => {
		rt.configured = false;
		const res = await index.GET(event('/api/documents') as never);
		rt.configured = true;
		expect(res.status).toBe(503);
	});
});

describe('GET /r/<task>', () => {
	it('redirects a task id to its record, and 404s one with none', async () => {
		await expect(
			short.GET(event('/r/wh-pal', undefined, { task: 'wh-pal' }) as never)
		).rejects.toMatchObject({
			status: 307,
			location: '/records/wheelhouse/wh-pal'
		});
		await expect(
			short.GET(event('/r/nope', undefined, { task: 'nope' }) as never)
		).rejects.toMatchObject({
			status: 404
		});
	});
});

describe('GET /records/<project>/<task>/files/<path>', () => {
	const get = (p: string) =>
		files.GET(
			event(`/records/wheelhouse/wh-pal/files/${p}`, undefined, {
				project: 'wheelhouse',
				task: 'wh-pal',
				path: p
			}) as never
		);

	it('serves a linked HTML page sandboxed, with scripts off and nothing sniffed', async () => {
		const res = await get('poster.html');
		expect(res.status).toBe(200);
		expect(res.headers.get('content-type')).toBe('text/html; charset=utf-8');
		expect(res.headers.get('x-content-type-options')).toBe('nosniff');
		const csp = res.headers.get('content-security-policy') ?? '';
		expect(csp).toContain('sandbox');
		expect(csp).not.toContain('allow-scripts');
		expect(csp).toContain("default-src 'none'");
	});

	it('serves nothing the report does not link', async () => {
		await expect(get('secret.txt')).rejects.toMatchObject({ status: 404 });
		await expect(get('../../done-archive.md')).rejects.toMatchObject({ status: 404 });
	});
});

describe('POST /api/library/promote', () => {
	it('refuses without a library, and refuses what is not JSON', async () => {
		const res = await promote.POST(
			event('/api/library/promote', post({ record: 'wheelhouse/wh-pal' })) as never
		);
		expect(res.status).toBe(500);
		expect((await res.json()).message).toBe('The state directory is inside the home.');
		const bad = await promote.POST(
			event('/api/library/promote', {
				method: 'POST',
				headers: { 'content-type': 'text/plain' },
				body: 'x'
			}) as never
		);
		expect(bad.status).toBe(415);
	});
});

describe('POST /api/documents/briefing', () => {
	it('builds the words for the crew, attaching and listing what it can read', async () => {
		const res = await briefing.POST(
			event(
				'/api/documents/briefing',
				post({ full: ['wheelhouse/wh-pal', 7], titles: ['nope/nope'] })
			) as never
		);
		const body = await res.json();
		expect(body.attached).toEqual(['Command palette']);
		expect(body.listed).toEqual([]);
		expect(body.text).toContain('# Command palette');
	});
});
