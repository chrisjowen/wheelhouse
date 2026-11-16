import { describe, expect, it } from 'vitest';
import { load } from './+page.server';

describe('the old Events URL', () => {
	it('redirects to Settings → Events', () => {
		try {
			load({} as never);
			throw new Error('Expected the old Events URL to redirect.');
		} catch (error) {
			expect(error).toMatchObject({ status: 307, location: '/settings/events' });
		}
	});
});
