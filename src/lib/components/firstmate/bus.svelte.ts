import type { Ref } from '$lib/chat/refs';

/**
 * Lets a rail card's "Chat about this" hand a reference to the composer, and
 * a link (`/?chat=<id>&draft=<text>`, e.g. "I'd decide differently") start the
 * message with some words after it. Nothing is sent until the captain sends it.
 *
 * `outgoing` is a message the captain already chose to send from another page
 * (the Spec tab's "Send to Firstmate"): the composer sends it through its usual
 * path as soon as it can, calls `onSent` once delivered, and on failure leaves
 * the text in the box with the reason. `from` links back to where it came from.
 */
export const composerBus = $state<{
	pending: Ref | null;
	draft: string | null;
	outgoing: { text: string; from?: string; onSent?: () => void } | null;
}>({
	pending: null,
	draft: null,
	outgoing: null
});
