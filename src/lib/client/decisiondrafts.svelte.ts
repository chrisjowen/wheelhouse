import type { Picks } from '$lib/inbox';

/**
 * What talking a decision through in Live mode came to, kept for that
 * decision's form in this browser: the picks by call, the captain's own words
 * by call and a conclusion for a decision without calls. A later outcome adds
 * to an earlier one. The form starts from it; nothing is sent until the
 * captain sends it from the decision.
 */
export interface DecisionDraft {
	picks: Picks;
	words: Record<string, string>;
	answer: string | null;
	/** When it last changed, so a form takes each change once. */
	at: number;
}

class DecisionDrafts {
	byCard = $state<Record<string, DecisionDraft>>({});

	put(cardId: string, o: { picks: Picks; words: Record<string, string>; answer: string | null }) {
		const was = this.byCard[cardId];
		const picks = { ...was?.picks, ...o.picks };
		const words = { ...was?.words, ...o.words };
		// A call settled one way drops what an earlier outcome said of it the other way.
		for (const id of Object.keys(o.words)) delete picks[id];
		for (const id of Object.keys(o.picks)) delete words[id];
		this.byCard = {
			...this.byCard,
			[cardId]: { picks, words, answer: o.answer ?? was?.answer ?? null, at: Date.now() }
		};
	}

	clear(cardId: string) {
		const { [cardId]: _, ...rest } = this.byCard;
		void _;
		this.byCard = rest;
	}
}

export const decisionDrafts = new DecisionDrafts();
