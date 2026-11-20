import { describe, expect, it } from 'vitest';
import { load } from './+page.server';

const outcome = (headers: Record<string, string> = {}) => {
	try {
		load({ request: new Request('http://127.0.0.1/settings/cloud', { headers }) } as never);
	} catch (error) {
		return error;
	}
};

describe('legacy Settings → Cloud route', () => {
	it('redirects to the shared Gateway profile', () => {
		expect(outcome()).toMatchObject({ status: 307, location: '/settings/gateway' });
	});

	it('refuses a request that came through the cloud', () => {
		expect(outcome({ 'x-wheelhouse-remote': '1' })).toMatchObject({ status: 403 });
	});
});
