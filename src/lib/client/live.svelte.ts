import { page } from '$app/state';
import type { ReviewEvent } from '$lib/prreview';
import type { FleetView, Health, MessagesView, ShipAlert } from '$lib/types';
import { watchedStream, type Connection } from './stream';

/**
 * Live fleet, health, messages, ship's bell alerts and the PR review's answers
 * as they stream, from the server's SSE stream (/api/events). Pages render
 * the server-loaded data first and switch to the live copy once the stream
 * delivers.
 *
 * One stream per browser, not per tab: browsers allow only six connections to
 * a server, and a stream per tab used them up and hung navigation. The tabs
 * elect a leader with a Web Lock; the leader holds the one EventSource and
 * passes every event to the other tabs over a BroadcastChannel. When the
 * leader's tab closes its lock is released and another tab takes over. A
 * browser without Web Locks or BroadcastChannel gives each tab its own stream.
 *
 * The stream also says which server process is answering (`server`). When the
 * stream comes back from a different one - Wheelhouse restarted its server -
 * every tab runs its `onRestart` handlers, so pages reload their data and the
 * new launch's session token without the captain reloading by hand.
 */

export type AlertEvent =
	/** fresh: newly raised, so it rings; else it is shown quietly or not at all. */
	| { type: 'alert'; data: ShipAlert; fresh: boolean }
	/** Recent alerts, for a page that has just connected; fresh as above. */
	| { type: 'alerts'; data: { alert: ShipAlert; fresh: boolean }[] }
	/** A session question was answered: its alert's id. */
	| { type: 'settled'; data: string };

type StreamEvent =
	| { type: 'fleet'; data: FleetView }
	| { type: 'health'; data: Health }
	| { type: 'messages'; data: MessagesView }
	| { type: 'review'; data: ReviewEvent }
	/** Which server process is answering: a new id means Wheelhouse restarted. */
	| { type: 'server'; data: { id: string } }
	| AlertEvent;

type ChannelMessage =
	| { t: 'event'; e: StreamEvent }
	| { t: 'connection'; state: Connection }
	/** A tab that has just opened asks the leader for what it has. */
	| { t: 'hello' };

const CHANNEL = 'wheelhouse-live';
const LOCK = 'wheelhouse-live-leader';
/** A recent alert counts as news, and rings, only when it was raised this lately (a short drop). */
const CATCH_UP_MS = 2 * 60_000;
/** How many recent alerts the leader keeps for tabs that open later (the server sends as many). */
const RECENT_KEPT = 40;

export class Live {
	fleet = $state<FleetView | null>(null);
	health = $state<Health | null>(null);
	messages = $state<MessagesView | null>(null);
	/** Our own connection to the Wheelhouse server (not Firstmate's state). */
	connection = $state<Connection>('connecting');
	/** Ticks every 15 s so relative times stay current. */
	now = $state(Date.now());
	/** Bumps on every fleet event, for pages that refetch detail. */
	revision = $state(0);
	/** This tab holds the browser's one stream. */
	leader = $state(false);

	/**
	 * Set by the ship's bell: called once, in the leader, for each alert the
	 * stream delivers; true when this browser has not rung it before.
	 */
	claim: (alert: ShipAlert) => boolean = () => true;

	// Plumbing, not page state: nothing renders from these.
	// eslint-disable-next-line svelte/prefer-svelte-reactivity
	private alertListeners = new Set<(e: AlertEvent) => void>();
	// eslint-disable-next-line svelte/prefer-svelte-reactivity
	private reviewers = new Set<(e: ReviewEvent) => void>();
	// eslint-disable-next-line svelte/prefer-svelte-reactivity
	private restartListeners = new Set<() => void>();
	/** The server process this page has been talking to. */
	private serverId: string | null = null;
	/** The leader's latest of each event, for tabs that open later. */
	private latest: {
		fleet?: FleetView;
		health?: Health;
		messages?: MessagesView;
		server?: { id: string };
	} = {};
	// eslint-disable-next-line svelte/prefer-svelte-reactivity
	private recentAlerts = new Map<string, ShipAlert>();
	private channel: BroadcastChannel | null = null;
	private stop: (() => void) | null = null;

	/** Alerts as they arrive, in every tab. */
	onAlert(fn: (e: AlertEvent) => void): () => void {
		this.alertListeners.add(fn);
		return () => this.alertListeners.delete(fn);
	}

	/**
	 * PR review updates (`review` events) on this same connection: a feature
	 * that needs live updates listens here rather than opening its own stream.
	 */
	onReview(fn: (e: ReviewEvent) => void): () => void {
		this.reviewers.add(fn);
		return () => this.reviewers.delete(fn);
	}

	/** Called in every tab when the stream comes back from a restarted server. */
	onRestart(fn: () => void): () => void {
		this.restartListeners.add(fn);
		return () => this.restartListeners.delete(fn);
	}

	connect(): () => void {
		if (this.stop) return () => {};
		const clock = setInterval(() => (this.now = Date.now()), 15_000);
		const shared = typeof BroadcastChannel !== 'undefined' && !!globalThis.navigator?.locks;
		const end = shared ? this.share() : this.lead();
		this.stop = () => {
			clearInterval(clock);
			end();
			this.stop = null;
		};
		return this.stop;
	}

	/** Join the browser's shared stream: lead when this tab gets the lock, else follow. */
	private share(): () => void {
		const channel = new BroadcastChannel(CHANNEL);
		this.channel = channel;
		channel.onmessage = (m: MessageEvent<ChannelMessage>) => {
			const msg = m.data;
			if (msg.t === 'hello') {
				if (this.leader) this.replay();
			} else if (msg.t === 'connection') {
				if (!this.leader) this.connection = msg.state;
			} else if (!this.leader) {
				this.apply(msg.e);
			}
		};
		const abort = new AbortController();
		let release = () => {};
		navigator.locks
			.request(LOCK, { signal: abort.signal }, () => {
				const stopStream = this.lead();
				return new Promise<void>((resolve) => {
					release = () => {
						stopStream();
						resolve();
					};
				});
			})
			.catch(() => {
				// aborted: this tab closed before it led
			});
		channel.postMessage({ t: 'hello' } satisfies ChannelMessage);
		return () => {
			abort.abort();
			release();
			channel.close();
			this.channel = null;
		};
	}

	/** Hold the stream: apply each event here and pass it to the other tabs. */
	private lead(): () => void {
		this.leader = true;
		const state = (s: Connection) => {
			this.connection = s;
			this.post({ t: 'connection', state: s });
		};
		const listen = (es: EventSource) => {
			const on = (type: StreamEvent['type'], make: (data: unknown) => StreamEvent) =>
				es.addEventListener(type, (e) => {
					const ev = make(JSON.parse((e as MessageEvent).data));
					this.remember(ev);
					this.apply(ev);
					this.post({ t: 'event', e: ev });
					if (ev.type === 'fleet') state('open');
				});
			on('server', (data) => ({ type: 'server', data: data as { id: string } }));
			on('fleet', (data) => ({ type: 'fleet', data: data as FleetView }));
			on('health', (data) => ({ type: 'health', data: data as Health }));
			on('messages', (data) => ({ type: 'messages', data: data as MessagesView }));
			on('review', (data) => ({ type: 'review', data: data as ReviewEvent }));
			on('alert', (data) => ({
				type: 'alert',
				data: data as ShipAlert,
				fresh: this.claim(data as ShipAlert)
			}));
			on('settled', (data) => ({ type: 'settled', data: data as string }));
			on('alerts', (data) => ({
				type: 'alerts',
				data: (data as ShipAlert[]).map((alert) => {
					const claimed = this.claim(alert);
					return { alert, fresh: claimed && Date.now() - Date.parse(alert.at) <= CATCH_UP_MS };
				})
			}));
		};
		const close = watchedStream('/api/events', listen, state);
		return () => {
			close();
			this.leader = false;
		};
	}

	private remember(ev: StreamEvent): void {
		if (ev.type === 'alert') this.recentAlerts.set(ev.data.id, ev.data);
		else if (ev.type === 'settled') this.recentAlerts.delete(ev.data);
		else if (ev.type === 'alerts')
			for (const a of ev.data) this.recentAlerts.set(a.alert.id, a.alert);
		else if (ev.type === 'review') return;
		else this.latest[ev.type] = ev.data as never;
		for (const id of [...this.recentAlerts.keys()].slice(0, -RECENT_KEPT)) {
			this.recentAlerts.delete(id);
		}
	}

	/** A tab has just opened: send it what the leader has (alerts as old news). */
	private replay(): void {
		this.post({ t: 'connection', state: this.connection });
		if (this.latest.fleet) this.post({ t: 'event', e: { type: 'fleet', data: this.latest.fleet } });
		if (this.latest.health)
			this.post({ t: 'event', e: { type: 'health', data: this.latest.health } });
		if (this.latest.messages)
			this.post({ t: 'event', e: { type: 'messages', data: this.latest.messages } });
		if (this.latest.server)
			this.post({ t: 'event', e: { type: 'server', data: this.latest.server } });
		const alerts = [...this.recentAlerts.values()].map((alert) => ({ alert, fresh: false }));
		this.post({ t: 'event', e: { type: 'alerts', data: alerts } });
	}

	private apply(ev: StreamEvent): void {
		switch (ev.type) {
			case 'fleet':
				this.fleet = ev.data;
				this.revision++;
				this.connection = 'open';
				break;
			case 'health':
				this.health = ev.data;
				break;
			case 'messages':
				this.messages = ev.data;
				break;
			case 'review':
				for (const fn of this.reviewers) fn(ev.data);
				break;
			case 'server': {
				const restarted = this.serverId !== null && this.serverId !== ev.data.id;
				this.serverId = ev.data.id;
				if (restarted) for (const fn of this.restartListeners) fn();
				break;
			}
			default:
				for (const fn of this.alertListeners) fn(ev);
		}
	}

	private post(msg: ChannelMessage): void {
		try {
			this.channel?.postMessage(msg);
		} catch {
			// the channel closed with the tab
		}
	}
}

export const live = new Live();

/** The freshest fleet view: live when connected, else what the server rendered. */
export function currentFleet(): FleetView | null {
	return live.fleet ?? (page.data.fleet as FleetView | undefined) ?? null;
}

export function currentHealth(): Health | null {
	return live.health ?? (page.data.health as Health | undefined) ?? null;
}

export function currentMessages(): MessagesView | null {
	return live.messages ?? (page.data.messages as MessagesView | undefined) ?? null;
}
