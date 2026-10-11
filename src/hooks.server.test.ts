import type { RequestEvent } from '@sveltejs/kit';
import { describe, expect, it } from 'vitest';
import { handle } from './hooks.server';

async function request(host: string | null): Promise<Response> {
	const headers = new Headers();
	if (host !== null) headers.set('host', host);
	const event = { request: new Request('http://127.0.0.1/api/fleet', { headers }) } as RequestEvent;
	return handle({ event, resolve: async () => new Response('ok') });
}

describe('handle', () => {
	it.each(['127.0.0.1:4310', 'localhost:4310', '[::1]:4310', 'LOCALHOST:5173'])(
		'serves requests addressed to %s',
		async (host) => {
			const res = await request(host);
			expect(res.status).toBe(200);
			expect(await res.text()).toBe('ok');
		}
	);

	it.each([
		'evil.example:4310',
		'127.0.0.1.evil.example:4310',
		'localhost.evil.example',
		'127.0.0.1:4310@evil.example',
		'0.0.0.0:4310',
		''
	])('rejects requests addressed to %j with 421', async (host) => {
		expect((await request(host)).status).toBe(421);
	});

	it('rejects requests without a Host header', async () => {
		expect((await request(null)).status).toBe(421);
	});
});
