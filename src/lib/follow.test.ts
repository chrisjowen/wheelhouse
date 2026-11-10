import { describe, expect, it } from 'vitest';
import { atBottom, follower, NEAR_BOTTOM } from './follow';

/** A scroller 1000 px tall with 400 px in view, starting at the top. */
function page() {
	const m = { top: 0, height: 1000, view: 400 };
	const seen: boolean[] = [];
	const f = follower({
		measure: () => m,
		toBottom: () => (m.top = m.height - m.view),
		onunseen: (v) => seen.push(v)
	});
	return { m, f, seen };
}

describe('atBottom', () => {
	it('counts a few pixels short of the end as at the bottom', () => {
		expect(atBottom({ top: 600, height: 1000, view: 400 })).toBe(true);
		expect(atBottom({ top: 600 - NEAR_BOTTOM, height: 1000, view: 400 })).toBe(true);
		expect(atBottom({ top: 600 - NEAR_BOTTOM - 1, height: 1000, view: 400 })).toBe(false);
		// Shorter than the window: always at the bottom.
		expect(atBottom({ top: 0, height: 300, view: 400 })).toBe(true);
	});
});

describe('follower', () => {
	it('opens at the bottom and follows new entries while there', () => {
		const { m, f } = page();
		f.jump();
		expect(m.top).toBe(600);
		f.scrolled();
		m.height = 1300;
		f.grew();
		expect(m.top).toBe(900);
		expect(f.following).toBe(true);
		expect(f.unseen).toBe(false);
	});

	it('never moves once the reader has scrolled up, and notes what arrived below', () => {
		const { m, f, seen } = page();
		f.jump();
		m.top = 200;
		f.scrolled();
		expect(f.following).toBe(false);
		m.height = 1300;
		f.grew();
		f.grew();
		expect(m.top).toBe(200);
		expect(f.unseen).toBe(true);
		expect(seen).toEqual([true]);
	});

	it('follows again once the reader is back at the bottom, or jumps there', () => {
		const { m, f, seen } = page();
		f.jump();
		m.top = 0;
		f.scrolled();
		m.height = 1300;
		f.grew();
		m.top = 880; // within the threshold of 900
		f.scrolled();
		expect(f.following).toBe(true);
		expect(f.unseen).toBe(false);
		m.top = 0;
		f.scrolled();
		f.grew();
		f.jump();
		expect(m.top).toBe(900);
		expect(seen).toEqual([true, false, true, false]);
	});
});
