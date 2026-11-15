import { describe, expect, it } from 'vitest';
import { load } from './+page.server';

describe('legacy Settings → Cloud route', () => {
	it('redirects to the shared Gateway profile', () => {
		let result: unknown;
		try {
			load({} as never);
		} catch (error) {
			result = error;
		}
		expect(result).toMatchObject({ status: 307, location: '/settings/gateway' });
	});
});
