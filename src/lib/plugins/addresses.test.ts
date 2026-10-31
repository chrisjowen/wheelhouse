import { describe, expect, it } from 'vitest';
import {
	localhostName,
	loopbackAddresses,
	loopbackPort,
	matchHost,
	rewriteAddress,
	validHostTemplate
} from './addresses';

const viewer = { protocol: 'http:', hostname: 'localhost', port: '4310' };

describe('host templates', () => {
	it('are *.localhost names with {port} once in the first label', () => {
		for (const t of ['{port}.localhost', 'p{port}.localhost', '{port}-app.proxy.localhost']) {
			expect(validHostTemplate(t), t).toBe(true);
		}
		for (const t of [
			'localhost',
			'{port}',
			'{port}.example.com',
			'{port}.localhost.evil.test',
			'app.{port}.localhost',
			'{port}{port}.localhost',
			'{PORT}.localhost',
			'*.localhost',
			'{port}..localhost',
			42,
			null
		]) {
			expect(validHostTemplate(t), String(t)).toBe(false);
		}
	});

	it('match a host name, giving the port it carries', () => {
		expect(matchHost('{port}.localhost', '5173.localhost')).toBe(5173);
		expect(matchHost('{port}.localhost', '5173.LOCALHOST')).toBe(5173);
		expect(matchHost('p{port}.proxy.localhost', 'p3000.proxy.localhost')).toBe(3000);
		for (const h of [
			'localhost',
			'5173.localhost.evil.test',
			'x5173.localhost',
			'05173.localhost',
			'0.localhost',
			'65536.localhost',
			'5173.proxy.localhost'
		]) {
			expect(matchHost('{port}.localhost', h), h).toBeNull();
		}
	});

	it('come from a Host header only when it names *.localhost', () => {
		expect(localhostName('5173.localhost:4310')).toBe('5173.localhost');
		expect(localhostName('App.Proxy.LOCALHOST')).toBe('app.proxy.localhost');
		for (const h of [
			'localhost:4310',
			'127.0.0.1:4310',
			'a.localhost.evil.test',
			'evil.test',
			''
		]) {
			expect(localhostName(h), h).toBeNull();
		}
		expect(localhostName(undefined)).toBeNull();
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
			expect(loopbackPort(raw), raw).toBeNull();
		}
	});
});

describe('rewriteAddress', () => {
	it('shows an address on this computer at the template, on the port the viewer reached Wheelhouse on', () => {
		expect(
			rewriteAddress('http://localhost:5173/app/page?x=1#top', '{port}.localhost', viewer)
		).toBe('http://5173.localhost:4310/app/page?x=1#top');
		expect(rewriteAddress('http://127.0.0.1:3000', 'p{port}.proxy.localhost', viewer)).toBe(
			'http://p3000.proxy.localhost:4310/'
		);
		// Forwarded to another port, or reached by its IP address, it follows the viewer.
		const forwarded = { protocol: 'http:', hostname: '127.0.0.1', port: '8080' };
		expect(rewriteAddress('http://localhost:5173/', '{port}.localhost', forwarded)).toBe(
			'http://5173.localhost:8080/'
		);
		const tls = { protocol: 'https:', hostname: 'localhost', port: '' };
		expect(rewriteAddress('http://localhost:5173/', '{port}.localhost', tls)).toBe(
			'https://5173.localhost/'
		);
	});

	it('leaves Wheelhouse’s own address, anything not on this computer, and everything without a rewrite alone', () => {
		for (const raw of [
			'http://localhost:4310/tasks/a',
			'http://127.0.0.1:4310/',
			'https://localhost:5173/',
			'https://github.com/o/r/pull/1',
			'/tasks/a',
			'mailto:a@b.c'
		]) {
			expect(rewriteAddress(raw, '{port}.localhost', viewer), raw).toBe(raw);
		}
		expect(rewriteAddress('http://localhost:5173/', null, viewer)).toBe('http://localhost:5173/');
	});
});

describe('loopbackAddresses', () => {
	it('finds each address on this computer in plain text once', () => {
		expect(
			loopbackAddresses(
				'Preview at http://localhost:5173/app. Also http://127.0.0.1:8080 and (http://localhost:5173/app), https://localhost:9443/, not http://example.com:3000/ or http://u:p@localhost:1/.'
			)
		).toEqual(['http://localhost:5173/app', 'http://127.0.0.1:8080', 'https://localhost:9443/']);
		expect(loopbackAddresses('nothing here')).toEqual([]);
	});
});
