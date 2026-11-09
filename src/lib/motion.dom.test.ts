import { afterEach, describe, expect, it, vi } from 'vitest';
import { cue, MOTION, reducedMotion, STAMP_MS, stampOut, zoomFrom } from './motion';

const motion = (reduce: boolean) =>
	vi.stubGlobal('matchMedia', () => ({
		matches: reduce,
		addEventListener: () => {},
		removeEventListener: () => {}
	}));

afterEach(() => {
	vi.unstubAllGlobals();
	vi.useRealTimers();
	document.body.innerHTML = '';
});

describe('motion', () => {
	it('reads the system’s reduced-motion setting', () => {
		motion(true);
		expect(reducedMotion()).toBe(true);
		motion(false);
		expect(reducedMotion()).toBe(false);
	});

	it('works out how to draw a full-size box over the thumbnail it opens from', () => {
		const to = { left: 0, top: 0, width: 1000, height: 800 };
		expect(zoomFrom({ left: 100, top: 200, width: 250, height: 200 }, to)).toEqual({
			x: 100,
			y: 200,
			sx: 0.25,
			sy: 0.25
		});
		expect(zoomFrom(to, { ...to, width: 0, height: 0 })).toMatchObject({ sx: 1, sy: 1 });
	});

	it('stamps an answered card with what was done, holds it, then lets it go', () => {
		motion(false);
		const li = document.createElement('li');
		document.body.append(li);
		const t = stampOut(li, { word: 'Answered' });
		expect(li.querySelector('.wh-stamp')?.textContent).toBe('Answered');
		expect(t.duration).toBe(STAMP_MS);
		// Still in place while the stamp lands; gone by the end.
		expect(t.css?.(0.9, 0.1)).toContain('opacity: 1');
		expect(t.css?.(0, 1)).toContain('opacity: 0');
	});

	it('folds a card away without a stamp, and at once under reduced motion', () => {
		motion(false);
		const li = document.createElement('li');
		const t = stampOut(li);
		expect(t.duration).toBeLessThan(MOTION.moment);
		expect(t.css?.(0, 1)).toContain('height: 0px');
		expect(li.querySelector('.wh-stamp')).toBeNull();
		motion(true);
		expect(stampOut(li, { word: 'Closed' }).duration).toBe(0);
		expect(li.querySelector('.wh-stamp')).toBeNull();
	});

	it('cues a one-off class when something becomes true on screen, not when drawn so', () => {
		motion(false);
		vi.useFakeTimers();
		const el = document.createElement('article');
		cue(true, 'wh-landed')(el);
		expect(el.classList.contains('wh-landed')).toBe(false);
		const other = document.createElement('article');
		cue(false, 'wh-landed')(other);
		cue(true, 'wh-landed')(other);
		expect(other.classList.contains('wh-landed')).toBe(true);
		vi.advanceTimersByTime(2000);
		expect(other.classList.contains('wh-landed')).toBe(false);
	});
});
