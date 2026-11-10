import { describe, expect, it } from 'vitest';
import { opensSetup } from './redirect';

const req = (accept: string, method = 'GET') =>
	new Request('http://127.0.0.1/', { method, headers: { accept } });

describe('opensSetup', () => {
	it('sends a browser’s page to the wizard', () => {
		expect(opensSetup(req('text/html,*/*'), '/')).toBe(true);
		expect(opensSetup(req('text/html'), '/projects/x')).toBe(true);
	});

	it('leaves the wizard, the API, assets, data and changes alone', () => {
		expect(opensSetup(req('text/html'), '/setup')).toBe(false);
		expect(opensSetup(req('text/html'), '/api/setup')).toBe(false);
		expect(opensSetup(req('text/html'), '/_app/immutable/x.js')).toBe(false);
		expect(opensSetup(req('*/*'), '/projects/x/__data.json')).toBe(false);
		expect(opensSetup(req('application/json'), '/')).toBe(false);
		expect(opensSetup(req('text/html', 'POST'), '/')).toBe(false);
	});
});
