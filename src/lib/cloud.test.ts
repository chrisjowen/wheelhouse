import { describe, expect, it } from 'vitest';
import { previewTemplate, remoteAddress } from './cloud';

const remote = { preview: 'https://abc234-p{port}.cloud.example.com', appPort: 4310 };
const page = 'https://abc234.cloud.example.com';

describe('previewTemplate', () => {
	it('takes an origin with {port} once in its host', () => {
		expect(previewTemplate(remote.preview)).toBe(remote.preview);
		expect(previewTemplate('http://x-p{port}.localhost:9000')).toBe(
			'http://x-p{port}.localhost:9000'
		);
	});

	it('takes a sealed origin’s preview hosts, p{port}. under the machine’s own name (§12.1)', () => {
		const sealed = 'https://p{port}.abcdefghijklmnopqrs2.m.gateway.example.net';
		expect(previewTemplate(sealed)).toBe(sealed);
		expect(previewTemplate('https://p{port}.abcdefghijklmnopqrs2.m.localhost:8443')).toBe(
			'https://p{port}.abcdefghijklmnopqrs2.m.localhost:8443'
		);
		expect(
			remoteAddress(
				'http://127.0.0.1:5173/app?x=1',
				{ preview: sealed, appPort: 4310 },
				'https://abcdefghijklmnopqrs2.m.gateway.example.net'
			)
		).toBe('https://p5173.abcdefghijklmnopqrs2.m.gateway.example.net/app?x=1');
	});

	it.each([
		null,
		'',
		'https://cloud.example.com',
		'https://a-p{port}.x/{port}',
		'https://a-p{port}.x/path',
		'javascript:{port}',
		'https://u:p@a-p{port}.x',
		'https://a-p{port}{port}.x'
	])('refuses %s', (raw) => expect(previewTemplate(raw)).toBeNull());
});

describe('remoteAddress', () => {
	it('opens a preview on this machine on the relay host for its port', () => {
		expect(remoteAddress('http://localhost:5173/app?x=1#h', remote, page)).toBe(
			'https://abc234-p5173.cloud.example.com/app?x=1#h'
		);
		expect(remoteAddress('http://127.0.0.1:3000/', remote, page)).toBe(
			'https://abc234-p3000.cloud.example.com/'
		);
		expect(remoteAddress('http://5173.localhost:4310/a', remote, page)).toBe(
			'https://abc234-p5173.cloud.example.com/a'
		);
	});

	it('covers every host an address on this machine is written with, over http or https', () => {
		expect(remoteAddress('http://[::1]:8080/a/b?q=1&r=2#frag', remote, page)).toBe(
			'https://abc234-p8080.cloud.example.com/a/b?q=1&r=2#frag'
		);
		expect(remoteAddress('http://0.0.0.0:3000', remote, page)).toBe(
			'https://abc234-p3000.cloud.example.com/'
		);
		expect(remoteAddress('https://LOCALHOST:9443/x', remote, page)).toBe(
			'https://abc234-p9443.cloud.example.com/x'
		);
		expect(remoteAddress('http://localhost/', remote, page)).toBe(
			'https://abc234-p80.cloud.example.com/'
		);
	});

	it('keeps an address on Wheelhouse itself on the page’s own origin', () => {
		expect(remoteAddress('http://127.0.0.1:4310/tasks/x', remote, page)).toBe(`${page}/tasks/x`);
	});

	it('leaves every other address alone', () => {
		for (const raw of [
			'https://github.com/a',
			'mailto:x@y',
			'not a url',
			'http://u:p@localhost:5173/',
			'http://127.0.0.2:5173/',
			'http://example.localhost.com:5173/',
			'ftp://localhost:21/'
		]) {
			expect(remoteAddress(raw, remote, page)).toBe(raw);
		}
	});
});
