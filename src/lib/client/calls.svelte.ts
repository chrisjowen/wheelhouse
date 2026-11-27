import {
	SEEN_AFTER_MS,
	SEEN_KEY,
	clearedCalls,
	isSeen,
	parseSeen,
	seenKey,
	waitingCalls,
	type ClearedCall,
	type Seen
} from '$lib/calls';
import type { InboxCard, InboxView } from '$lib/inbox';
import { inbox } from './inbox.svelte';

/**
 * The captain's calls in this browser (lib/calls.ts holds the rules): which
 * they have seen (on screen for a moment, kept in this browser), the calls
 * they saw that cleared themselves (kept until put away), and a call to bring
 * forward in On deck (the chat's "With you ›").
 */
class Calls {
	seen = $state<Seen>({});
	/** Calls the captain saw that cleared themselves, until put away. */
	cleared = $state<ClearedCall[]>([]);
	/** How many cleared themselves before the captain saw them, since this page opened. */
	clearedUnseen = $state(0);
	/** A call On deck should bring into view (and open Needs you for), once. */
	jump = $state<string | null>(null);

	private loaded = false;
	private last: InboxCard[] | null = null;

	load() {
		if (this.loaded) return;
		this.loaded = true;
		try {
			this.seen = parseSeen(localStorage.getItem(SEEN_KEY), Date.now());
		} catch {
			this.seen = {};
		}
	}

	/** The calls waiting on the captain, oldest first. */
	waiting(now: number, seed?: InboxView | null): InboxCard[] {
		return inbox.view(seed)?.available ? waitingCalls(inbox.cards(seed), inbox.snoozed, now) : [];
	}

	/** Waiting calls not on screen yet: the header's quiet count. */
	unseen(now: number, seed?: InboxView | null): InboxCard[] {
		return this.waiting(now, seed).filter((c) => !isSeen(this.seen, c));
	}

	isSeen(c: InboxCard) {
		return isSeen(this.seen, c);
	}

	markSeen(c: InboxCard) {
		if (isSeen(this.seen, c)) return;
		this.seen = { ...parseSeen(JSON.stringify(this.seen), Date.now()), [seenKey(c)]: Date.now() };
		try {
			localStorage.setItem(SEEN_KEY, JSON.stringify(this.seen));
		} catch {
			// storage unavailable: seen for this page only
		}
	}

	/**
	 * The inbox changed: a call the captain saw that left without their answer
	 * stays, cleared; one they never saw is only counted.
	 */
	track(view: InboxView | null) {
		if (!view?.available) return;
		const now = inbox.cards(view);
		if (this.last) {
			const log = new Set((view.answered ?? []).map((a) => a.cardId));
			const gone = clearedCalls(
				this.last.filter((c) => c.owner === 'captain'),
				now,
				this.seen,
				(id) => id in inbox.pending,
				log
			);
			const at = new Date().toISOString();
			const kept = new Set(this.cleared.map((c) => c.card.id));
			this.cleared = [
				...this.cleared,
				...gone.seen.filter((c) => !kept.has(c.id)).map((card) => ({ card, at }))
			];
			this.clearedUnseen += gone.unseen.length;
		}
		// A call asked again is waiting again, not cleared.
		const back = new Set(now.map((c) => c.id));
		if (this.cleared.some((c) => back.has(c.card.id)))
			this.cleared = this.cleared.filter((c) => !back.has(c.card.id));
		this.last = now;
	}

	putAway(id: string) {
		this.cleared = this.cleared.filter((c) => c.card.id !== id);
	}

	/** On deck: bring this call into view. */
	bringForward(id: string) {
		this.jump = id;
	}
}

export const calls = new Calls();

/**
 * Marks a call seen once it has been on screen (half of it showing, in a
 * visible tab) for SEEN_AFTER_MS. `use:seenOnScreen={card}`.
 */
export function seenOnScreen(node: HTMLElement, card: InboxCard | null) {
	let current = card;
	let timer: ReturnType<typeof setTimeout> | undefined;
	let showing = false;
	const arm = () => {
		clearTimeout(timer);
		if (!current || !showing || document.hidden || calls.isSeen(current)) return;
		const c = current;
		timer = setTimeout(() => {
			if (showing && !document.hidden) calls.markSeen(c);
		}, SEEN_AFTER_MS);
	};
	const io =
		typeof IntersectionObserver === 'undefined'
			? null
			: new IntersectionObserver(
					(entries) => {
						// Half of it showing, or (a tall card) enough of it to fill much of the screen.
						showing = entries.some(
							(e) =>
								e.isIntersecting &&
								(e.intersectionRatio >= 0.5 ||
									e.intersectionRect.height >= (e.rootBounds?.height ?? Infinity) * 0.4)
						);
						arm();
					},
					{ threshold: [0, 0.1, 0.25, 0.5, 0.75, 1] }
				);
	io?.observe(node);
	document.addEventListener('visibilitychange', arm);
	return {
		update(next: InboxCard | null) {
			if (next?.id === current?.id && next?.askedAt === current?.askedAt) return;
			current = next;
			arm();
		},
		destroy() {
			clearTimeout(timer);
			io?.disconnect();
			document.removeEventListener('visibilitychange', arm);
		}
	};
}
