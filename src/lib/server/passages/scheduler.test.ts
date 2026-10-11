import { describe, expect, it } from 'vitest';
import { Scheduler, type Job } from './scheduler';

/** A clock the test moves by hand, and jobs whose runs the test settles by hand. */
function harness(maxConcurrent = 2) {
	let now = 1_000_000;
	const changes: number[] = [];
	const s = new Scheduler<string>({
		now: () => now,
		maxConcurrent,
		onChange: () => changes.push(now)
	});
	const runs: { key: string; resolve: (v: string) => void; reject: (e: Error) => void }[] = [];
	const job = (key: string, o: Partial<Job<string>> = {}): Job<string> => ({
		key,
		run: () =>
			new Promise<string>((resolve, reject) => {
				runs.push({ key, resolve, reject });
			}),
		intervalMs: 60_000,
		giveUpAt: null,
		terminal: (r) => r === 'done',
		...o
	});
	const settle = async (key: string, value: string | Error) => {
		const i = runs.findIndex((r) => r.key === key);
		const [r] = runs.splice(i, 1);
		if (value instanceof Error) r.reject(value);
		else r.resolve(value);
		await new Promise((res) => setTimeout(res, 0));
	};
	return {
		s,
		job,
		runs,
		settle,
		changes,
		advance: (ms: number) => (now += ms),
		now: () => now
	};
}

describe('Scheduler', () => {
	it('runs a wanted job at once, then again only after its interval', async () => {
		const h = harness();
		const j = h.job('a');
		h.s.want([j]);
		expect(h.runs.map((r) => r.key)).toEqual(['a']);
		expect(h.s.status('a')).toMatchObject({ running: true, result: null });
		await h.settle('a', 'pending');
		expect(h.s.status('a')).toMatchObject({ running: false, result: 'pending', gaveUp: false });
		expect(h.changes).toHaveLength(1);

		h.advance(59_000);
		h.s.want([j]);
		expect(h.runs).toHaveLength(0);
		h.advance(1_000);
		h.s.want([j]);
		expect(h.runs.map((r) => r.key)).toEqual(['a']);
	});

	it('caches a terminal result and never runs that job again', async () => {
		const h = harness();
		h.s.want([h.job('a')]);
		await h.settle('a', 'done');
		h.advance(10 * 60_000);
		h.s.want([h.job('a')]);
		h.s.want([]);
		h.s.want([h.job('a')]);
		expect(h.runs).toHaveLength(0);
		expect(h.s.status('a')?.result).toBe('done');
	});

	it('runs at most maxConcurrent jobs at a time, oldest due first', async () => {
		const h = harness(2);
		h.s.want([h.job('a'), h.job('b'), h.job('c')]);
		expect(h.runs.map((r) => r.key)).toEqual(['a', 'b']);
		await h.settle('a', 'x');
		expect(h.runs.map((r) => r.key)).toEqual(['b', 'c']);
	});

	it('stops running jobs nobody wants, but keeps their last result', async () => {
		const h = harness();
		h.s.want([h.job('a')]);
		await h.settle('a', 'pending');
		h.s.want([]);
		h.advance(120_000);
		h.s.pump();
		expect(h.runs).toHaveLength(0);
		expect(h.s.status('a')?.result).toBe('pending');
	});

	it('gives up after giveUpAt, but checks once more first', async () => {
		const h = harness();
		const giveUpAt = h.now() + 90_000;
		const j = () => h.job('a', { giveUpAt });
		h.s.want([j()]);
		await h.settle('a', 'absent');
		expect(h.s.status('a')?.gaveUp).toBe(false);
		h.advance(60_000);
		h.s.want([j()]);
		await h.settle('a', 'absent');
		expect(h.s.status('a')?.gaveUp).toBe(false);
		h.advance(60_000);
		h.s.want([j()]);
		expect(h.runs).toHaveLength(1);
		await h.settle('a', 'absent');
		expect(h.s.status('a')).toMatchObject({ gaveUp: true, result: 'absent' });
		h.advance(600_000);
		h.s.want([j()]);
		expect(h.runs).toHaveLength(0);
	});

	it('checks a job first seen after its give-up time exactly once', async () => {
		const h = harness();
		h.s.want([h.job('old', { giveUpAt: h.now() - 1 })]);
		expect(h.runs).toHaveLength(1);
		await h.settle('old', 'absent');
		expect(h.s.status('old')?.gaveUp).toBe(true);
	});

	it('does not give up on a terminal result', async () => {
		const h = harness();
		h.s.want([h.job('a', { giveUpAt: h.now() - 1 })]);
		await h.settle('a', 'done');
		expect(h.s.status('a')).toMatchObject({ gaveUp: false, result: 'done' });
	});

	it('keeps the last result when a run throws, and tries again later', async () => {
		const h = harness();
		h.s.want([h.job('a')]);
		await h.settle('a', 'pending');
		h.advance(60_000);
		h.s.want([h.job('a')]);
		await h.settle('a', new Error('boom'));
		expect(h.s.status('a')).toMatchObject({ result: 'pending', running: false });
		h.advance(60_000);
		h.s.want([h.job('a')]);
		expect(h.runs).toHaveLength(1);
	});

	it('runs nothing after stop', async () => {
		const h = harness();
		h.s.stop();
		h.s.want([h.job('a')]);
		expect(h.runs).toHaveLength(0);
	});
});
