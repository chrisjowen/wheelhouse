import { describe, expect, it } from 'vitest';
import { servedOrigin } from './session';

describe('servedOrigin', () => {
	it('is http://<Host>, whatever scheme the request URL claims', () => {
		const req = new Request('https://127.0.0.1:4310/api/fleet', {
			headers: { host: 'LocalHost:4310' }
		});
		expect(servedOrigin(req)).toBe('http://localhost:4310');
	});
});
