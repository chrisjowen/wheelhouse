import { goto } from '$app/navigation';
import { ALERT_KINDS, raiseKey, stillHolds, taskHref } from '$lib/bell';
import { sendToInbox } from '$lib/client/chat.svelte';
import { live, type AlertEvent } from '$lib/client/live.svelte';
import { strike } from '$lib/client/chime';
import type { AlertAction, AlertKind, ShipAlert } from '$lib/types';

/**
 * The ship's bell in the browser: one notifications pane (NotificationsPane)
 * for the alerts the server raises, an optional bell sound and, when no
 * Wheelhouse tab is in front, a browser notification. Nothing pops up over
 * the page: a new alert ticks the bell's count and pulses its dot once.
 *
 * The tab holding the browser's one stream (see live.svelte.ts) decides
 * whether an alert is news: it records each raise it rings in localStorage,
 * so a raise rings once across tabs and reloads. The tab the captain is
 * looking at rings; when none is, the leader rings and shows the
 * notification. What the captain has read, and cleared, is kept in this
 * browser and shared by every tab.
 *
 * Settings live in this browser (localStorage): sound and notifications are
 * off until the captain turns them on, and each kind of alert can be muted
 * (still listed, but it neither counts nor rings).
 */

export interface BellSettings {
	sound: boolean;
	notify: boolean;
	kinds: Record<AlertKind, boolean>;
}

export type NoteState =
	{ state: 'sending' } | { state: 'sent' } | { state: 'failed'; error: string };

const SETTINGS_KEY = 'wheelhouse-bell';
const SEEN_KEY = 'wheelhouse-bell-seen';
/** Raises the captain cleared from the pane (the toasts' old key, so what was dismissed stays gone). */
const CLEARED_KEY = 'wheelhouse-bell-dismissed';
const READ_KEY = 'wheelhouse-bell-read';
const CHANNEL = 'wheelhouse-bell';
/** How many raises this browser remembers as rung, read and cleared. */
const KEEP_IDS = 400;
/** The pane keeps this many recent alerts. */
const LOG_SIZE = 50;
/** The address query that opens the pane (`/?notifications`), for a link straight to it. */
export const PANE_PARAM = 'notifications';
/** How long the leader waits for a tab in front to ring before it rings itself. */
const RING_WAIT_MS = 400;

export const DEFAULT_SETTINGS: BellSettings = {
	sound: false,
	notify: false,
	kinds: {
		'pr-green': true,
		question: true,
		stuck: true,
		landed: true,
		issue: true,
		'events-paused': true,
		health: true
	}
};

export function kindLabel(kind: AlertKind): string {
	return ALERT_KINDS.find((k) => k.kind === kind)?.label ?? kind;
}

function read<T>(key: string, fallback: T): T {
	try {
		const raw = localStorage.getItem(key);
		return raw ? (JSON.parse(raw) as T) : fallback;
	} catch {
		return fallback;
	}
}

function write(key: string, value: unknown): void {
	try {
		localStorage.setItem(key, JSON.stringify(value));
	} catch {
		// storage unavailable: the choice lasts for this page only
	}
}

/** Settings as stored, with any missing or malformed field at its default. */
export function parseSettings(raw: unknown): BellSettings {
	const v = (raw && typeof raw === 'object' ? raw : {}) as Partial<BellSettings>;
	const kinds = { ...DEFAULT_SETTINGS.kinds };
	for (const k of Object.keys(kinds) as AlertKind[]) {
		if (typeof v.kinds?.[k] === 'boolean') kinds[k] = v.kinds[k];
	}
	return {
		sound: v.sound === true,
		notify: v.notify === true,
		kinds
	};
}

/** Add an id to a remembered list, keeping the newest. True when it was not there yet. */
export function addId(list: string[], id: string, keep = KEEP_IDS): boolean {
	if (list.includes(id)) return false;
	list.push(id);
	if (list.length > keep) list.splice(0, list.length - keep);
	return true;
}

class Bell {
	settings = $state<BellSettings>(DEFAULT_SETTINGS);
	/** Recent alerts not cleared, newest first: the pane's list. */
	log = $state<ShipAlert[]>([]);
	/** Raise keys the captain has read. */
	read = $state<string[]>([]);
	/** Session questions the server says were answered: they no longer wait on the captain. */
	settled = $state<string[]>([]);
	/** Counts each new alert that rang, so the bell can pulse once for it. */
	pulse = $state(0);
	/** Whether the pane is open. */
	open = $state(false);
	permission = $state<NotificationPermission | 'unsupported'>('default');
	notes = $state<Record<string, NoteState>>({});

	private cleared: string[] = [];
	/** The time of the latest raise this tab has had of each alert id. */
	private raisedAt = new Map<string, number>();
	private rang = new Set<string>();
	private channel: BroadcastChannel | null = null;
	private started = false;

	/** Alerts not yet read, of the kinds the captain counts. */
	get unread(): number {
		return this.log.filter((a) => this.settings.kinds[a.kind] && !this.isRead(a)).length;
	}

	isRead(alert: ShipAlert): boolean {
		return this.read.includes(raiseKey(alert));
	}

	/** Whether an alert still waits on the captain: a question still open, a PR still green. */
	waiting(alert: ShipAlert): boolean {
		return alert.captain && !this.settled.includes(alert.id) && stillHolds(alert, live.fleet);
	}

	start(): () => void {
		if (this.started) return () => {};
		this.started = true;
		this.settings = parseSettings(read(SETTINGS_KEY, null));
		this.cleared = read<string[]>(CLEARED_KEY, []);
		this.read = read<string[]>(READ_KEY, []);
		this.permission = typeof Notification === 'undefined' ? 'unsupported' : Notification.permission;
		if (new URL(location.href).searchParams.has(PANE_PARAM)) this.open = true;
		live.claim = (alert) => {
			const seen = read<string[]>(SEEN_KEY, []);
			const fresh = addId(seen, raiseKey(alert));
			if (fresh) write(SEEN_KEY, seen);
			return fresh;
		};
		const off = live.onAlert((e) => this.receive(e));
		const storage = (e: StorageEvent) => {
			if (e.key === SETTINGS_KEY) this.settings = parseSettings(read(SETTINGS_KEY, null));
			if (e.key === READ_KEY) this.read = read<string[]>(READ_KEY, []);
			if (e.key === CLEARED_KEY) {
				this.cleared = read<string[]>(CLEARED_KEY, []);
				this.log = this.log.filter((a) => !this.cleared.includes(raiseKey(a)));
			}
		};
		addEventListener('storage', storage);
		if (typeof BroadcastChannel !== 'undefined') {
			this.channel = new BroadcastChannel(CHANNEL);
			this.channel.onmessage = (m: MessageEvent<{ t: 'rang'; id: string }>) => {
				if (m.data?.t === 'rang') this.rang.add(m.data.id);
			};
		}
		return () => {
			off();
			removeEventListener('storage', storage);
			this.channel?.close();
			this.channel = null;
			live.claim = () => true;
			this.started = false;
		};
	}

	receive(e: AlertEvent): void {
		if (e.type === 'settled') {
			if (!this.settled.includes(e.data)) this.settled = [...this.settled, e.data];
			return;
		}
		const list = e.type === 'alert' ? [{ alert: e.data, fresh: e.fresh }] : e.data;
		for (const { alert, fresh } of list) {
			const at = Date.parse(alert.at);
			if (at < (this.raisedAt.get(alert.id) ?? -Infinity)) continue;
			this.raisedAt.set(alert.id, at);
			const key = raiseKey(alert);
			if (this.cleared.includes(key)) continue;
			// Asked again: a session question open once more.
			if (this.settled.includes(alert.id) && fresh)
				this.settled = this.settled.filter((id) => id !== alert.id);
			this.log = [alert, ...this.log.filter((a) => a.id !== alert.id)]
				.sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
				.slice(0, LOG_SIZE);
			if (fresh && this.settings.kinds[alert.kind]) {
				this.pulse++;
				this.ring(alert);
			}
		}
	}

	/** Mark alerts read, here and in every other tab. */
	markRead(...alerts: ShipAlert[]): void {
		const list = read<string[]>(READ_KEY, []);
		let changed = false;
		for (const a of alerts) changed = addId(list, raiseKey(a)) || changed;
		if (changed) write(READ_KEY, list);
		this.read = list;
	}

	/** Every alert in the pane, read. */
	markAllRead(): void {
		this.markRead(...this.log);
	}

	/** Take alerts off the pane, here and in every other tab, for good. */
	clear(...alerts: ShipAlert[]): void {
		const keys = new Set(alerts.map(raiseKey));
		const list = read<string[]>(CLEARED_KEY, []);
		for (const k of keys) addId(list, k);
		write(CLEARED_KEY, list);
		this.cleared = list;
		this.log = this.log.filter((a) => !keys.has(raiseKey(a)));
	}

	/** Clear everything that no longer waits on the captain. */
	clearSettled(): void {
		this.clear(...this.log.filter((a) => !this.waiting(a)));
	}

	update(change: Partial<BellSettings>): void {
		this.settings = { ...this.settings, ...change };
		write(SETTINGS_KEY, this.settings);
	}

	setKind(kind: AlertKind, on: boolean): void {
		this.update({ kinds: { ...this.settings.kinds, [kind]: on } });
	}

	/** Turn notifications on (asking the browser's permission first) or off. */
	async setNotify(on: boolean): Promise<void> {
		if (!on || typeof Notification === 'undefined') {
			this.update({ notify: false });
			return;
		}
		let p = Notification.permission;
		if (p === 'default') p = await Notification.requestPermission();
		this.permission = p;
		this.update({ notify: p === 'granted' });
	}

	setSound(on: boolean): void {
		this.update({ sound: on });
		if (on) strike();
	}

	/**
	 * Do an alert's action: open its page or link (closing the pane for a page
	 * of Wheelhouse's), or send Firstmate the captain's note (which needs the
	 * page's session token).
	 */
	async act(action: AlertAction, token = ''): Promise<void> {
		if (action.kind === 'open') {
			if (action.external) window.open(action.href, '_blank', 'noopener,noreferrer');
			else {
				this.open = false;
				await goto(action.href);
			}
			return;
		}
		const now = this.notes[action.requestId];
		if (now?.state === 'sending' || now?.state === 'sent') return;
		this.notes[action.requestId] = { state: 'sending' };
		const r = await sendToInbox(action.text, token, null, action.requestId);
		this.notes[action.requestId] = r.ok ? { state: 'sent' } : { state: 'failed', error: r.error };
	}

	/**
	 * Ring once across tabs: the tab the captain is looking at rings; else the
	 * leader rings and, since nobody is looking, shows a notification.
	 */
	private ring(alert: ShipAlert): void {
		if (document.visibilityState === 'visible' && document.hasFocus()) {
			if (this.settings.sound) strike();
			this.channel?.postMessage({ t: 'rang', id: raiseKey(alert) });
			return;
		}
		if (!live.leader) return;
		setTimeout(() => {
			if (this.rang.has(raiseKey(alert))) return;
			if (this.settings.sound) strike();
			this.notify(alert);
		}, RING_WAIT_MS);
	}

	private notify(alert: ShipAlert): void {
		if (!this.settings.notify || typeof Notification === 'undefined') return;
		if (Notification.permission !== 'granted') return;
		try {
			const n = new Notification(`${kindLabel(alert.kind)}: ${alert.title}`, {
				body: alert.text,
				tag: alert.id
			});
			// A click opens the alert's page, never a note: merging takes a tap in Wheelhouse.
			const open = alert.actions.find((a) => a.kind === 'open' && !a.external);
			n.onclick = () => {
				window.focus();
				this.markRead(alert);
				void goto(open?.kind === 'open' ? open.href : alert.taskId ? taskHref(alert.taskId) : '/');
				n.close();
			};
		} catch {
			// some browsers allow notifications only from a service worker
		}
	}
}

export const bell = new Bell();
