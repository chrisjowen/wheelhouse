import { alertsFor, raise, sessionAlert, type AlertDraft } from '../../bell';
import type { FirstmateSessionView, FleetView, ShipAlert, TaskStatus } from '../../types';

/**
 * The server's ship's bell: watches each fleet view the collector builds, and
 * the Firstmate session's screen, and raises an alert the first time a moment
 * shows (see lib/bell.ts for the moments). It raises each alert id once while
 * its moment lasts, however many browsers or tabs are open, and forgets it
 * once the moment has passed, so the moment rings again if it comes back; the
 * browser keeps the raises it has rung so a reload never rings one again.
 *
 * The first fleet view, and the first look at the session, are the baseline:
 * what is already true when Wheelhouse starts is on the board, not news, so
 * it rings nothing.
 *
 * A question Firstmate asks in its session is settled when its menu leaves
 * the screen; the bell says so (`settled`), so its toast goes. A task's alert
 * needs no such word: the browser sees from the fleet when its moment passed.
 */

export type BellEvent = { type: 'alert'; data: ShipAlert } | { type: 'settled'; data: string };

/** How many alert ids are remembered before the oldest are forgotten. */
const SEEN_CAP = 5000;
/** How many recent alerts a newly connected page is sent, to catch up. */
const RECENT_CAP = 40;
/** Recent alerts older than this are not sent to a newly connected page. */
const RECENT_MS = 12 * 3600_000;
/** A task first seen already landed rings only when its merge is this recent. */
const LANDED_FRESH_MS = 30 * 60_000;

export class ShipsBell {
	private seen = new Set<string>();
	/** The alert ids each task's records showed at the last read. */
	private showing = new Map<string, Set<string>>();
	private status = new Map<string, TaskStatus>();
	private baselined = false;
	private sessionBaselined = false;
	/** The session question that is open now, if any. */
	private asking: string | null = null;
	private list: ShipAlert[] = [];
	private listeners = new Set<(e: BellEvent) => void>();
	private now: () => number;

	constructor(opts: { now?: () => number } = {}) {
		this.now = opts.now ?? Date.now;
	}

	subscribe(fn: (e: BellEvent) => void): () => void {
		this.listeners.add(fn);
		return () => this.listeners.delete(fn);
	}

	/** Look at a fleet view; returns the alerts it raises (each only once). */
	observe(fleet: FleetView): ShipAlert[] {
		if (!fleet.collectedAt) return [];
		const now = this.now();
		const raised: ShipAlert[] = [];
		for (const task of fleet.tasks) {
			const before = this.status.get(task.id);
			this.status.set(task.id, task.status);
			const drafts = alertsFor(task, now);
			const ids = new Set(drafts.map((d) => d.id));
			for (const id of this.showing.get(task.id) ?? []) if (!ids.has(id)) this.seen.delete(id);
			this.showing.set(task.id, ids);
			for (const draft of drafts) {
				if (this.seen.has(draft.id)) continue;
				this.remember(draft.id);
				if (!this.baselined) continue;
				if (draft.kind === 'landed' && !landedNews(before, task.mergedAt, now)) continue;
				raised.push(raise(draft, new Date(now).toISOString()));
			}
		}
		this.baselined = true;
		this.raise(raised);
		return raised;
	}

	/** Look at the Firstmate session: a new menu waiting on the captain rings; one that left is settled. */
	observeSession(view: FirstmateSessionView): ShipAlert[] {
		const draft = view.picker ? sessionAlert(view.picker) : null;
		const asked = this.asking;
		if (asked && asked !== draft?.id) {
			this.seen.delete(asked);
			this.list = this.list.filter((a) => a.id !== asked);
			this.emit({ type: 'settled', data: asked });
			this.asking = null;
		}
		const raised: ShipAlert[] = [];
		if (draft && !this.seen.has(draft.id)) {
			this.remember(draft.id);
			if (this.sessionBaselined) raised.push(raise(draft, new Date(this.now()).toISOString()));
		}
		if (draft) this.asking = draft.id;
		this.sessionBaselined = true;
		this.raise(raised);
		return raised;
	}

	/**
	 * Ring an alert that is news once and never comes back (a newly watched
	 * issue, see server/issues): raised unless this id already rang, with its
	 * note's request id left as it is, so the note it offers is the one the
	 * caller chose. Whoever calls it decides what is news, and keeps that across
	 * restarts.
	 */
	ring(draft: AlertDraft): ShipAlert | null {
		if (this.seen.has(draft.id)) return null;
		this.remember(draft.id);
		const alert: ShipAlert = { ...draft, at: new Date(this.now()).toISOString() };
		this.raise([alert]);
		return alert;
	}

	/** The latest raise of each alert raised lately and not settled, oldest first, for a page that has just connected. */
	recent(): ShipAlert[] {
		const since = this.now() - RECENT_MS;
		return this.list.filter((a) => Date.parse(a.at) >= since);
	}

	private raise(alerts: ShipAlert[]): void {
		if (!alerts.length) return;
		const ids = new Set(alerts.map((a) => a.id));
		this.list = [...this.list.filter((a) => !ids.has(a.id)), ...alerts].slice(-RECENT_CAP);
		for (const a of alerts) this.emit({ type: 'alert', data: a });
	}

	private emit(e: BellEvent): void {
		for (const fn of this.listeners) {
			try {
				fn(e);
			} catch {
				// a broken subscriber must not stop the bell
			}
		}
	}

	private remember(id: string): void {
		this.seen.add(id);
		if (this.seen.size > SEEN_CAP) {
			const oldest = this.seen.values().next().value;
			if (oldest !== undefined) this.seen.delete(oldest);
		}
	}
}

/**
 * A landed task is news when Wheelhouse saw it before it landed, or its merge
 * is recent: a long-landed task that only now shows up in the backlog is not.
 */
function landedNews(before: TaskStatus | undefined, mergedAt: string | null, now: number): boolean {
	if (before !== undefined && before !== 'landed') return true;
	const at = mergedAt ? Date.parse(mergedAt) : NaN;
	return Number.isFinite(at) && now - at <= LANDED_FRESH_MS;
}
