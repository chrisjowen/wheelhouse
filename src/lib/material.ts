/**
 * Settings → Agent material: what Wheelhouse installs for Firstmate and its
 * crew, one row per thing the captain can turn on or off
 * (src/lib/server/material/settings.ts).
 */

export const MATERIAL_GROUPS = [
	'manage-wheelhouse',
	'wheelhouse-preview',
	'wheelhouse-passage',
	'brief',
	'context'
] as const;
export type MaterialGroup = (typeof MATERIAL_GROUPS)[number];

export interface MaterialRow {
	group: MaterialGroup;
	title: string;
	detail: string;
	on: boolean;
	/** Why it cannot be turned on here, or null. */
	unavailable: string | null;
	/** Each copy as the last sync left it. */
	items: { id: string; state: string; target: string }[];
}

export interface MaterialView {
	/** disabled: this Wheelhouse installs nothing (a development server, or turned off by its environment). */
	state: 'ok' | 'attention' | 'disabled' | 'error' | 'unknown';
	message: string | null;
	rows: MaterialRow[];
	drift: { file: string; marker: string }[];
}
