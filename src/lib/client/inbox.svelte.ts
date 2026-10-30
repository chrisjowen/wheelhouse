import {
	SNOOZE_KEY,
	SNOOZE_MS,
	awaitsAnswer,
	liveSnoozes,
	openCount,
	parseSnoozes,
	picksLine,
	visibleCards,
	type InboxAction,
	type InboxCard,
	type InboxView,
	type Picks,
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
	 * Cards answered or closed here whose answer the server has not shown back
	 * yet, by card id, with the question they answered. Each is hidden at once,
	 * from every list; an answer that is not taken puts its card back with the
	 * reason. A taken one (posted) stays hidden until the server's view shows
	 * the answer, or the question closes or changes.
	 */
	pending = $state<
		Record<
			string,
			{
				choice: InboxAction;
				picks: string | null;
				note: string | null;
				question: string;
				posted: boolean;
			}
		>
	>({});
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
			const view = (await r.json()) as InboxView;
			this.value = view;
			// Answers still on their way stay; taken ones until the server shows them answered.
			const open = (id: string, question: string) =>
				view.cards.some((c) => c.id === id && c.question === question && !c.sent);
			this.pending = Object.fromEntries(
				Object.entries(this.pending).filter(([id, p]) => !p.posted || open(id, p.question))
			);
		} catch {
			// keep the last view; the next read may work
		}
	}

	/**
	 * The view, else the one the page loaded (`seed`), so a page drawn on the
	 * server, where this is never set, already shows the decisions it will show.
	 */
	view(seed?: InboxView | null): InboxView | null {
		return this.value ?? seed ?? null;
	}

	/** The cards as the server shows them, without those answered or closed here. */
	cards(seed?: InboxView | null): InboxCard[] {
		return (this.view(seed)?.cards ?? []).filter(
			(c) => this.pending[c.id]?.question !== c.question
		);
	}

	shown(now: number, seed?: InboxView | null) {
		return visibleCards(this.cards(seed), this.snoozed, now);
	}

	open(now: number): number {
		return openCount(this.cards(), this.snoozed, now);
	}

	/** A task's questions still waiting, snoozed or not, without its merge call. */
	forTask(taskId: string, seed?: InboxView | null): InboxCard[] {
		return this.cards(seed).filter(
			(c) => c.taskId === taskId && c.kind !== 'merge' && awaitsAnswer(c)
		);
	}

	/** Whether the inbox has a question on a task other than its merge call, answered or not. */
	hasDecision(taskId: string, seed?: InboxView | null): boolean {
		const view = this.view(seed);
		return !!view?.available && view.cards.some((c) => c.taskId === taskId && c.kind !== 'merge');
	}

	later(id: string) {
		this.snoozed = { ...liveSnoozes(this.snoozed, Date.now()), [id]: Date.now() + SNOOZE_MS };
		this.save();
	}

	/** Show snoozed cards again: one, or all of them. */
	wake(id?: string) {
		if (id && !this.snoozed[id]) return;
		this.snoozed = id
			? Object.fromEntries(Object.entries(this.snoozed).filter(([k]) => k !== id))
			: {};
		this.save();
	}

	private save() {
		try {
			localStorage.setItem(SNOOZE_KEY, JSON.stringify(this.snoozed));
		} catch {
			// storage unavailable; the snooze lasts for this page only
		}
	}

	/** Show why an answer cannot go yet, without sending it. */
	complain(id: string, message: string) {
		this.errors = { ...this.errors, [id]: message };
	}

	/**
	 * Send one answer, or a close, to Firstmate; Approve on a card with choices
	 * carries the picks. Returns whether it was taken.
	 */
	async answer(
		card: InboxCard,
		choice: InboxAction,
		note: string | null,
		token: string,
		picks: Picks | null = null
	): Promise<boolean> {
		const withPicks =
			choice === 'approve' && card.choices ? picksLine(card.choices, picks ?? {}) : null;
		if (withPicks && !withPicks.ok) {
			this.complain(card.id, withPicks.error);
			return false;
		}
		const { [card.id]: _, ...rest } = this.errors;
		void _;
		this.errors = rest;
		const line = withPicks?.ok ? withPicks.line : null;
		this.pending = {
			...this.pending,
			[card.id]: { choice, picks: line, note, question: card.question, posted: false }
		};
		const requestId = `inbox-${crypto.randomUUID()}`;
		try {
			const r = await fetch('/api/inbox', {
				method: 'POST',
				headers: {
					'content-type': 'application/json',
					'idempotency-key': requestId,
					[SESSION_HEADER]: token
				},
				body: JSON.stringify({
					cardId: card.id,
					choice,
					note,
					...(withPicks ? { picks: picks ?? {} } : {})
				})
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
