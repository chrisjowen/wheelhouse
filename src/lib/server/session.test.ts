import { describe, expect, it } from 'vitest';
import { acceptedHost, isAllowedHost, originFor, parseAllowedHosts, servedOrigin } from './session';

describe('servedOrigin', () => {
	it('is http://<Host>, whatever scheme the request URL claims', () => {
		const req = new Request('https://127.0.0.1:4310/api/fleet', {
			headers: { host: 'LocalHost:4310' }
		});
		expect(servedOrigin(req)).toBe('http://localhost:4310');
	});
});

describe('allowed hosts (WHEELHOUSE_ALLOWED_HOSTS)', () => {
	const env = { WHEELHOUSE_ALLOWED_HOSTS: '*.example.dev, ide.example.com' };

	it('allow none by default: loopback only, as before', () => {
		for (const host of ['4310--x.example.dev', 'ide.example.com', '0.0.0.0:4310', 'evil.com']) {
			expect(isAllowedHost(host, {})).toBe(false);
			expect(acceptedHost(host, {})).toBe(false);
		}
		for (const host of ['127.0.0.1:4310', 'localhost:4310', '[::1]:4310']) {
			expect(acceptedHost(host, {})).toBe(true);
		}
	});

	it('match a name exactly, or under a *.suffix at any depth', () => {
		for (const host of [
			'4310--x.example.dev',
			'a.b.example.dev:443',
			'IDE.Example.com',
			'ide.example.com:8443'
		]) {
			expect(isAllowedHost(host, env)).toBe(true);
		}
	});

	it('never match a substring, the suffix itself or a lookalike', () => {
		for (const host of [
			'example.dev',
			'evilexample.dev',
			'x.example.dev.evil.com',
			'example.dev.evil.com',
			'xide.example.com',
			'sub.ide.example.com',
			'ide.example.com.evil.com',
			'.example.dev',
			'x.example.dev@evil.com',
			'x.example.dev:4310:1',
			''
		]) {
			expect(isAllowedHost(host, env)).toBe(false);
		}
	});

	it('keep entries that are names or *.suffixes of two labels or more, and say which are not', () => {
		const parsed = parseAllowedHosts(' *.Example.dev ,ide.example.com,*.dev,*,a*.b.c,x.y:443,, ');
		expect([...parsed.exact]).toEqual(['ide.example.com']);
		expect(parsed.suffixes).toEqual(['.example.dev']);
		expect(parsed.invalid).toEqual(['*.dev', '*', 'a*.b.c', 'x.y:443']);
	});
});

describe('the served origin', () => {
	const env = { WHEELHOUSE_ALLOWED_HOSTS: '*.example.dev' };

	it('is https://<Host> for an allowed host, or http:// when X-Forwarded-Proto says so', () => {
		expect(originFor('4310--x.example.dev', null, env)).toBe('https://4310--x.example.dev');
		expect(originFor('4310--X.example.dev', 'https', env)).toBe('https://4310--x.example.dev');
		expect(originFor('4310--x.example.dev', 'http', env)).toBe('http://4310--x.example.dev');
		expect(originFor('4310--x.example.dev', 'http, https', env)).toBe('http://4310--x.example.dev');
		expect(originFor('4310--x.example.dev', 'gopher', env)).toBe('https://4310--x.example.dev');
	});

	it('stays http://<Host> on loopback, whatever X-Forwarded-Proto says', () => {
		expect(originFor('127.0.0.1:4310', 'https', env)).toBe('http://127.0.0.1:4310');
		expect(originFor('localhost:4310', 'https', {})).toBe('http://localhost:4310');
	});

	it('is http://<Host> for a host that is not allowed (which is refused before it matters)', () => {
		expect(originFor('4310--x.example.dev', 'https', {})).toBe('http://4310--x.example.dev');
	});
});
