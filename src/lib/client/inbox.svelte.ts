import {
	SNOOZE_KEY,
	SNOOZE_MS,
	awaitsAnswer,
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
	/**
	 * Cards answered here whose answer the server has not shown back yet; once
	 * the answer is taken (posted), the next read replaces it with the server's view.
	 */
	pending = $state<Record<string, { choice: InboxChoice; note: string | null; posted: boolean }>>(
		{}
	);
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
			// Answers still on their way stay; taken ones now read as the server shows them.
			this.pending = Object.fromEntries(Object.entries(this.pending).filter(([, p]) => !p.posted));
		} catch {
			// keep the last view; the next read may work
		}
	}

	/** The cards with this browser's pending answers applied. */
	cards(): InboxCard[] {
		return (this.value?.cards ?? []).map((c) => {
			const p = this.pending[c.id];
			return p && awaitsAnswer(c)
				? {
						...c,
						sent: {
							choice: p.choice,
							note: p.note,
							at: new Date().toISOString(),
							delivery: 'sending',
							detail: null,
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
		this.pending = { ...this.pending, [card.id]: { choice, note, posted: false } };
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
			const body = (await r.json().catch(() => null)) as {
				message?: { delivery?: string; deliveryDetail?: string | null };
			} | null;
			if (body?.message?.delivery === 'failed') {
				this.fail(
					card.id,
					body.message.deliveryDetail ?? 'Firstmate did not take the answer. Try again.'
				);
				return false;
			}
			const p = this.pending[card.id];
			if (p) this.pending = { ...this.pending, [card.id]: { ...p, posted: true } };
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
