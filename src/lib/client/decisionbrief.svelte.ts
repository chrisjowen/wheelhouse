import type { TalkMessage, TalkOption, TalkOutcome, TalkReply } from '$lib/decisiontalk';
import { SESSION_HEADER } from './messages';

/**
 * Each decision's brief (lib/decisiontalk.ts), fetched once in the
 * background as the Decisions page opens it: a line or two summing it up, and
 * the options its question names when its form only has plain answers. The
 * decision shows at once from what the inbox has; the brief fills in when it
 * comes, and is kept for this page's life.
 */
export type Brief =
	| { state: 'loading' }
	| { state: 'ok'; summary: string; options: TalkOption[] }
	| { state: 'failed' };

/** The captain's questions about a decision and the crew's answers, kept while the page is open. */
export interface Thread {
	messages: TalkMessage[];
	thinking: boolean;
	failed: string | null;
	/** What the talk came to, once the captain clearly picked or agreed. */
	outcome: TalkOutcome | null;
}

class Briefs {
	byCard = $state<Record<string, Brief>>({});
	threads = $state<Record<string, Thread>>({});

	thread(cardId: string): Thread {
		return this.threads[cardId] ?? { messages: [], thinking: false, failed: null, outcome: null };
	}

	private set(cardId: string, t: Partial<Thread>) {
		this.threads = { ...this.threads, [cardId]: { ...this.thread(cardId), ...t } };
	}

	/** Ask the crew about a decision: the captain's words go on the thread at once, its answer when it comes. */
	async ask(cardId: string, text: string, options: TalkOption[], token: string) {
		const t = this.thread(cardId);
		if (t.thinking || !text.trim()) return;
		const messages: TalkMessage[] = [...t.messages, { who: 'captain', text: text.trim() }];
		this.set(cardId, { messages, thinking: true, failed: null });
		await this.turn(cardId, messages, options, token);
	}

	/** Try the last question again. */
	async retry(cardId: string, options: TalkOption[], token: string) {
		const t = this.thread(cardId);
		if (t.thinking || t.messages.at(-1)?.who !== 'captain') return;
		this.set(cardId, { thinking: true, failed: null });
		await this.turn(cardId, t.messages, options, token);
	}

	private async turn(
		cardId: string,
		messages: TalkMessage[],
		options: TalkOption[],
		token: string
	) {
		try {
			const r = await fetch('/api/inbox/talk', {
				method: 'POST',
				headers: { 'content-type': 'application/json', [SESSION_HEADER]: token },
				body: JSON.stringify({ cardId, mode: 'ask', options, messages })
			});
			const body = (await r.json().catch(() => null)) as (TalkReply & { message?: string }) | null;
			if (!r.ok || !body?.reply) {
				this.set(cardId, {
					thinking: false,
					failed: body?.message ?? `The crew could not answer (${r.status}).`
				});
				return;
			}
			this.set(cardId, {
				messages: [...messages, { who: 'crew', text: body.reply }],
				thinking: false,
				outcome: body.outcome ?? this.thread(cardId).outcome
			});
		} catch {
			this.set(cardId, { thinking: false, failed: 'Wheelhouse could not be reached. Try again.' });
		}
	}

	/** Start the brief for a decision unless it is under way or done. */
	load(cardId: string, options: TalkOption[], token: string) {
		const have = this.byCard[cardId];
		if (have && have.state !== 'failed') return;
		this.byCard = { ...this.byCard, [cardId]: { state: 'loading' } };
		void fetch('/api/inbox/talk', {
			method: 'POST',
			headers: { 'content-type': 'application/json', [SESSION_HEADER]: token },
			body: JSON.stringify({ cardId, mode: 'brief', options, messages: [] })
		})
			.then(async (r) => {
				const body = (await r.json().catch(() => null)) as TalkReply | null;
				this.byCard = {
					...this.byCard,
					[cardId]:
						r.ok && body?.reply
							? { state: 'ok', summary: body.reply, options: body.options ?? [] }
							: { state: 'failed' }
				};
			})
			.catch(() => {
				this.byCard = { ...this.byCard, [cardId]: { state: 'failed' } };
			});
	}
}

export const briefs = new Briefs();
