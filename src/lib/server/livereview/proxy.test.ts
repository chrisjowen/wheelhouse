import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
	RECORDER_PATH,
	SHOOTER_PATH,
	closeRecordedPreviews,
	injectRecorder,
	recordedPreview,
	recorderFor
} from './proxy';

describe('recorderFor', () => {
	it('fills in the Wheelhouse origin and the task, safe inside a script', () => {
		const js = recorderFor('http://127.0.0.1:4310', {
			task: 'lumen-signup',
			title: 'Sign-up </script><script>alert(1)</script> $& flow',
			preview: 'http://127.0.0.1:5173/',
			back: '/'
		});
		expect(js).toContain("const PARENT = 'http://127.0.0.1:4310'");
		const review = /const REVIEW = (.*);/.exec(js)?.[1];
		expect(review).not.toContain('</script>');
		expect(JSON.parse(review!)).toMatchObject({
			task: 'lumen-signup',
			title: 'Sign-up </script><script>alert(1)</script> $& flow'
		});
		// Without a review, the recorder stays out of the way.
		expect(recorderFor('http://127.0.0.1:4310', null)).toContain('const REVIEW = null;');
	});
});

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

describe('a review session and the project', () => {
	let dir = '';
	let server: http.Server;
	let base = '';
	const files = {
		'index.html': '<!doctype html><html><head><title>Shop</title></head><body>Shop</body></html>',
		'app.js': 'console.log("shop")',
		'about/index.html': '<html><head></head><body>About</body></html>'
	};

	/** Every file under the project, with what it holds and when it last changed. */
	async function snapshot(root: string): Promise<Record<string, string>> {
		const out: Record<string, string> = {};
		for (const name of await readdir(root, { recursive: true })) {
			const file = path.join(root, name);
			const st = await stat(file);
			if (st.isFile()) out[name] = `${st.mtimeMs} ${await readFile(file, 'utf8')}`;
		}
		return out;
	}

	beforeAll(async () => {
		dir = await mkdtemp(path.join(tmpdir(), 'wh-review-project-'));
		for (const [name, body] of Object.entries(files)) {
			await mkdir(path.join(dir, path.dirname(name)), { recursive: true });
			await writeFile(path.join(dir, name), body);
		}
		// The project's own server, serving its files as they are on disk.
		server = http.createServer(async (req, res) => {
			const rel = (req.url ?? '/').split('?')[0].replace(/\/$/, '/index.html').slice(1);
			try {
				const body = await readFile(path.join(dir, rel));
				res.writeHead(200, {
					'content-type': rel.endsWith('.html') ? 'text/html' : 'text/javascript'
				});
				res.end(body);
			} catch {
				res.writeHead(404).end();
			}
		});
		await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
		base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
	});

	afterAll(async () => {
		await closeRecordedPreviews();
		await new Promise((r) => server.close(r));
		await rm(dir, { recursive: true, force: true });
	});

	it('adds the review only to the pages it serves, never to the project’s files', async () => {
		const before = await snapshot(dir);
		const r = await recordedPreview(`${base}/`, 'http://127.0.0.1:4310', {
			task: 'shop-task',
			title: 'Shop',
			preview: `${base}/`,
			back: '/'
		});
		if (!r.ok) throw new Error(r.error);
		const origin = new URL(r.url).origin;
		// A whole session's worth of traffic: pages, scripts, the recorder and its screenshots.
		for (const p of ['/', '/about/', '/app.js', RECORDER_PATH, SHOOTER_PATH, '/missing'])
			await (await fetch(origin + p)).text();
		const page = await (await fetch(`${origin}/`)).text();
		expect(page).toContain(RECORDER_PATH);
		expect(await snapshot(dir)).toEqual(before);
		expect(await readFile(path.join(dir, 'index.html'), 'utf8')).not.toContain(RECORDER_PATH);
	});

	it('keeps one proxy per task, whose way back follows the latest open', async () => {
		const open = (back: string) =>
			recordedPreview(`${base}/`, 'http://127.0.0.1:4310', {
				task: 'shop-task',
				title: 'Shop',
				preview: `${base}/`,
				back
			});
		const a = await open('/');
		const b = await open('/tasks/shop-task');
		if (!a.ok || !b.ok) throw new Error('not opened');
		expect(new URL(b.url).origin).toBe(new URL(a.url).origin);
		const js = await (await fetch(new URL(b.url).origin + RECORDER_PATH)).text();
		expect(js).toContain('"back":"/tasks/shop-task"');
		const other = await recordedPreview(`${base}/`, 'http://127.0.0.1:4310', {
			task: 'other-task',
			title: 'Other',
			preview: `${base}/`,
			back: '/'
		});
		expect(other.ok && new URL(other.url).origin).not.toBe(new URL(a.url).origin);
	});
});
