import http from 'node:http';
import type { AddressInfo } from 'node:net';
import zlib from 'node:zlib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
	RECORDER_PATH,
	SHOOTER_PATH,
	closeRecordedPreviews,
	injectRecorder,
	recordedPreview
} from './proxy';

describe('injectRecorder', () => {
	it('adds the recorder first thing in the head, or at the top', () => {
		const tag = `<script src="${RECORDER_PATH}" data-wheelhouse-live-review></script>`;
		expect(injectRecorder('<html><head lang="en"><title>x</title></head></html>')).toBe(
			`<html><head lang="en">${tag}<title>x</title></head></html>`
		);
		expect(injectRecorder('<!doctype html><p>hi')).toBe(`<!doctype html>${tag}<p>hi`);
		expect(injectRecorder('<p>hi')).toBe(`${tag}<p>hi`);
		// A <header> is not the head.
		expect(injectRecorder('<header>x</header>')).toBe(`${tag}<header>x</header>`);
	});
});

describe('recordedPreview', () => {
	let upstream: http.Server;
	let base = '';

	beforeAll(async () => {
		upstream = http.createServer((req, res) => {
			if (req.url === '/gz') {
				res.writeHead(200, { 'content-type': 'text/html', 'content-encoding': 'gzip' });
				return res.end(zlib.gzipSync('<html><head></head><body>zipped</body></html>'));
			}
			if (req.url === '/away') {
				res.writeHead(302, { location: `${base}/settings` });
				return res.end();
			}
			if (req.url === '/app.js') {
				res.writeHead(200, { 'content-type': 'text/javascript' });
				return res.end('console.log(1)');
			}
			res.writeHead(200, {
				'content-type': 'text/html; charset=utf-8',
				'content-security-policy': "frame-ancestors 'none'",
				'x-frame-options': 'DENY'
			});
			res.end('<!doctype html><html><head><title>App</title></head><body>hi</body></html>');
		});
		await new Promise<void>((r) => upstream.listen(0, '127.0.0.1', r));
		base = `http://127.0.0.1:${(upstream.address() as AddressInfo).port}`;
	});

	afterAll(async () => {
		await closeRecordedPreviews();
		await new Promise((r) => upstream.close(r));
	});

	it('serves the preview from a port of its own, with the recorder and no framing refusal', async () => {
		const r = await recordedPreview(`${base}/home?x=1`, 'http://127.0.0.1:4310');
		expect(r.ok).toBe(true);
		if (!r.ok) return;
		expect(r.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/home\?x=1$/);
		const page = await fetch(r.url);
		expect(page.headers.get('x-frame-options')).toBeNull();
		expect(page.headers.get('content-security-policy')).toBeNull();
		expect(await page.text()).toContain(`<head><script src="${RECORDER_PATH}"`);
		// The same proxy for the same preview and page.
		const again = await recordedPreview(`${base}/other`, 'http://127.0.0.1:4310');
		expect(again.ok && new URL(again.url).origin).toBe(new URL(r.url).origin);
	});

	it('serves the recorder for the page that asked, and the screenshot script', async () => {
		const r = await recordedPreview(`${base}/`, 'http://localhost:4310');
		if (!r.ok) throw new Error(r.error);
		const origin = new URL(r.url).origin;
		const recorder = await (await fetch(origin + RECORDER_PATH)).text();
		expect(recorder).toContain("const PARENT = 'http://localhost:4310'");
		expect(recorder).not.toContain('__WHEELHOUSE_ORIGIN__');
		// The trouble watcher it shares with Soundings' beacon is inside, and the whole still parses.
		expect(recorder).toContain('function watchTrouble(report, skip)');
		expect(recorder).not.toContain('export function');
		expect(() => new Function(recorder)).not.toThrow();
		expect((await fetch(origin + SHOOTER_PATH)).ok).toBe(true);
	});

	it('unzips a page to add the recorder, passes other files through and keeps redirects on itself', async () => {
		const r = await recordedPreview(`${base}/`, 'http://127.0.0.1:4310');
		if (!r.ok) throw new Error(r.error);
		const origin = new URL(r.url).origin;
		const zipped = await fetch(`${origin}/gz`);
		expect(await zipped.text()).toContain(`${RECORDER_PATH}"`);
		expect(await (await fetch(`${origin}/app.js`)).text()).toBe('console.log(1)');
		const away = await fetch(`${origin}/away`, { redirect: 'manual' });
		expect(away.headers.get('location')).toBe(`${origin}/settings`);
	});

	it('refuses previews on other machines, and pages not opened on this one', async () => {
		expect(await recordedPreview('http://example.com/', 'http://127.0.0.1:4310')).toMatchObject({
			ok: false
		});
		expect(await recordedPreview(`${base}/`, 'http://wheelhouse.example.com')).toEqual({
			ok: false,
			error: 'Live review works only when Wheelhouse is opened on this computer.'
		});
	});
});
