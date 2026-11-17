import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { RECORDER_PATH, closeRecordedPreviews } from '$lib/server/livereview/proxy';

// The task a review is about, as reviewContext finds it: for a remote second mate's task, the
// preview through Wheelhouse's forward of its port (MateTasks.helperContext), set by each test.
const found = vi.hoisted(() => ({ url: '' }));
vi.mock('$lib/server/livereview/scribe', () => ({
	reviewContext: async (id: string) => ({
		ok: true,
		ctx: { task: { id, title: 'Share links', project: 'lumen' }, url: found.url, brief: null }
	})
}));

const { GET } = await import('./+server');

/** A remote second mate's dev server, as its forward on this computer answers. */
let forward: http.Server;
beforeAll(async () => {
	forward = http.createServer((req, res) => {
		res.writeHead(200, { 'content-type': 'text/html' });
		res.end(
			`<!doctype html><html><head><title>Share</title></head><body>Remote ${req.url}</body></html>`
		);
	});
	await new Promise<void>((r) => forward.listen(0, '127.0.0.1', r));
	found.url = `http://127.0.0.1:${(forward.address() as AddressInfo).port}/share`;
});
afterAll(async () => {
	await closeRecordedPreviews();
	await new Promise((r) => forward.close(r));
});

/** Where the route sends the browser (SvelteKit's redirect is thrown). */
async function opened(id: string): Promise<string> {
	const url = new URL(`http://127.0.0.1:4310/tasks/${encodeURIComponent(id)}/live?back=%2F`);
	try {
		await GET({
			params: { id },
			url,
			request: new Request(url, { headers: { host: '127.0.0.1:4310' } })
		} as unknown as Parameters<typeof GET>[0]);
	} catch (e) {
		const r = e as { status?: number; location?: string };
		if (r.status === 303 && r.location) return r.location;
		throw e;
	}
	throw new Error('The route did not redirect.');
}

describe('/tasks/<id>/live', () => {
	it('opens a remote second mate’s preview through its forward, with the review tool added', async () => {
		const to = await opened('tk-1@tokyo');
		// The recorded copy, on a loopback port of its own, of the forwarded page (never the
		// address the preview has on the second mate's host).
		expect(to).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/share$/);
		expect(new URL(to).port).not.toBe(new URL(found.url).port);
		const html = await (await fetch(to)).text();
		expect(html).toContain('Remote /share');
		expect(html).toContain(`<script src="${RECORDER_PATH}"`);
		const recorder = await (await fetch(new URL(RECORDER_PATH, to))).text();
		expect(recorder).toContain('"task":"tk-1@tokyo"');
		expect(recorder).toContain("const PARENT = 'http://127.0.0.1:4310'");
	});
});
