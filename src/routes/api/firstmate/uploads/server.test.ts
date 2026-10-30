import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { RequestEvent } from '@sveltejs/kit';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { NAME_HEADER, TYPE_HEADER, UPLOAD_MAX_BYTES } from '$lib/chat/attachments';
import { SESSION_HEADER, sessionToken } from '$lib/server/session';
import { handle } from '../../../../hooks.server';
import { POST } from './+server';
import { GET } from './[day]/[id]/[name]/+server';

/** The chat's upload route and the thumbnail route, against a temporary state directory. */

const PNG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82]);
const URL_ = 'http://127.0.0.1:4310/api/firstmate/uploads';

let saved: string | undefined;
beforeEach(() => {
	saved = process.env.WHEELHOUSE_STATE_DIR;
	process.env.WHEELHOUSE_STATE_DIR = mkdtempSync(path.join(tmpdir(), 'wh-upload-route-'));
});
afterEach(() => {
	if (saved === undefined) delete process.env.WHEELHOUSE_STATE_DIR;
	else process.env.WHEELHOUSE_STATE_DIR = saved;
});

function upload(bytes: BodyInit, headers: Record<string, string>): Promise<Response> {
	const request = new Request(URL_, { method: 'POST', body: bytes, headers });
	return POST({ request } as unknown as Parameters<typeof POST>[0]) as Promise<Response>;
}

function thumb(day: string, id: string, name: string): Promise<Response> {
	return (
		GET({ params: { day, id, name } } as unknown as Parameters<typeof GET>[0]) as Promise<Response>
	).catch((e: { status?: number }) => new Response(null, { status: e.status ?? 500 }));
}

describe('POST /api/firstmate/uploads', () => {
	it('saves the file in the state directory and answers the line’s parts', async () => {
		const res = await upload(PNG, {
			[TYPE_HEADER]: 'image/png',
			[NAME_HEADER]: encodeURIComponent('Screen shot — 1.png')
		});
		expect(res.status).toBe(201);
		const a = await res.json();
		expect(a).toMatchObject({ name: 'Screen shot — 1.png', size: PNG.length, type: 'image/png' });
		expect(a.path.startsWith(path.join(process.env.WHEELHOUSE_STATE_DIR!, 'uploads') + '/')).toBe(
			true
		);
		expect(readFileSync(a.path)).toEqual(PNG);
	});

	it('refuses a file declared larger than the limit before reading it', async () => {
		const res = await upload('x', { 'content-length': String(UPLOAD_MAX_BYTES + 1) });
		expect(res.status).toBe(413);
		expect((await res.json()).message).toMatch(/over 25 MB/);
	});

	it('refuses a malformed name', async () => {
		const res = await upload('x', { [NAME_HEADER]: '%E0%A4%A' });
		expect(res.status).toBe(400);
	});

	it('serves an uploaded image back as its thumbnail, as an image only', async () => {
		const a = await (
			await upload(PNG, { [TYPE_HEADER]: 'text/html', [NAME_HEADER]: 'shot.png' })
		).json();
		const [day, id, name] = a.path.split('/').slice(-3);
		const res = await thumb(day, id, name);
		expect(res.status).toBe(200);
		expect(res.headers.get('content-type')).toBe('image/png');
		expect(res.headers.get('x-content-type-options')).toBe('nosniff');
		expect(res.headers.get('content-security-policy')).toContain('sandbox');
		expect(Buffer.from(await res.arrayBuffer())).toEqual(PNG);
	});

	it('never serves an upload that is not an image, such as HTML or SVG', async () => {
		for (const [body, name] of [
			['<script>alert(1)</script>', 'page.html'],
			['<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>', 'pic.svg']
		]) {
			const a = await (
				await upload(body, { [TYPE_HEADER]: 'image/png', [NAME_HEADER]: name })
			).json();
			const [day, id, n] = a.path.split('/').slice(-3);
			expect((await thumb(day, id, n)).status).toBe(404);
		}
	});
});

describe('the upload route’s guard (hooks.server.ts)', () => {
	async function through(headers: Record<string, string>, host = '127.0.0.1:4310') {
		const url = new URL(URL_);
		const event = {
			request: new Request(url, { method: 'POST', headers: { host, ...headers }, body: 'x' }),
			url
		} as unknown as RequestEvent;
		return handle({ event, resolve: async () => new Response('saved', { status: 201 }) });
	}
	const origin = 'http://127.0.0.1:4310';

	it('takes an upload from this page with this launch’s token', async () => {
		expect((await through({ origin, [SESSION_HEADER]: sessionToken() })).status).toBe(201);
	});

	it('refuses one without the token, from another site, or to another Host', async () => {
		expect((await through({ origin })).status).toBe(403);
		expect((await through({ origin, [SESSION_HEADER]: 'nope' })).status).toBe(403);
		expect(
			(await through({ origin: 'http://evil.example', [SESSION_HEADER]: sessionToken() })).status
		).toBe(403);
		expect(
			(await through({ origin, [SESSION_HEADER]: sessionToken() }, 'evil.example')).status
		).toBe(421);
	});
});
