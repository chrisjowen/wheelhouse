import type { Ref } from '$lib/chat/refs';

/** Lets a rail card's "Chat about this" hand a reference to the composer. */
export const composerBus = $state<{ pending: Ref | null }>({ pending: null });
