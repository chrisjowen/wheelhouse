import { extractUrls } from '$lib/bridge';
import type { Block, BridgeCard, SlotEntry, Tone } from './types';

/**
 * Validation for plugin output. Every block a provider returns passes through
 * normalizeBlocks on the server before it reaches a page: unknown fields are
 * dropped, strings and lists are capped, and a link or image that is not
 * http(s) or a same-origin path loses its URL. A block type Wheelhouse does not
 * know becomes an `unknown` block, which renders as a plain fallback.
 */

export const LIMITS = {
	blocks: 24,
	items: 200,
	columns: 12,
	text: 4000,
	field: 400,
	cards: 50,
	mentions: 20
} as const;

const TONES: readonly Tone[] = ['ok', 'warn', 'fail', 'pending', 'unknown'];

const isRecord = (v: unknown): v is Record<string, unknown> =>
	typeof v === 'object' && v !== null && !Array.isArray(v);

const str = (v: unknown, max: number = LIMITS.field): string | null =>
	typeof v === 'string' ? (v.length > max ? `${v.slice(0, max - 1)}…` : v) : null;

const list = (v: unknown, max: number = LIMITS.items): unknown[] =>
	Array.isArray(v) ? v.slice(0, max) : [];

/** The URL if it is http(s) or a same-origin path (`/x`, not `//host`), else null. */
export function safeHref(v: unknown): string | null {
	if (typeof v !== 'string' || v.length > 2048) return null;
	if (v.startsWith('/') && !v.startsWith('//') && !v.startsWith('/\\')) return v;
	try {
		const u = new URL(v);
		return u.protocol === 'http:' || u.protocol === 'https:' ? v : null;
	} catch {
		return null;
	}
}

function preview(v: unknown): string {
	let s: string;
	try {
		s = JSON.stringify(v) ?? String(v);
	} catch {
		s = String(v);
	}
	return s.length > 300 ? `${s.slice(0, 299)}…` : s;
}

function unknownBlock(v: unknown, type: string): Block {
	return { block: 'unknown', type, preview: preview(v) };
}

function one(v: unknown): Block {
	if (!isRecord(v)) return unknownBlock(v, typeof v);
	const type = typeof v.block === 'string' ? v.block : '(none)';
	switch (type) {
		case 'text.v1': {
			const text = str(v.text, LIMITS.text);
			if (text === null) break;
			return v.muted === true
				? { block: 'text.v1', text, muted: true }
				: { block: 'text.v1', text };
		}
		case 'kv.v1':
			return {
				block: 'kv.v1',
				items: list(v.items).flatMap((i) => {
					if (!isRecord(i)) return [];
					const key = str(i.key);
					const value = str(i.value);
					if (key === null || value === null) return [];
					const href = safeHref(i.href);
					return [href ? { key, value, href } : { key, value }];
				})
			};
		case 'table.v1': {
			const columns = list(v.columns, LIMITS.columns).map((c) => str(c) ?? '');
			const rows = list(v.rows).map((r) =>
				list(r, columns.length || LIMITS.columns).map((c) => {
					if (isRecord(c)) {
						const text = str(c.text) ?? '';
						const href = safeHref(c.href);
						return href ? { text, href } : text;
					}
					return str(c) ?? (typeof c === 'number' ? String(c) : '');
				})
			);
			return { block: 'table.v1', columns, rows };
		}
		case 'links.v1':
			return {
				block: 'links.v1',
				links: list(v.links).flatMap((l) => {
					if (!isRecord(l)) return [];
					const label = str(l.label);
					const href = safeHref(l.href);
					if (label === null || href === null) return [];
					const note = str(l.note);
					return [note ? { label, href, note } : { label, href }];
				})
			};
		case 'image.v1': {
			const src = safeHref(v.src);
			if (!src) break;
			const href = safeHref(v.href);
			const alt = str(v.alt) ?? '';
			return href ? { block: 'image.v1', src, alt, href } : { block: 'image.v1', src, alt };
		}
		case 'status.v1': {
			const label = str(v.label);
			if (label === null) break;
			const tone = TONES.includes(v.tone as Tone) ? (v.tone as Tone) : 'unknown';
			const detail = str(v.detail, LIMITS.text);
			return detail
				? { block: 'status.v1', tone, label, detail }
				: { block: 'status.v1', tone, label };
		}
		case 'graph.v1': {
			const nodes = list(v.nodes).flatMap((n) => {
				if (!isRecord(n)) return [];
				const id = str(n.id);
				if (id === null) return [];
				const kind = str(n.kind);
				const label = str(n.label) ?? id;
				return [kind ? { id, label, kind } : { id, label }];
			});
			const ids = new Set(nodes.map((n) => n.id));
			const edges = list(v.edges).flatMap((e) => {
				if (!isRecord(e)) return [];
				const from = str(e.from);
				const to = str(e.to);
				if (from === null || to === null || !ids.has(from) || !ids.has(to)) return [];
				const label = str(e.label);
				return [label ? { from, to, label } : { from, to }];
			});
			return { block: 'graph.v1', nodes, edges };
		}
	}
	return unknownBlock(v, type);
}

/** Validated blocks, or why the value is not a block list. */
export function normalizeBlocks(
	v: unknown
): { ok: true; blocks: Block[] } | { ok: false; reason: string } {
	if (!Array.isArray(v)) return { ok: false, reason: 'the plugin did not return a list of blocks' };
	return { ok: true, blocks: v.slice(0, LIMITS.blocks).map(one) };
}

/** Validated Bridge cards (bridge.card values), or why the value is not a card list. */
export function normalizeCards(
	v: unknown
): { ok: true; cards: BridgeCard[] } | { ok: false; reason: string } {
	if (!Array.isArray(v)) return { ok: false, reason: 'the plugin did not return a list of cards' };
	const cards = v.slice(0, LIMITS.cards).flatMap((c): BridgeCard[] => {
		if (!isRecord(c)) return [];
		const key = str(c.key);
		const title = str(c.title);
		if (key === null || title === null) return [];
		const mentions = list(c.mentions, LIMITS.mentions).flatMap((m) => {
			const href = safeHref(m);
			return href && !href.startsWith('/') ? [href] : [];
		});
		const blocks = normalizeBlocks(c.blocks);
		return mentions.length
			? [{ key, title, mentions, blocks: blocks.ok ? blocks.blocks : [] }]
			: [];
	});
	return { ok: true, cards };
}

/**
 * Plugin cards a Firstmate reply refers to: only cards one of whose URLs
 * appears in the reply exactly, as the Bridge matches task cards. Nothing is
 * guessed from names or ids.
 */
export function matchBridgeCards(
	text: string,
	entries: SlotEntry[]
): { entry: SlotEntry; card: BridgeCard }[] {
	const urls = new Set(extractUrls(text));
	if (!urls.size) return [];
	const out: { entry: SlotEntry; card: BridgeCard }[] = [];
	for (const entry of entries) {
		if (entry.slot !== 'bridge.card' || !entry.content.available) continue;
		for (const card of entry.content.value as BridgeCard[]) {
			if (card.mentions.some((m) => urls.has(m))) out.push({ entry, card });
		}
	}
	return out;
}
