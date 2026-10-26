import {
	SNOOZE_KEY,
	SNOOZE_MS,
	liveSnoozes,
	openCount,
	parseSnoozes,
	visibleCards,
	type InboxCard,
	type InboxChoice,
	type InboxView,
	type Snoozed
} from '$lib/inbox';
import { SESSION_HEADER } from './messages';

/**
 * The decision inbox in the browser: seeded by the layout load, re-read from
 * /api/inbox when the fleet or the messages change (coalesced), and the
 * captain's "Ask me later" snoozes, kept in this browser only.
 */
class Inbox {
	value = $state<InboxView | null>(null);
	snoozed = $state<Snoozed>({});
	/** Cards answered here whose answer the server has not shown back yet. */
	pending = $state<Record<string, { choice: InboxChoice; note: string | null }>>({});
	/** Why the latest answer could not be sent, by card id. */
	errors = $state<Record<string, string>>({});

	private timer: ReturnType<typeof setTimeout> | null = null;
	private loaded = false;

	seed(v: InboxView | null | undefined) {
		if (v && !this.value) this.value = v;
	}

	/** Read the snoozes once, in the browser. */
	load() {
		if (this.loaded) return;
		this.loaded = true;
		try {
			this.snoozed = parseSnoozes(localStorage.getItem(SNOOZE_KEY), Date.now());
		} catch {
			this.snoozed = {};
		}
	}

	/** Re-read soon; repeated calls within the window coalesce. */
	refresh(delayMs = 400) {
		if (this.timer) return;
		this.timer = setTimeout(async () => {
			this.timer = null;
			await this.read();
		}, delayMs);
	}

	async read() {
		try {
			const r = await fetch('/api/inbox');
			if (!r.ok) return;
			this.value = (await r.json()) as InboxView;
			// Drop pending answers the server now shows (or whose card has gone).
			const cards = new Map(this.value.cards.map((c) => [c.id, c]));
			const left = Object.entries(this.pending).filter(([id]) => cards.get(id)?.sent === null);
			this.pending = Object.fromEntries(left);
		} catch {
			// keep the last view; the next read may work
		}
	}

	/** The cards with this browser's pending answers applied. */
	cards(): InboxCard[] {
		return (this.value?.cards ?? []).map((c) => {
			const p = this.pending[c.id];
			return p && !c.sent
				? {
						...c,
						sent: {
							choice: p.choice,
							note: p.note,
							at: new Date().toISOString(),
							delivery: 'sending',
							requestId: ''
						}
					}
				: c;
		});
	}

	shown(now: number) {
		return visibleCards(this.cards(), this.snoozed, now);
	}

	open(now: number): number {
		return openCount(this.cards(), this.snoozed, now);
	}

	later(id: string) {
		this.snoozed = { ...liveSnoozes(this.snoozed, Date.now()), [id]: Date.now() + SNOOZE_MS };
		this.save();
	}

	wake() {
		this.snoozed = {};
		this.save();
	}

	private save() {
		try {
			localStorage.setItem(SNOOZE_KEY, JSON.stringify(this.snoozed));
		} catch {
			// storage unavailable; the snooze lasts for this page only
		}
	}

	/** Send one answer to Firstmate. Returns whether it was taken. */
	async answer(
		card: InboxCard,
		choice: InboxChoice,
		note: string | null,
		token: string
	): Promise<boolean> {
		const { [card.id]: _, ...rest } = this.errors;
		void _;
		this.errors = rest;
		this.pending = { ...this.pending, [card.id]: { choice, note } };
		const requestId = `inbox-${crypto.randomUUID()}`;
		try {
			const r = await fetch('/api/inbox', {
				method: 'POST',
				headers: {
					'content-type': 'application/json',
					'idempotency-key': requestId,
					[SESSION_HEADER]: token
				},
				body: JSON.stringify({ cardId: card.id, choice, note })
			});
			if (!r.ok) {
				const body = (await r.json().catch(() => null)) as { message?: string } | null;
				this.fail(card.id, body?.message ?? `Wheelhouse could not send it (${r.status}).`);
				if (r.status === 404) this.refresh(0);
				return false;
			}
			this.refresh(0);
			return true;
		} catch {
			this.fail(card.id, 'Wheelhouse could not be reached. Try again.');
			return false;
		}
	}

	private fail(id: string, message: string) {
		const { [id]: _, ...rest } = this.pending;
		void _;
		this.pending = rest;
		this.errors = { ...this.errors, [id]: message };
	}
}

export const inbox = new Inbox();
