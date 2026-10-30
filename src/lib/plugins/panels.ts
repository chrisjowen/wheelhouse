import type { Component } from 'svelte';
import VaultPanel from '$lib/components/wh/vault/VaultPanel.svelte';
import type { SlotEntry } from './types';

/**
 * Svelte panels Wheelhouse draws for compiled-in plugins and plugins bundled
 * with it, keyed by the `render.component` name their contributions use. A
 * panel receives its provider's value as `data`. A name missing here renders a
 * plain notice.
 */
export type Panel = Component<{ data: unknown; entry: SlotEntry }>;

export const PANELS: Record<string, Panel> = {
	'vault/overview': VaultPanel as Panel
};
