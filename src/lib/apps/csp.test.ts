import { describe, expect, it } from 'vitest';
import { cleanCsp, cspHeader, cspOrigins } from './csp';

const directives = (header: string) =>
	Object.fromEntries(
		header.split('; ').map((d) => {
			const [name, ...rest] = d.split(' ');
			return [name, rest.join(' ')];
		})
	);

describe('an MCP app’s Content-Security-Policy', () => {
	it('allows no network, frames or plugins when the app declares nothing', () => {
		const d = directives(cspHeader(undefined));
		expect(d).toMatchObject({
			'default-src': "'none'",
			'script-src': "'self' 'unsafe-inline'",
			'style-src': "'self' 'unsafe-inline'",
			'img-src': "'self' data:",
			'media-src': "'self' data:",
			'connect-src': "'none'",
			'frame-src': "'none'",
			'object-src': "'none'",
			'base-uri': "'self'",
			'form-action': "'none'"
		});
	});

	it('allows exactly the origins the app declares, each where it belongs', () => {
		const d = directives(
			cspHeader({
				connectDomains: ['https://api.example.com', 'wss://live.example.com'],
				resourceDomains: ['https://*.cdn.example.com'],
				frameDomains: ['https://www.youtube.com'],
				baseUriDomains: ['https://cdn.example.com']
			})
		);
		expect(d['connect-src']).toBe("'self' https://api.example.com wss://live.example.com");
		for (const k of ['script-src', 'style-src', 'img-src', 'font-src', 'media-src']) {
			expect(d[k]).toContain('https://*.cdn.example.com');
		}
		expect(d['frame-src']).toBe('https://www.youtube.com');
		expect(d['base-uri']).toBe('https://cdn.example.com');
	});

	it('drops anything that is not a plain origin, so nothing undeclared gets in', () => {
		expect(
			cleanCsp({
				connectDomains: [
					'https://ok.example.com:8443',
					'*',
					'https:',
					"'unsafe-eval'",
					'https://a.example.com; script-src *',
					'https://b.example.com/path',
					'javascript:alert(1)',
					42
				],
				resourceDomains: 'https://not-a-list.example.com',
				other: ['https://x.example.com']
			})
		).toEqual({ connectDomains: ['https://ok.example.com:8443'] });
		expect(cspHeader({ resourceDomains: ['*'] })).not.toMatch(/ \*( |;|$)/);
	});

	it('lists every origin the app may reach, once', () => {
		expect(
			cspOrigins({ connectDomains: ['https://a.test'], resourceDomains: ['https://a.test'] })
		).toEqual(['https://a.test']);
	});
});
