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

	it('keeps an address on Wheelhouse itself on the page’s own origin', () => {
		expect(remoteAddress('http://127.0.0.1:4310/tasks/x', remote, page)).toBe(`${page}/tasks/x`);
	});

	it('leaves every other address alone', () => {
		for (const raw of [
			'https://github.com/a',
			'mailto:x@y',
			'not a url',
			'http://u:p@localhost:5173/'
		]) {
			expect(remoteAddress(raw, remote, page)).toBe(raw);
		}
	});
});
