import { describe, expect, it } from 'vitest';
import { detectHosted, hostedAddress, localPort, previewPattern } from './hosted';

const GITPOD = { GITPOD_WORKSPACE_URL: 'https://abc123.ws-eu45.gitpod.io' };
const CODESPACES = {
	CODESPACE_NAME: 'octocat-literate-space-parakeet-mld5',
	GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN: 'app.github.dev'
};

describe('preview URL patterns', () => {
	it('are http(s) URLs with {port} once, in the host or the path', () => {
		for (const p of [
			'https://{port}.example.dev',
			'https://{port}-abc.ws-eu45.gitpod.io',
			'https://name-{port}.app.github.dev',
			'http://{port}.vm.internal:8443',
			'https://code.example.dev/proxy/{port}',
			'https://code.example.dev/proxy/{port}/',
			'https://hub.example.dev/user/me/proxy/{port}'
		]) {
			expect(previewPattern(p), p).toBe(p);
		}
	});

	it('refuse anything else', () => {
		for (const p of [
			'',
			'https://example.dev',
			'https://{port}.{port}.example.dev',
			'ftp://{port}.example.dev',
			'javascript:{port}',
			'https://user:pw@{port}.example.dev',
			'https://{port}.example.dev?x=1',
			'https://{port}.example.dev#top',
			'https://example.dev:{port}',
			'https://ex ample.dev/{port}',
			'{port}.example.dev',
			`https://${'a'.repeat(300)}{port}.dev`,
			42,
			null
		]) {
			expect(previewPattern(p), String(p)).toBeNull();
		}
	});
});

describe('detecting a hosted environment', () => {
	it('finds none in an ordinary environment', () => {
		expect(detectHosted({})).toEqual({ hosted: null, problem: null });
	});

	it('serves Gitpod ports at <port>- before the workspace host', () => {
		expect(detectHosted(GITPOD).hosted).toEqual({
			pattern: 'https://{port}-abc123.ws-eu45.gitpod.io',
			source: 'gitpod'
		});
		expect(
			detectHosted({ GITPOD_WORKSPACE_URL: 'https://abc123.ws-eu45.gitpod.io/' }).hosted
		).toMatchObject({ pattern: 'https://{port}-abc123.ws-eu45.gitpod.io' });
	});

	it('serves Codespaces ports at <name>-<port> on the forwarding domain', () => {
		expect(detectHosted(CODESPACES).hosted).toEqual({
			pattern: 'https://octocat-literate-space-parakeet-mld5-{port}.app.github.dev',
			source: 'codespaces'
		});
		// Both are needed.
		expect(detectHosted({ CODESPACE_NAME: 'x' }).hosted).toBeNull();
		expect(
			detectHosted({ GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN: 'app.github.dev' }).hosted
		).toBeNull();
	});

	it('ignores values that are not a workspace URL, a codespace name or a domain', () => {
		for (const env of [
			{ GITPOD_WORKSPACE_URL: 'not a url' },
			{ GITPOD_WORKSPACE_URL: 'http://abc.ws-eu45.gitpod.io' },
			{ GITPOD_WORKSPACE_URL: 'https://user@abc.ws.gitpod.io' },
			{ GITPOD_WORKSPACE_URL: 'https://localhost' },
			{ CODESPACE_NAME: 'a/b', GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN: 'app.github.dev' },
			{ CODESPACE_NAME: 'a', GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN: 'evil.dev/x' }
		]) {
			expect(detectHosted(env).hosted, JSON.stringify(env)).toBeNull();
		}
	});

	it('puts a configured pattern before any detected environment', () => {
		const env = { ...GITPOD, ...CODESPACES, WHEELHOUSE_PREVIEW_URL: 'https://{port}.example.dev' };
		expect(detectHosted(env)).toEqual({
			hosted: { pattern: 'https://{port}.example.dev', source: 'configured' },
			problem: null
		});
		// Gitpod before Codespaces.
		expect(detectHosted({ ...GITPOD, ...CODESPACES }).hosted?.source).toBe('gitpod');
	});

	it('turns hosted previews off, detection included, when the pattern is off', () => {
		for (const off of ['off', 'OFF', 'none', 'false', '0']) {
			expect(detectHosted({ ...GITPOD, WHEELHOUSE_PREVIEW_URL: off })).toEqual({
				hosted: null,
				problem: null
			});
		}
	});

	it('says why a configured value is ignored, and falls back to detection', () => {
		const found = detectHosted({ ...CODESPACES, WHEELHOUSE_PREVIEW_URL: 'https://example.dev' });
		expect(found.hosted?.source).toBe('codespaces');
		expect(found.problem).toContain('WHEELHOUSE_PREVIEW_URL is not a preview URL pattern');
		expect(detectHosted({ WHEELHOUSE_PREVIEW_URL: 'nope' })).toMatchObject({ hosted: null });
		// An empty value is not set.
		expect(detectHosted({ WHEELHOUSE_PREVIEW_URL: ' ' })).toEqual({ hosted: null, problem: null });
	});
});

describe('addresses in a hosted environment', () => {
	const gitpod = { pattern: 'https://{port}-abc.ws-eu45.gitpod.io', reserved: [4310, 4399] };

	it('open at the environment’s URL for their port, keeping the path, query and fragment', () => {
		expect(hostedAddress('http://localhost:5173/app?x=1#top', gitpod)).toBe(
			'https://5173-abc.ws-eu45.gitpod.io/app?x=1#top'
		);
		expect(hostedAddress('http://127.0.0.1:4471/', gitpod)).toBe(
			'https://4471-abc.ws-eu45.gitpod.io/'
		);
		expect(hostedAddress('http://0.0.0.0:3000', gitpod)).toBe(
			'https://3000-abc.ws-eu45.gitpod.io/'
		);
		expect(hostedAddress('http://[::1]:8080/x', gitpod)).toBe(
			'https://8080-abc.ws-eu45.gitpod.io/x'
		);
		expect(hostedAddress('https://LOCALHOST:8443/x', gitpod)).toBe(
			'https://8443-abc.ws-eu45.gitpod.io/x'
		);
		expect(hostedAddress('http://localhost/x', gitpod)).toBe('https://80-abc.ws-eu45.gitpod.io/x');
	});

	it('fill a Codespaces or a path pattern the same way', () => {
		expect(
			hostedAddress('http://localhost:5173/a', { pattern: 'https://cs-{port}.app.github.dev' })
		).toBe('https://cs-5173.app.github.dev/a');
		expect(
			hostedAddress('http://localhost:5173/a?b', {
				pattern: 'https://code.example.dev/proxy/{port}/'
			})
		).toBe('https://code.example.dev/proxy/5173/a?b');
	});

	it('never rewrite Wheelhouse’s own ports', () => {
		expect(hostedAddress('http://localhost:4310/tasks/t-1', gitpod)).toBe(
			'http://localhost:4310/tasks/t-1'
		);
		expect(hostedAddress('http://127.0.0.1:4399/app', gitpod)).toBe('http://127.0.0.1:4399/app');
	});

	it('leave any other address alone', () => {
		for (const raw of [
			'https://example.com:5173/',
			'http://5173.localhost:4310/',
			'http://user:pw@localhost:5173/',
			'ftp://localhost:21/',
			'mailto:a@b.c',
			'not a url'
		]) {
			expect(hostedAddress(raw, gitpod), raw).toBe(raw);
		}
	});

	it('read the port of an address on this computer', () => {
		expect(localPort('http://localhost:5173/')).toBe(5173);
		expect(localPort('https://127.0.0.1/')).toBe(443);
		expect(localPort('http://example.com:5173/')).toBeNull();
	});
});
