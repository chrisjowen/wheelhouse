import type { Component } from 'svelte';
import type { SlotEntry } from './types';
import ProjectLinksSummary from './project-links/SummaryCard.svelte';
import DocketChart from './docket/Chart.svelte';

/**
 * Svelte panels that compiled-in, first-party plugins ship, keyed by the
 * `render.component` name their contributions use. A panel receives its
 * provider's value as `data`. A name missing here renders a plain notice.
 */
export type Panel = Component<{ data: unknown; entry: SlotEntry }>;

export const PANELS: Record<string, Panel> = {
	'project-links/summary': ProjectLinksSummary,
	'docket/chart': DocketChart
};
