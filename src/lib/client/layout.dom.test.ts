import { beforeEach, describe, expect, it } from 'vitest';
import { homeLayout, parseRailSide, RAIL_SIDE_KEY } from './layout.svelte';

describe('the On deck rail side', () => {
	beforeEach(() => localStorage.clear());

	it('defaults to the left, and reads right only when set so', () => {
		expect(parseRailSide(null)).toBe('left');
		expect(parseRailSide('sideways')).toBe('left');
		expect(parseRailSide('right')).toBe('right');
	});

	it('swaps sides and remembers the choice in this browser', () => {
		homeLayout.load();
		expect(homeLayout.side).toBe('left');
		homeLayout.swap();
		expect(homeLayout.side).toBe('right');
		expect(localStorage.getItem(RAIL_SIDE_KEY)).toBe('right');
		homeLayout.side = 'left';
		homeLayout.load();
		expect(homeLayout.side).toBe('right');
	});
});
