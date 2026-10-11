import type { Available } from '../types';

/**
 * The plugin contract the UI sees: fixed slots, typed blocks, and the entries
 * the server fills them with. Shared by the server and the browser; the
 * server-side plugin interface lives in `$lib/server/plugins/types.ts`.
 */

/** Where a plugin can contribute. The set is fixed; plugins cannot add slots. */
export const SLOTS = [
	'project.tab',
	'harbour.card',
	'task.section',
	'step.evidence',
	'bridge.card'
] as const;

export type Slot = (typeof SLOTS)[number];

/** What a slot is about, and so which providers can fill it. */
export type Scope = 'fleet' | 'project' | 'task';

export const SLOT_SCOPE: Record<Slot, Scope> = {
	'project.tab': 'project',
	'harbour.card': 'project',
	'task.section': 'task',
	'step.evidence': 'task',
	'bridge.card': 'fleet'
};

export type Tone = 'ok' | 'warn' | 'fail' | 'pending' | 'unknown';

/**
 * Built-in typed blocks, each a versioned schema. Wheelhouse renders them with
 * its own components; a block it does not know renders as a plain fallback.
 * Links and images accept only http(s) URLs or same-origin paths.
 */
export type Block =
	| { block: 'text.v1'; text: string; muted?: boolean }
	| { block: 'kv.v1'; items: { key: string; value: string; href?: string }[] }
	| { block: 'table.v1'; columns: string[]; rows: (string | { text: string; href: string })[][] }
	| { block: 'links.v1'; links: { label: string; href: string; note?: string }[] }
	| { block: 'image.v1'; src: string; alt: string; href?: string }
	| { block: 'status.v1'; tone: Tone; label: string; detail?: string }
	| {
			block: 'graph.v1';
			nodes: { id: string; label: string; kind?: string }[];
			edges: { from: string; to: string; label?: string }[];
	  }
	| { block: 'unknown'; type: string; preview: string };

export type BlockType = Exclude<Block['block'], 'unknown'>;

/** How an entry is drawn: built-in blocks, or a first-party plugin's own Svelte panel. */
export type Render = { blocks: true } | { component: string };

/** One plugin contribution, filled for one project or task, ready to render. */
export interface SlotEntry {
	/** Unique per page: `<plugin>/<contribution>`, plus `@<project>` for per-project entries. */
	key: string;
	slot: Slot;
	pluginId: string;
	contributionId: string;
	title: string;
	/** Sort order within the slot (lower first). */
	order: number;
	/** step.evidence: the passage step it sits under; task.section: the step it follows, if any. */
	step: string | null;
	/** The project an entry belongs to (project-scoped slots). */
	projectId: string | null;
	render: Render;
	/**
	 * For `blocks`, the value is `Block[]`; for a component, whatever its
	 * provider returned. bridge.card values are `BridgeCard[]`.
	 */
	content: Available<unknown>;
}

/** A Bridge card: shown under a Firstmate reply that contains one of its URLs exactly. */
export interface BridgeCard {
	key: string;
	title: string;
	mentions: string[];
	blocks: Block[];
}

export interface SlotView {
	schema: 'wheelhouse-slots.v1';
	entries: SlotEntry[];
}

export interface PluginStatus {
	id: string;
	name: string;
	version: string;
	apiVersion: number;
	state: 'loaded' | 'refused';
	/** Why the plugin was refused, in plain words. */
	reason: string | null;
	slots: Slot[];
	enabledByDefault: boolean;
	/** On by default only for projects whose clone has this file. */
	enabledWhenFile: string | null;
}

export interface PluginsView {
	schema: 'wheelhouse-plugins.v1';
	/** Plugin contract versions this Wheelhouse supports. */
	supported: number[];
	/** The captain-owned enablement file, and why it could not be used, if it could not. */
	config: { file: string | null; error: string | null };
	plugins: PluginStatus[];
	/** Effective enablement per project id, for the projects Wheelhouse knows. */
	enabled: Record<string, string[]>;
}
