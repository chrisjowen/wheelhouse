import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { consoleColumns, fitConsole, MIN_CONSOLE_COLS, poll, type Visibility } from './console';

describe('consoleColumns', () => {
	it('is the widest line, ignoring trailing spaces, and never under a classic terminal', () => {
		expect(consoleColumns(['short'])).toBe(MIN_CONSOLE_COLS);
		expect(consoleColumns(['x'.repeat(120), 'y   '])).toBe(120);
		expect(consoleColumns(['a'.repeat(100) + '      '])).toBe(100);
		expect(consoleColumns(['⏺ ' + 'z'.repeat(98)])).toBe(100);
	});
});

describe('fitConsole', () => {
	// The reproduction: an 82-column capture on a 1600×1000 screen was drawn at a fixed 16px,
	// filling about half the width. Full screen grows the font until the columns fill it.
	it('grows the font so the pane’s columns fill the screen’s width', () => {
		const fit = fitConsole({ width: 1568, height: 900, cols: 82, charWidth: 0.6 });
		expect(fit.fontSize * 0.6 * 82).toBeLessThanOrEqual(1568);
		expect(fit.fontSize * 0.6 * 82).toBeGreaterThan(1568 * 0.97);
		expect(fit.rows).toBe(Math.floor(900 / (fit.fontSize * 1.45)));
	});

	it('refits when the screen changes size', () => {
		const big = fitConsole({ width: 1568, height: 900, cols: 82, charWidth: 0.6 });
		const small = fitConsole({ width: 768, height: 600, cols: 82, charWidth: 0.6 });
		expect(small.fontSize).toBeLessThan(big.fontSize);
		expect(small.fontSize * 0.6 * 82).toBeLessThanOrEqual(768);
	});

	it('keeps text readable: a wide pane on a small screen scrolls, a narrow one does not balloon', () => {
		expect(fitConsole({ width: 300, height: 500, cols: 240, charWidth: 0.6 }).fontSize).toBe(11);
		expect(fitConsole({ width: 5000, height: 3000, cols: 80, charWidth: 0.6 }).fontSize).toBe(32);
	});

	it('survives an unmeasured (zero-sized) screen', () => {
		const fit = fitConsole({ width: 0, height: 0, cols: 80, charWidth: 0.6 });
		expect(fit.fontSize).toBe(11);
		expect(fit.rows).toBe(1);
	});
});

class FakeDoc implements Visibility {
	hidden = false;
	private listeners = new Set<() => void>();
	addEventListener(_: 'visibilitychange', l: () => void) {
		this.listeners.add(l);
	}
	removeEventListener(_: 'visibilitychange', l: () => void) {
		this.listeners.delete(l);
	}
	set(hidden: boolean) {
		this.hidden = hidden;
		for (const l of this.listeners) l();
	}
	get listening() {
		return this.listeners.size;
	}
}

describe('poll', () => {
	beforeEach(() => vi.useFakeTimers());
	afterEach(() => vi.useRealTimers());

	it('loads at once and then every interval, so new output shows within a second', async () => {
		const doc = new FakeDoc();
		let n = 0;
		const seen: number[] = [];
		const stop = poll({
			load: async () => ++n,
			intervalMs: 1_000,
			onresult: (v) => seen.push(v),
			onerror: () => {},
			doc
		});
		await vi.advanceTimersByTimeAsync(0);
		expect(seen).toEqual([1]);
		await vi.advanceTimersByTimeAsync(999);
		expect(seen).toEqual([1]);
		await vi.advanceTimersByTimeAsync(1);
		expect(seen).toEqual([1, 2]);
		stop();
		await vi.advanceTimersByTimeAsync(5_000);
		expect(seen).toEqual([1, 2]);
		expect(doc.listening).toBe(0);
	});

	it('pauses while the page is hidden and refreshes as soon as it is shown again', async () => {
		const doc = new FakeDoc();
		const load = vi.fn(async () => 'x');
		const stop = poll({ load, intervalMs: 1_000, onresult: () => {}, onerror: () => {}, doc });
		await vi.advanceTimersByTimeAsync(0);
		expect(load).toHaveBeenCalledTimes(1);
		doc.set(true);
		await vi.advanceTimersByTimeAsync(10_000);
		expect(load).toHaveBeenCalledTimes(1);
		doc.set(false);
		await vi.advanceTimersByTimeAsync(0);
		expect(load).toHaveBeenCalledTimes(2);
		stop();
	});

	it('never overlaps a slow load, and reports failures without stopping', async () => {
		const doc = new FakeDoc();
		let calls = 0;
		let inFlight = 0;
		let most = 0;
		const errors: string[] = [];
		const stop = poll({
			load: async () => {
				calls++;
				inFlight++;
				most = Math.max(most, inFlight);
				await new Promise((r) => setTimeout(r, 2_500));
				inFlight--;
				if (calls === 1) throw new Error('HTTP 503');
				return calls;
			},
			intervalMs: 1_000,
			onresult: () => {},
			onerror: (e) => errors.push(e.message),
			doc
		});
		doc.set(false); // a visibility event mid-load must not start a second load
		await vi.advanceTimersByTimeAsync(8_000);
		expect(most).toBe(1);
		expect(errors).toEqual(['HTTP 503']);
		expect(calls).toBeGreaterThanOrEqual(2);
		stop();
	});
});
