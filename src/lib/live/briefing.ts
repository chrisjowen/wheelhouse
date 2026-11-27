import { parseReply } from './reply';

/**
 * The Captain's briefing from a Live mode discussion, as it travels: the
 * message Firstmate receives (sent the moment the call ends), how the chat
 * knows that message again (it shows the briefing alone, never the call), and
 * the discussion itself kept in a few words a line, so the briefing can show
 * it again on request. Pure, so it is unit-tested.
 */

const LEAD = 'Captain’s briefing from a Live mode discussion';
const HEAD = new RegExp(`^${LEAD} \\((\\d+) min\\):\\s*`);

/** The briefing as the captain's message, with the hand-offs still waiting attached. */
export function briefMessage(b: {
	minutes: number;
	briefing: string | null;
	handoffs: string[];
}): string {
	const handoffs = b.handoffs.length
		? `## Hand-offs from the call\n${b.handoffs.map((n) => `- ${n.replace(/\s+/g, ' ')}`).join('\n')}`
		: '';
	return [`${LEAD} (${b.minutes} min):`, b.briefing ?? '', handoffs].filter(Boolean).join('\n\n');
}

/** A chat message read back as a Live briefing, or null when it is not one. */
export function readBrief(text: string): { minutes: number; body: string } | null {
	const m = HEAD.exec(text.trimStart());
	if (!m) return null;
	return { minutes: Number(m[1]), body: text.trimStart().slice(m[0].length).trim() };
}

/** A short, stable key for a briefing's words, whatever spacing the chat gave them back. */
export function briefKey(body: string): string {
	const s = body.replace(/\s+/g, ' ').trim().slice(0, 4000);
	let h = 5381;
	for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
	return `${(h >>> 0).toString(36)}-${s.length}`;
}

export interface SaidLine {
	who: 'captain' | 'crew';
	at: string;
	text: string;
}

type Entry =
	| { kind: 'captain'; at: string; text: string; pending: boolean }
	| { kind: 'crew'; at: string; text: string }
	| { kind: string; at: string };

/** What was said in a call, in order: the captain's words and the crew's prose (its drawings left out). */
export function discussionOf(entries: readonly Entry[]): SaidLine[] {
	const out: SaidLine[] = [];
	for (const e of entries) {
		if (e.kind === 'captain' && 'pending' in e && !e.pending && e.text.trim())
			out.push({ who: 'captain', at: e.at, text: e.text.trim() });
		else if (e.kind === 'crew' && 'text' in e) {
			const prose = parseReply(e.text)
				.flatMap((p) => (p.type === 'prose' ? [p.text.trim()] : []))
				.filter(Boolean)
				.join('\n\n');
			if (prose) out.push({ who: 'crew', at: e.at, text: prose });
		}
	}
	return out;
}

/** The discussions kept in this browser, by briefing key; the newest `keep` stay. */
export type Kept = Record<string, { at: number; lines: SaidLine[] }>;

export function keepDiscussion(
	kept: Kept,
	key: string,
	lines: SaidLine[],
	now: number,
	keep = 8
): Kept {
	const all = { ...kept, [key]: { at: now, lines } };
	const newest = Object.entries(all)
		.sort((a, b) => b[1].at - a[1].at)
		.slice(0, keep);
	return Object.fromEntries(newest);
}

/** Kept discussions read back from storage; anything malformed is dropped. */
export function parseKept(raw: string | null): Kept {
	try {
		const v = JSON.parse(raw ?? '{}') as unknown;
		if (!v || typeof v !== 'object' || Array.isArray(v)) return {};
		const out: Kept = {};
		for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
			const r = x as { at?: unknown; lines?: unknown };
			if (typeof r?.at !== 'number' || !Array.isArray(r.lines)) continue;
			const lines = r.lines.filter(
				(l): l is SaidLine =>
					!!l &&
					(l.who === 'captain' || l.who === 'crew') &&
					typeof l.text === 'string' &&
					typeof l.at === 'string'
			);
			out[k] = { at: r.at, lines };
		}
		return out;
	} catch {
		return {};
	}
}
