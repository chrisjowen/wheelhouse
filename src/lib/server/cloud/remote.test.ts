import { describe, expect, it } from 'vitest';
import { framingOrigin, relayResponse, remoteView, viaRelay } from './remote';

const PREVIEW = 'https://abcdefghijklmnopqrst-p{port}.cloud.test';
const ORIGIN = 'https://abcdefghijklmnopqrst.cloud.test';

/** A request as the connector hands it to Wheelhouse, or as a browser here sends it. */
function request(headers: Record<string, string>): Request {
	return new Request('http://127.0.0.1:4310/', { headers });
}

const relayed = (extra: Record<string, string> = {}) =>
	request({
		host: 'localhost:4310',
		'x-wheelhouse-remote': '1',
		'x-wheelhouse-remote-origin': ORIGIN,
		'x-wheelhouse-remote-preview': PREVIEW,
		...extra
	});

describe('a page that came through Wheelhouse Cloud', () => {
	it('is told apart from one served here, and opens previews on the relay', () => {
		expect(viaRelay(relayed())).toBe(true);
		expect(remoteView(relayed())).toEqual({ preview: PREVIEW, appPort: 4310 });
		const local = request({ host: '127.0.0.1:4310' });
		expect(viaRelay(local)).toBe(false);
		expect(remoteView(local)).toBeNull();
	});

	it('has no remote view without a preview template the relay could serve', () => {
		expect(remoteView(relayed({ 'x-wheelhouse-remote-preview': 'https://cloud.test' }))).toBeNull();
		expect(remoteView(relayed({ host: 'localhost' }))).toBeNull();
	});

	it('is framed at the relay’s origin, so a preview is checked against where it is really shown', () => {
		expect(framingOrigin(relayed())).toBe(ORIGIN);
		expect(framingOrigin(request({ host: '127.0.0.1:4310' }))).toBe('http://127.0.0.1:4310');
		// No usable relay origin: the server's own.
		expect(framingOrigin(relayed({ 'x-wheelhouse-remote-origin': 'javascript:alert(1)' }))).toBe(
			'http://localhost:4310'
		);
	});
});

describe('a redirect to a page that came through Wheelhouse Cloud', () => {
	const redirect = (location: string) => new Response(null, { status: 303, headers: { location } });

	it('sends an address on this computer to the relay, never to the phone’s own loopback', () => {
		expect(
			relayResponse(relayed(), redirect('http://127.0.0.1:56637/?x=1#a')).headers.get('location')
		).toBe('https://abcdefghijklmnopqrst-p56637.cloud.test/?x=1#a');
		expect(
			relayResponse(relayed(), redirect('http://[::1]:5173/app')).headers.get('location')
		).toBe('https://abcdefghijklmnopqrst-p5173.cloud.test/app');
		// Wheelhouse itself: the page's own origin on the relay.
		expect(
			relayResponse(relayed(), redirect('http://localhost:4310/tasks/x')).headers.get('location')
		).toBe(`${ORIGIN}/tasks/x`);
	});

	it('copies a response whose headers cannot change', () => {
		const r = relayResponse(relayed(), Response.redirect('http://127.0.0.1:5173/', 302));
		expect(r.status).toBe(302);
		expect(r.headers.get('location')).toBe('https://abcdefghijklmnopqrst-p5173.cloud.test/');
	});

	it('leaves relative and other redirects, and every response to a page served here, alone', () => {
		for (const location of ['/setup', 'https://github.com/o/r/pull/1']) {
			expect(relayResponse(relayed(), redirect(location)).headers.get('location')).toBe(location);
		}
		const local = request({ host: '127.0.0.1:4310' });
		expect(relayResponse(local, redirect('http://127.0.0.1:56637/')).headers.get('location')).toBe(
			'http://127.0.0.1:56637/'
		);
		const page = new Response('ok');
		expect(relayResponse(relayed(), page)).toBe(page);
	});
});
