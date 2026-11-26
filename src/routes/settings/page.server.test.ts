import { describe, expect, it } from 'vitest';
import { load } from './+page.server';

describe('/settings redirect', () => {
	it('opens on Fleet, which everyone has', async () => {
		await expect(load({} as never)).rejects.toMatchObject({
			status: 307,
			location: '/settings/fleet'
		});
	});
});
