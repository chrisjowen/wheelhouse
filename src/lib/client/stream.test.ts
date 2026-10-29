import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LOST_AFTER_MS, REOPEN_MS, watchedStream, type Connection } from './stream';

/** An EventSource the test drives: open, drop (the browser retries) or give up. */
class FakeSource {
	static CONNECTING = 0;
	static OPEN = 1;
	static CLOSED = 2;
	static all: FakeSource[] = [];
	readyState = FakeSource.CONNECTING;
	listeners = new Map<string, (() => void)[]>();
	constructor(public url: string) {
		FakeSource.all.push(this);
	}
	addEventListener(type: string, fn: () => void) {
		this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn]);
	}
	private fire(type: string) {
		for (const fn of this.listeners.get(type) ?? []) fn();
	}
	open() {
		this.readyState = FakeSource.OPEN;
		this.fire('open');
	}
	/** The connection dropped or was refused; the browser will retry it. */
	drop() {
		this.readyState = FakeSource.CONNECTING;
		this.fire('error');
	}
	/** The browser gave up on this stream. */
	fail() {
		this.readyState = FakeSource.CLOSED;
		this.fire('error');
	}
	close() {
		this.readyState = FakeSource.CLOSED;
	}
}

let states: Connection[];
let listened: FakeSource[];
const last = () => FakeSource.all[FakeSource.all.length - 1];
const watch = () =>
	watchedStream(
		'/api/events',
		(es) => listened.push(es as unknown as FakeSource),
		(s) => states.push(s)
	);

beforeEach(() => {
	vi.useFakeTimers();
	FakeSource.all = [];
	states = [];
	listened = [];
	vi.stubGlobal('EventSource', FakeSource);
});

afterEach(() => {
	vi.unstubAllGlobals();
	vi.useRealTimers();
});

describe('a watched stream to the Wheelhouse server', () => {
	it('says the server is lost when a dropped stream does not come back', () => {
		const stop = watch();
		last().open();
		expect(states).toEqual(['open']);

		last().drop();
		expect(states.at(-1)).toBe('connecting');
		vi.advanceTimersByTime(LOST_AFTER_MS - 1);
		expect(states.at(-1)).toBe('connecting');
		vi.advanceTimersByTime(1);
		expect(states.at(-1)).toBe('lost');

		// The browser's own retries keep failing: still lost, not flickering back.
		last().drop();
		last().drop();
		expect(states.at(-1)).toBe('lost');

		// The server answers again on the same stream.
		last().open();
		expect(states.at(-1)).toBe('open');
		expect(FakeSource.all).toHaveLength(1);
		stop();
	});

	it('does not call a short blip lost', () => {
		const stop = watch();
		last().open();
		last().drop();
		vi.advanceTimersByTime(1000);
		last().open();
		vi.advanceTimersByTime(LOST_AFTER_MS * 2);
		expect(states).toEqual(['open', 'connecting', 'open']);
		stop();
	});

	it('opens a fresh stream when the browser gives up on one, until the server answers', () => {
		const stop = watch();
		last().open();
		const first = last();
		first.fail();
		expect(states.at(-1)).toBe('lost');
		expect(FakeSource.all).toHaveLength(1);

		vi.advanceTimersByTime(REOPEN_MS);
		expect(FakeSource.all).toHaveLength(2);
		expect(last().url).toBe('/api/events');
		// Each new stream gets the caller's handlers.
		expect(listened).toEqual([first, last()]);

		last().fail();
		vi.advanceTimersByTime(REOPEN_MS);
		expect(FakeSource.all).toHaveLength(3);
		last().open();
		expect(states.at(-1)).toBe('open');
		stop();
	});

	it('stops trying once closed', () => {
		const stop = watch();
		last().fail();
		stop();
		vi.advanceTimersByTime(REOPEN_MS * 10);
		expect(FakeSource.all).toHaveLength(1);

		const stop2 = watch();
		last().drop();
		stop2();
		vi.advanceTimersByTime(LOST_AFTER_MS * 2);
		expect(states.at(-1)).toBe('connecting');
		expect(last().readyState).toBe(FakeSource.CLOSED);
	});
});
