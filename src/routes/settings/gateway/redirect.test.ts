import { describe, expect, it } from 'vitest';
import { load } from './+page.server';

const outcome = (headers: Record<string, string> = {}) => {
	try {
		load({ request: new Request('http://127.0.0.1/settings/gateway', { headers }) } as never);
	} catch (error) {
		return error;
	}
};

describe('legacy Settings → Gateway route', () => {
	it('redirects to Settings → Fleet', () => {
		expect(outcome()).toMatchObject({ status: 307, location: '/settings/fleet' });
	});

	it('refuses a request that came through the cloud', () => {
		expect(outcome({ 'x-wheelhouse-remote': '1' })).toMatchObject({ status: 403 });
	});
});
