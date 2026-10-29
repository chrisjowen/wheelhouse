import { goto } from '$app/navigation';
import { ALERT_KINDS, raiseKey, stillHolds, taskHref } from '$lib/bell';
import { sendToInbox } from '$lib/client/chat.svelte';
import { live, type AlertEvent } from '$lib/client/live.svelte';
import { strike } from '$lib/client/chime';
import type { AlertAction, AlertKind, ShipAlert } from '$lib/types';

/**
 * The ship's bell in the browser: toasts for the alerts the server raises, an
 * optional bell sound and, when no Wheelhouse tab is in front, a browser
 * notification.
 *
 * Every tab shows the toasts. The tab holding the browser's one stream (see
 * live.svelte.ts) decides whether an alert is news: it records each raise it
 * rings in localStorage, so a raise rings once across tabs and reloads.
 * The tab the captain is looking at rings; when none is, the leader rings and
 * shows the notification. Dismissing a toast dismisses it in every tab.
 *
 * Settings live in this browser (localStorage): sound and notifications are
 * off until the captain turns them on, and each kind of alert can be muted.
 */

export interface BellSettings {
	sound: boolean;
	notify: boolean;
	kinds: Record<AlertKind, boolean>;
}

export interface Toast {
	alert: ShipAlert;
	/** It rang when it arrived (else it was shown again quietly, e.g. after a reload). */
	fresh: boolean;
}

export type NoteState =
	{ state: 'sending' } | { state: 'sent' } | { state: 'failed'; error: string };

const SETTINGS_KEY = 'wheelhouse-bell';
const SEEN_KEY = 'wheelhouse-bell-seen';
const DISMISSED_KEY = 'wheelhouse-bell-dismissed';
const CHANNEL = 'wheelhouse-bell';
/** How many raises this browser remembers as rung, and as dismissed. */
const KEEP_IDS = 400;
/** The bell menu lists this many recent alerts. */
const LOG_SIZE = 12;
/** At most this many toasts are kept (the oldest news goes first); the stack shows fewer (Toasts.svelte). */
const MAX_TOASTS = 12;
/** How long the leader waits for a tab in front to ring before it rings itself. */
const RING_WAIT_MS = 400;

export const DEFAULT_SETTINGS: BellSettings = {
	sound: false,
	notify: false,
	kinds: { 'pr-green': true, question: true, stuck: true, landed: true, issue: true }
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
	toasts = $state<Toast[]>([]);
	/** Recent alerts, newest first, for the bell menu. */
	log = $state<ShipAlert[]>([]);
	/** Alerts that rang since the bell menu was last opened. */
	unread = $state(0);
	permission = $state<NotificationPermission | 'unsupported'>('default');
	notes = $state<Record<string, NoteState>>({});

	private dismissed: string[] = [];
	/** The time of the latest raise this tab has had of each alert id. */
	private raisedAt = new Map<string, number>();
	private rang = new Set<string>();
	private channel: BroadcastChannel | null = null;
	private started = false;

	start(): () => void {
		if (this.started) return () => {};
		this.started = true;
		this.settings = parseSettings(read(SETTINGS_KEY, null));
		this.dismissed = read<string[]>(DISMISSED_KEY, []);
		this.permission = typeof Notification === 'undefined' ? 'unsupported' : Notification.permission;
		live.claim = (alert) => {
			const seen = read<string[]>(SEEN_KEY, []);
			const fresh = addId(seen, raiseKey(alert));
			if (fresh) write(SEEN_KEY, seen);
			return fresh;
		};
		const off = live.onAlert((e) => this.receive(e));
		const storage = (e: StorageEvent) => {
			if (e.key === SETTINGS_KEY) this.settings = parseSettings(read(SETTINGS_KEY, null));
			if (e.key === DISMISSED_KEY) {
				this.dismissed = read<string[]>(DISMISSED_KEY, []);
				this.toasts = this.toasts.filter((t) => !this.dismissed.includes(raiseKey(t.alert)));
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
			this.toasts = this.toasts.filter((t) => t.alert.id !== e.data);
			return;
		}
		const list = e.type === 'alert' ? [{ alert: e.data, fresh: e.fresh }] : e.data;
		for (const { alert, fresh } of list) {
			const at = Date.parse(alert.at);
			if (at < (this.raisedAt.get(alert.id) ?? -Infinity)) continue;
			this.raisedAt.set(alert.id, at);
			this.log = [alert, ...this.log.filter((a) => a.id !== alert.id)]
				.sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
				.slice(0, LOG_SIZE);
			const key = raiseKey(alert);
			if (!this.settings.kinds[alert.kind] || this.dismissed.includes(key)) continue;
			if (this.toasts.some((t) => raiseKey(t.alert) === key)) continue;
			if (fresh) {
				this.unread++;
				this.show({ alert, fresh });
				this.ring(alert);
			} else if (alert.captain && stillHolds(alert, live.fleet)) {
				this.show({ alert, fresh });
			}
		}
	}

	private show(toast: Toast): void {
		const next = [...this.toasts.filter((t) => t.alert.id !== toast.alert.id), toast];
		// Too many: let the oldest news go, keeping what waits on the captain.
		while (next.length > MAX_TOASTS) {
			const i = next.findIndex((t) => !t.alert.captain);
			next.splice(i === -1 ? 0 : i, 1);
		}
		this.toasts = next;
	}

	/** Close a toast here and in every other tab, for good. */
	dismiss(alert: ShipAlert): void {
		const key = raiseKey(alert);
		this.toasts = this.toasts.filter((t) => raiseKey(t.alert) !== key);
		const list = read<string[]>(DISMISSED_KEY, []);
		if (addId(list, key)) write(DISMISSED_KEY, list);
		this.dismissed = list;
	}

	/** Close a news toast in this tab only (it timed out). */
	expire(id: string): void {
		this.toasts = this.toasts.filter((t) => t.alert.id !== id || t.alert.captain);
	}

	/** Drop captain toasts whose moment has passed (the PR merged, the question was answered). */
	prune(): void {
		const fleet = live.fleet;
		if (!fleet) return;
		const keep = this.toasts.filter((t) => stillHolds(t.alert, fleet));
		if (keep.length !== this.toasts.length) this.toasts = keep;
	}

	update(change: Partial<BellSettings>): void {
		this.settings = { ...this.settings, ...change };
		write(SETTINGS_KEY, this.settings);
	}

	setKind(kind: AlertKind, on: boolean): void {
		this.update({ kinds: { ...this.settings.kinds, [kind]: on } });
		if (!on) this.toasts = this.toasts.filter((t) => t.alert.kind !== kind);
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

	opened(): void {
		this.unread = 0;
	}

	/**
	 * Do an alert's action: open its page or link, or send Firstmate the
	 * captain's note (which needs the page's session token).
	 */
	async act(action: AlertAction, token = ''): Promise<void> {
		if (action.kind === 'open') {
			if (action.external) window.open(action.href, '_blank', 'noopener,noreferrer');
			else await goto(action.href);
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
				void goto(open?.kind === 'open' ? open.href : alert.taskId ? taskHref(alert.taskId) : '/');
				n.close();
			};
		} catch {
			// some browsers allow notifications only from a service worker
		}
	}
}

export const bell = new Bell();
