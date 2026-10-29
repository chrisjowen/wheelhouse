import type { Ref } from '$lib/chat/refs';

/**
 * Lets a rail card's "Chat about this" hand a reference to the composer, and
 * a link (`/?chat=<id>&draft=<text>`, e.g. "I'd decide differently") start the
 * message with some words after it. Nothing is sent until the captain sends it.
 */
export const composerBus = $state<{
	pending: Ref | null;
	draft: string | null;
}>({
	pending: null,
	draft: null
});
