/**
 * The Wheelhouse plugin SDK: the contract constants and small builders for
 * the blocks and results a provider returns. Plain ESM with no dependencies,
 * so a plugin's bundler can inline it into the plugin's server entry. The
 * types are in index.d.ts.
 */

/** The plugin contract version this SDK describes. */
export const PLUGIN_API_VERSION = 1;

/** Where a plugin can contribute. The set is fixed; plugins cannot add slots. */
export const SLOTS = Object.freeze([
	'project.tab',
	'harbour.card',
	'task.section',
	'step.evidence',
	'bridge.card',
	'home.card',
	'header.indicator',
	'nav.page'
]);

/** Returns the plugin unchanged; it only gives an editor the types. */
export const definePlugin = (plugin) => plugin;

/** A provider result Wheelhouse can show. */
export const available = (value, source, observedAt = new Date().toISOString()) => ({
	available: true,
	value,
	source,
	observedAt
});

/** A provider result that says why there is nothing to show. */
export const unavailable = (reason) => ({ available: false, reason });

export const text = (text, o = {}) =>
	o.muted ? { block: 'text.v1', text, muted: true } : { block: 'text.v1', text };
export const kv = (items) => ({ block: 'kv.v1', items });
export const table = (columns, rows) => ({ block: 'table.v1', columns, rows });
export const links = (links) => ({ block: 'links.v1', links });
export const image = (src, alt, href) =>
	href ? { block: 'image.v1', src, alt, href } : { block: 'image.v1', src, alt };
export const status = (tone, label, detail) =>
	detail ? { block: 'status.v1', tone, label, detail } : { block: 'status.v1', tone, label };
export const graph = (nodes, edges) => ({ block: 'graph.v1', nodes, edges });
