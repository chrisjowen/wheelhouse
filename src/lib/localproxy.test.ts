import { describe, expect, it } from 'vitest';
import { loopbackPort, proxiedUrl, proxyPort, reportedPorts, settingPorts } from './localproxy';

const viewer = { protocol: 'http:', hostname: 'localhost', port: '4310' };

describe('proxyPort', () => {
	it('reads the target port from a proxied address', () => {
		expect(proxyPort('5173.localhost:4310')).toBe(5173);
		expect(proxyPort('3000.LOCALHOST')).toBe(3000);
		expect(proxyPort('65535.localhost:80')).toBe(65535);
	});

	it('is null for Wheelhouse’s own hosts and anything else', () => {
		for (const host of [
			'localhost:4310',
			'127.0.0.1:4310',
			'5173.localhost.evil.test',
			'evil.test',
			'5173.127.0.0.1',
			'0.localhost',
			'65536.localhost',
			'05173.localhost',
			'a5173.localhost',
			'',
			null,
			undefined
		]) {
			expect(proxyPort(host)).toBeNull();
		}
	});
});

describe('loopbackPort', () => {
	it('finds the port of an http address on this computer', () => {
		expect(loopbackPort('http://localhost:5173/app')).toBe(5173);
		expect(loopbackPort('http://127.0.0.1:4397/')).toBe(4397);
		expect(loopbackPort('http://LOCALHOST/')).toBe(80);
	});

	it('leaves https, other hosts, credentials and junk alone', () => {
		for (const raw of [
			'https://localhost:5173/',
			'http://example.com:5173/',
			'http://192.168.1.4:5173/',
			'http://[::1]:5173/',
			'http://0.0.0.0:5173/',
			'http://localhost.evil.test:5173/',
			'http://user:pw@localhost:5173/',
			'ws://localhost:5173/',
			'not a url'
		]) {
			expect(loopbackPort(raw)).toBeNull();
		}
	});
});

describe('proxiedUrl', () => {
	it('sends an address on this computer through the port the viewer reached Wheelhouse on', () => {
		expect(proxiedUrl('http://localhost:5173/app/page?x=1#top', viewer)).toBe(
			'http://5173.localhost:4310/app/page?x=1#top'
		);
		expect(proxiedUrl('http://127.0.0.1:3000', viewer)).toBe('http://3000.localhost:4310/');
		// Forwarded to another port, or reached by its IP address, it follows the viewer.
		expect(
			proxiedUrl('http://localhost:5173/', {
				protocol: 'http:',
				hostname: '127.0.0.1',
				port: '8080'
			})
		).toBe('http://5173.localhost:8080/');
		expect(
			proxiedUrl('http://localhost:5173/', { protocol: 'https:', hostname: 'localhost', port: '' })
		).toBe('https://5173.localhost/');
	});

	it('leaves Wheelhouse’s own address and anything not on this computer alone', () => {
		for (const raw of [
			'http://localhost:4310/tasks/a',
			'http://127.0.0.1:4310/',
			'https://localhost:5173/',
			'https://github.com/o/r/pull/1',
			'/tasks/a',
			'mailto:a@b.c'
		]) {
			expect(proxiedUrl(raw, viewer)).toBe(raw);
		}
	});

	it('rewrites a redirect from the proxied page’s own port to another app', () => {
		const proxied = { protocol: 'http:', hostname: '5173.localhost', port: '4310' };
		expect(proxiedUrl('http://localhost:5173/next', proxied)).toBe(
			'http://5173.localhost:4310/next'
		);
		expect(proxiedUrl('http://localhost:4310/', proxied)).toBe('http://4310.localhost:4310/');
	});
});

describe('reportedPorts', () => {
	it('finds each port on this computer in plain text once', () => {
		expect(
			reportedPorts(
				'Preview at http://localhost:5173/app. Also http://127.0.0.1:5173 and (http://localhost:8080/x), not https://localhost:9000/ or http://example.com:3000/.'
			)
		).toEqual([5173, 8080]);
		expect(reportedPorts('nothing here')).toEqual([]);
	});
});

describe('settingPorts', () => {
	it('keeps whole port numbers from a list or comma-separated text', () => {
		expect(settingPorts(['3000', ' 8080 ', '3000', 'x', '0', '70000', '-1', '1.5'])).toEqual([
			3000, 8080
		]);
		expect(settingPorts('3000, 8080')).toEqual([3000, 8080]);
		expect(settingPorts(undefined)).toEqual([]);
		expect(settingPorts(42)).toEqual([]);
	});
});
