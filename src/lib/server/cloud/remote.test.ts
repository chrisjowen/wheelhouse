import { describe, expect, it } from 'vitest';
import { framingOrigin, remoteView, viaRelay } from './remote';

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
