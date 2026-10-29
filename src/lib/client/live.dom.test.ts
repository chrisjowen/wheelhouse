import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FleetView, ShipAlert } from '$lib/types';
import type { AlertEvent } from './live.svelte';

vi.mock('$app/state', () => ({ page: { data: {} } }));
const { Live } = await import('./live.svelte');

/** Tabs of one browser: a BroadcastChannel bus, a Web Lock and the EventSources opened. */
class FakeChannel {
	static open = new Set<FakeChannel>();
	onmessage: ((m: MessageEvent) => void) | null = null;
	constructor(public name: string) {
		FakeChannel.open.add(this);
	}
	postMessage(data: unknown) {
		const copy = structuredClone(data);
		for (const c of FakeChannel.open) {
			if (c !== this && c.name === this.name)
				queueMicrotask(() => c.onmessage?.({ data: copy } as MessageEvent));
		}
	}
	close() {
		FakeChannel.open.delete(this);
	}
}

class FakeLocks {
	held = false;
	waiting: (() => void)[] = [];
	request(_name: string, opts: { signal: AbortSignal }, cb: () => Promise<void>) {
		return new Promise<void>((resolve, reject) => {
			const grant = () => {
				this.held = true;
				void cb().then(() => {
					this.held = false;
					resolve();
					this.waiting.shift()?.();
				});
			};
			if (!this.held) return grant();
			this.waiting.push(grant);
			opts.signal.addEventListener('abort', () => {
				this.waiting = this.waiting.filter((g) => g !== grant);
				reject(new DOMException('aborted', 'AbortError'));
			});
		});
	}
}

class FakeSource {
	static all: FakeSource[] = [];
	static CLOSED = 2;
	readyState = 1;
	listeners = new Map<string, ((e: MessageEvent) => void)[]>();
	constructor(public url: string) {
		FakeSource.all.push(this);
	}
	addEventListener(type: string, fn: (e: MessageEvent) => void) {
		this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn]);
	}
	emit(type: string, data: unknown) {
		for (const fn of this.listeners.get(type) ?? [])
			fn({ data: JSON.stringify(data) } as MessageEvent);
	}
	close() {
		this.readyState = FakeSource.CLOSED;
	}
}

const openSources = () => FakeSource.all.filter((s) => s.readyState !== FakeSource.CLOSED);
const settle = () => new Promise((r) => setTimeout(r, 0));
const fleet = (n: number) =>
	({ schema: 'wheelhouse-fleet.v1', tasks: [], n }) as unknown as FleetView;
const alert = (id: string, at = new Date().toISOString()) => ({ id, at }) as ShipAlert;

beforeEach(() => {
	FakeChannel.open.clear();
	FakeSource.all = [];
	vi.stubGlobal('BroadcastChannel', FakeChannel);
	vi.stubGlobal('EventSource', FakeSource);
	Object.defineProperty(navigator, 'locks', { value: new FakeLocks(), configurable: true });
});

afterEach(() => {
	vi.unstubAllGlobals();
});

describe('one live stream per browser', () => {
	it('lets one tab hold the stream and passes its events to the others', async () => {
		const a = new Live();
		const b = new Live();
		const stopA = a.connect();
		await settle();
		const stopB = b.connect();
		await settle();
		expect(a.leader).toBe(true);
		expect(b.leader).toBe(false);
		expect(openSources()).toHaveLength(1);

		openSources()[0].emit('fleet', fleet(1));
		await settle();
		expect((b.fleet as unknown as { n: number }).n).toBe(1);
		expect(b.connection).toBe('open');

		// A tab opened later gets what the leader has at once.
		const c = new Live();
		const stopC = c.connect();
		await settle();
		expect((c.fleet as unknown as { n: number }).n).toBe(1);
		expect(openSources()).toHaveLength(1);

		// The leader's tab closes: another takes the stream over.
		stopA();
		await settle();
		expect([b.leader, c.leader].filter(Boolean)).toHaveLength(1);
		expect(openSources()).toHaveLength(1);
		stopB();
		stopC();
	});

	it('decides once, in the leader, whether an alert is news, and tells every tab', async () => {
		const a = new Live();
		const b = new Live();
		const claims: string[] = [];
		const seen = new Set<string>();
		for (const t of [a, b])
			t.claim = (x) => {
				claims.push(x.id);
				const fresh = !seen.has(x.id);
				seen.add(x.id);
				return fresh;
			};
		const got: { tab: string; e: AlertEvent }[] = [];
		a.onAlert((e) => got.push({ tab: 'a', e }));
		b.onAlert((e) => got.push({ tab: 'b', e }));
		const stops = [a.connect(), b.connect()];
		await settle();

		const es = openSources()[0];
		es.emit('alert', alert('x'));
		es.emit('alert', alert('x'));
		await settle();
		expect(claims).toEqual(['x', 'x']);
		const alerts = got.filter((g) => g.e.type === 'alert');
		expect(alerts.map((g) => [g.tab, g.e.type === 'alert' && g.e.fresh])).toEqual([
			['a', true],
			['a', false],
			['b', true],
			['b', false]
		]);

		// Catching up after a reconnect: only what was raised moments ago is news.
		got.length = 0;
		const old = new Date(Date.now() - 10 * 60_000).toISOString();
		es.emit('alerts', [alert('y'), alert('z', old)]);
		await settle();
		const caught = got.find((g) => g.tab === 'b' && g.e.type === 'alerts')!.e;
		expect(caught.type === 'alerts' && caught.data.map((d) => [d.alert.id, d.fresh])).toEqual([
			['y', true],
			['z', false]
		]);
		for (const s of stops) s();
	});

	it('falls back to a stream per tab where tabs cannot share one', async () => {
		vi.stubGlobal('BroadcastChannel', undefined);
		const a = new Live();
		const stop = a.connect();
		expect(a.leader).toBe(true);
		expect(openSources()).toHaveLength(1);
		stop();
		expect(openSources()).toHaveLength(0);
	});

	it('tells every tab when the stream comes back from a restarted server', async () => {
		const a = new Live();
		const b = new Live();
		const restarts = { a: 0, b: 0, c: 0 };
		a.onRestart(() => restarts.a++);
		b.onRestart(() => restarts.b++);
		const stops = [a.connect()];
		await settle();
		stops.push(b.connect());
		await settle();

		const es = openSources()[0];
		es.emit('server', { id: 'one' });
		es.emit('fleet', fleet(1));
		// The same server again (a dropped stream that came back): nothing to reload.
		es.emit('server', { id: 'one' });
		await settle();
		expect(restarts).toEqual({ a: 0, b: 0, c: 0 });

		// A tab opened now learns the server it is on without being told it restarted.
		const c = new Live();
		c.onRestart(() => restarts.c++);
		stops.push(c.connect());
		await settle();
		expect(restarts).toEqual({ a: 0, b: 0, c: 0 });

		es.emit('server', { id: 'two' });
		await settle();
		expect(restarts).toEqual({ a: 1, b: 1, c: 1 });
		for (const s of stops) s();
	});
});
