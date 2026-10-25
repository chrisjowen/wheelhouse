import { describe, expect, it } from 'vitest';
import { feedbackNote, frameRefusal, frameSandbox, loopbackPreview, NOT_LOOPBACK } from './preview';

describe('loopbackPreview', () => {
	it('accepts http(s) previews on 127.0.0.1 and localhost', () => {
		expect(loopbackPreview('http://127.0.0.1:4397/')).toEqual({
			ok: true,
			url: 'http://127.0.0.1:4397/'
		});
		expect(loopbackPreview('https://localhost:5173/app?x=1')).toEqual({
			ok: true,
			url: 'https://localhost:5173/app?x=1'
		});
		expect(loopbackPreview('http://LOCALHOST:3000').ok).toBe(true);
	});

	it('refuses anything not on this machine', () => {
		for (const u of [
			'http://example.com/',
			'http://192.168.1.4:3000/',
			'http://127.0.0.1.nip.io/',
			'http://localhost.evil.test/',
			'http://[::1]:3000/',
			'http://0.0.0.0:3000/'
		]) {
			expect(loopbackPreview(u)).toEqual({ ok: false, reason: NOT_LOOPBACK });
		}
	});

	it('refuses other schemes, credentials and junk', () => {
		expect(loopbackPreview('file:///etc/passwd').ok).toBe(false);
		expect(loopbackPreview('javascript:alert(1)').ok).toBe(false);
		expect(loopbackPreview('http://user:pw@127.0.0.1:3000/').ok).toBe(false);
		expect(loopbackPreview('not a url').ok).toBe(false);
	});
});

describe('frameSandbox', () => {
	it('lets another origin keep its own storage', () => {
		expect(frameSandbox('http://127.0.0.1:4397/', 'http://127.0.0.1:4396')).toContain(
			'allow-same-origin'
		);
	});

	it('never grants scripts plus same-origin to the page’s own origin', () => {
		const s = frameSandbox('http://127.0.0.1:4396/x', 'http://127.0.0.1:4396');
		expect(s).toContain('allow-scripts');
		expect(s).not.toContain('allow-same-origin');
	});

	it('never lets the preview navigate Wheelhouse itself', () => {
		expect(frameSandbox('http://127.0.0.1:1/', 'http://127.0.0.1:2')).not.toContain('top');
	});
});

describe('frameRefusal', () => {
	const h = (o: Record<string, string>) => new Headers(o);
	const preview = 'http://127.0.0.1:5173/';
	const page = 'http://localhost:4396';
	const fa = (v: string, origin = page) =>
		frameRefusal(h({ 'content-security-policy': `frame-ancestors ${v}` }), preview, origin);
	it('allows a page with no framing headers', () => {
		expect(frameRefusal(h({}), preview, page)).toBeNull();
		expect(
			frameRefusal(h({ 'content-security-policy': "default-src 'self'" }), preview, page)
		).toBeNull();
	});
	it('notices X-Frame-Options', () => {
		expect(frameRefusal(h({ 'x-frame-options': 'DENY' }), preview, page)).toMatch(
			/X-Frame-Options: DENY/
		);
		expect(frameRefusal(h({ 'x-frame-options': 'SAMEORIGIN' }), preview, page)).toMatch(/refuses/);
	});
	it('refuses none, and self from another origin', () => {
		expect(fa("'none'")).toMatch(/'none'/);
		expect(
			frameRefusal(
				h({ 'content-security-policy': "default-src 'self'; frame-ancestors 'self'" }),
				preview,
				page
			)
		).toMatch(/refuses/);
		expect(fa("'self'", 'http://127.0.0.1:5173')).toBeNull();
	});
	it('allows * and a matching scheme source', () => {
		expect(fa('*')).toBeNull();
		expect(fa('http:')).toBeNull();
		expect(fa('https:')).toMatch(/refuses/);
	});
	it('matches host sources against the page origin, not any loopback name', () => {
		expect(fa('http://127.0.0.1:*')).toMatch(/refuses/);
		expect(fa('http://127.0.0.1:*', 'http://127.0.0.1:4396')).toBeNull();
		expect(fa('http://localhost:*')).toBeNull();
		expect(fa('localhost:4396')).toBeNull();
		expect(fa('http://localhost:4396/')).toBeNull();
		expect(fa('http://localhost:5000')).toMatch(/refuses/);
		expect(fa('http://localhost')).toMatch(/refuses/);
		expect(fa('http://localhost', 'http://localhost')).toBeNull();
		expect(fa('https://localhost:4396')).toMatch(/refuses/);
		expect(fa('http://localhost.evil.test:*')).toMatch(/refuses/);
		expect(fa('http://localhost:*', 'http://localhost.evil.test:4396')).toMatch(/refuses/);
		expect(fa("'self' http://localhost:4396")).toBeNull();
	});
	it('matches wildcard hosts by subdomain', () => {
		expect(fa('http://*.test:*', 'http://wh.test:4396')).toBeNull();
		expect(fa('http://*.test:*')).toMatch(/refuses/);
	});
	it('lets an https page through an http source', () => {
		expect(fa('http://localhost:*', 'https://localhost:4396')).toBeNull();
	});
});

describe('feedbackNote', () => {
	it('says which preview the feedback is about', () => {
		expect(feedbackNote('http://127.0.0.1:4397/', '  The button is too small. ')).toBe(
			'Review feedback on the live preview (http://127.0.0.1:4397/):\nThe button is too small.'
		);
	});
});
