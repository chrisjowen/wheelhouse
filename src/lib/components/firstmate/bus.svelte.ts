import type { Ref } from '$lib/chat/refs';

/**
 * Lets a rail card's "Chat about this" hand a reference to the composer, and
 * a link (`/?chat=<id>&draft=<text>`, e.g. "I'd decide differently") start the
 * message with some words after it. Nothing is sent until the captain sends it.
 * `decision` (from `/?decision=<card id>`, a decision's Chat about this) brings
 * that decision's card into view in the chat with its discussion open, once the
 * chat has its transcript (firstmateChat.synced): until then the card can still
 * move to where it was asked, further up.
 */
export const composerBus = $state<{
	pending: Ref | null;
	draft: string | null;
	decision: string | null;
}>({
	pending: null,
	draft: null,
	decision: null
});
