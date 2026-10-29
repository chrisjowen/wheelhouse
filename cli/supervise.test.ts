import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { supervise, type ServerChild, type SuperviseOptions } from './supervise';

/** A stand-in server child: the test says when it is ready and how it exits. */
class FakeChild extends EventEmitter implements ServerChild {
	signals: NodeJS.Signals[] = [];
	constructor(
		public port: number,
		public restart: boolean
	) {
		super();
	}
	ready(port = this.port || 4999) {
		this.emit('message', { type: 'ready', port });
	}
	exit(code: number | null, signal: NodeJS.Signals | null = null) {
		this.emit('exit', code, signal);
	}
	kill(signal: NodeJS.Signals = 'SIGTERM') {
		this.signals.push(signal);
		return true;
	}
}

let children: FakeChild[];
let lines: string[];
let ready: number[];

function watch(over: Partial<SuperviseOptions> = {}) {
	return supervise({
		port: 4310,
		start: (port, restart) => {
			const c = new FakeChild(port, restart);
			children.push(c);
			return c;
		},
		onReady: (port) => ready.push(port),
		log: (line) => lines.push(line),
		backoffMs: () => 1000,
		...over
	});
}

const last = () => children[children.length - 1];

beforeEach(() => {
	vi.useFakeTimers();
	children = [];
	lines = [];
	ready = [];
});

afterEach(() => {
	vi.useRealTimers();
});

describe('the watcher around Wheelhouse’s server', () => {
	it('restarts a server that dies, on the port it was listening on', async () => {
		const w = watch({ port: 0 });
		last().ready(51234);
		expect(ready).toEqual([51234]);

		last().exit(null, 'SIGKILL');
		expect(lines.at(-1)).toMatch(/was stopped by SIGKILL; restarting it in 1 s/);
		expect(lines.at(-1)).toContain('Firstmate and its crew are untouched');
		expect(children).toHaveLength(1);
		vi.advanceTimersByTime(1000);
		expect(children).toHaveLength(2);
		expect(last()).toMatchObject({ port: 51234, restart: true });
		expect(children[0].restart).toBe(false);

		last().ready(51234);
		// The browser opens once, for the first server only.
		expect(ready).toEqual([51234]);
		expect(lines.at(-1)).toContain('back on http://127.0.0.1:51234/');

		last().exit(1);
		vi.advanceTimersByTime(1000);
		expect(children).toHaveLength(3);
		w.stop();
		last().exit(0);
		expect(await w.done).toBe(0);
	});

	it('closes with a server that closed on request, without restarting it', async () => {
		const w = watch();
		last().ready();
		last().exit(0);
		expect(await w.done).toBe(0);
		vi.advanceTimersByTime(60_000);
		expect(children).toHaveLength(1);
	});

	it('asks the server to close on Ctrl+C and kills it if it will not', async () => {
		const w = watch({ killAfterMs: 2000 });
		last().ready();
		w.stop();
		expect(last().signals).toEqual(['SIGTERM']);
		vi.advanceTimersByTime(2000);
		expect(last().signals).toEqual(['SIGTERM', 'SIGKILL']);
		last().exit(null, 'SIGKILL');
		expect(await w.done).toBe(0);
		expect(children).toHaveLength(1);
	});

	it('does not restart while closing, even with a restart pending', async () => {
		const w = watch();
		last().ready();
		last().exit(1);
		w.stop();
		expect(await w.done).toBe(0);
		vi.advanceTimersByTime(60_000);
		expect(children).toHaveLength(1);
	});

	it('treats a first server that never listened as a startup failure, not a crash', async () => {
		const w = watch();
		last().exit(1);
		expect(await w.done).toBe(1);
		vi.advanceTimersByTime(60_000);
		expect(children).toHaveLength(1);
		expect(ready).toEqual([]);
	});

	it('gives up on a server that keeps dying', async () => {
		const w = watch({ maxRestarts: 2 });
		last().ready();
		last().exit(1);
		vi.advanceTimersByTime(1000);
		last().exit(1); // a restarted server may die before it listens
		vi.advanceTimersByTime(1000);
		last().exit(1);
		expect(await w.done).toBe(1);
		expect(children).toHaveLength(3);
		expect(lines.at(-1)).toMatch(/failed 3 times within a minute, so Wheelhouse is closing/);
	});

	it('forgets crashes older than the window', async () => {
		const w = watch({ maxRestarts: 1, windowMs: 10_000 });
		last().ready();
		last().exit(1);
		vi.advanceTimersByTime(1000);
		last().ready();
		vi.advanceTimersByTime(20_000);
		last().exit(1);
		vi.advanceTimersByTime(1000);
		expect(children).toHaveLength(3);
		w.stop();
		last().exit(0);
		expect(await w.done).toBe(0);
	});

	it('ignores messages that are not a ready report', () => {
		watch();
		last().emit('message', { type: 'other' });
		last().emit('message', 'ready');
		expect(ready).toEqual([]);
		last().ready();
		expect(ready).toEqual([4310]);
	});
});
