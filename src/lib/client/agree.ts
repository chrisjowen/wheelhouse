import type { FormAnswer } from '$lib/decisionform';
import type { InboxCard } from '$lib/inbox';
import { inbox } from './inbox.svelte';

/** Send one answer from a decision's form: its choice, with the picks or words it carries. */
export const answerWith = (card: InboxCard, a: FormAnswer, note: string | null, token: string) =>
	inbox.answer(card, a.choice, note, token, a.picks, a.decided, a.partial);
