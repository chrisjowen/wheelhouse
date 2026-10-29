import type { InboxCall, InboxChoices, InboxPick } from '../../inbox';

/**
 * The options a question names, read from its free text so the captain can
 * pick one instead of reading them out of the header. Firstmate records a
 * captain call as words, in a few shapes:
 *
 * - lettered: "Pick how … A (recommended): plugin… B: core… C: … If A: ring the bell too?"
 * - numbered calls, each with options: "1) Approach: A … (recommended) or C … 2) First
 *   channel: Discord (recommended) or Telegram.", also "(1) … - yes (rec) / no;" and "Q1: …"
 * - a trailing question after the options, which becomes a yes/no follow-up.
 *
 * It reads conservatively: words without numbered calls, letters or a named
 * recommendation are left alone (null), and the card keeps Approve and Skip.
 */

const REC = /\s*\((?:recommended|rec)\b(?![ -]first)[^)]*\)/gi;
const isRec = (s: string) => new RegExp(REC.source, 'i').test(s);
const REC_FIRST = /\s*\(recommended first\)/i;
const REPORT_PAREN = /\s*\((?:report:\s*)?[^()\s]*\.md\)/gi;
const ASKS_YES_NO =
	/^(?:if [^:?]{1,40}:\s*)?(?:should|shall|do|does|did|is|are|was|were|can|could|will|would|may|must|has|have)\b/i;
const MAX_OPTION = 200;

const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);
const tidy = (s: string) => s.replace(/\s+/g, ' ').trim();
/** Without trailing separators: "… only;" → "… only". Keeps a closing "?". */
const trimEnd = (s: string) => tidy(s).replace(/(?:[\s,;:.–—-]|\s+or)+$/i, '');

/** Bracket depth before each character; stray closers (as in "1)") are ignored. */
function depths(s: string): number[] {
	const out: number[] = [];
	let d = 0;
	for (const ch of s) {
		out.push(d);
		if (ch === '(' || ch === '[') d++;
		else if ((ch === ')' || ch === ']') && d > 0) d--;
	}
	return out;
}

/** Split at matches of `sep` outside brackets. */
function splitTop(s: string, sep: RegExp): string[] {
	const d = depths(s);
	const re = new RegExp(sep.source, sep.flags.includes('g') ? sep.flags : sep.flags + 'g');
	const out: string[] = [];
	let from = 0;
	for (const m of s.matchAll(re)) {
		if (d[m.index] !== 0) continue;
		out.push(s.slice(from, m.index));
		from = m.index + m[0].length;
	}
	out.push(s.slice(from));
	return out;
}

const hasTop = (s: string, sep: RegExp) => splitTop(s, sep).length > 1;

/** Sentences, split after . ? or ! outside brackets when a capital or bracket follows. */
function sentences(s: string): string[] {
	const d = depths(s);
	const out: string[] = [];
	let from = 0;
	for (const m of s.matchAll(/[.?!](?=\s+[A-Z(])/g)) {
		if (d[m.index] !== 0) continue;
		if (/\b(?:e\.g|i\.e|vs|etc)$/i.test(s.slice(from, m.index))) continue;
		out.push(s.slice(from, m.index + 1).trim());
		from = m.index + 1;
	}
	const last = s.slice(from).trim();
	if (last) out.push(last);
	return out;
}

/** The opening words before the calls, without the report it names. */
function introOf(s: string): string {
	return trimEnd(s.replace(REPORT_PAREN, '').replace(REC_FIRST, ''));
}

/* ------------------------------------------------------------ numbered calls */

const NUMBERED = /(?:^|\s)(?:\((\d{1,2})\)|(\d{1,2})\)|Q(\d{1,2})[:.)])\s+/g;

/** The numbered calls ("1) …", "(1) …" or "Q1: …"), counted from one, or null when fewer than two. */
function numbered(s: string): { intro: string; bodies: { n: number; text: string }[] } | null {
	const d = depths(s);
	const marks: { n: number; at: number; end: number }[] = [];
	let style: number | null = null;
	for (const m of s.matchAll(NUMBERED)) {
		const group = [1, 2, 3].find((g) => m[g] !== undefined)!;
		const n = Number(m[group]);
		const at = m.index + (m[0].length - m[0].trimStart().length);
		if (d[at] !== 0 || n !== marks.length + 1) continue;
		if (style !== null && group !== style) continue;
		style = group;
		marks.push({ n, at, end: m.index + m[0].length });
	}
	if (marks.length < 2) return null;
	return {
		intro: s.slice(0, marks[0].at),
		bodies: marks.map((m, i) => ({ n: m.n, text: s.slice(m.end, marks[i + 1]?.at ?? s.length) }))
	};
}

/* ------------------------------------------------------------ lettered options */

const LETTER =
	/(^|[.;,:!?]\s+|\s+or\s+|\s+\/\s+)(?:Option\s+)?(?:\(([A-H])\)|([A-H])(?![\w'’]))(\s*\((?:recommended|rec)\b[^)]*\))?\s*(?:[:)–—-]|\.(?=\s))?\s+/g;

interface Parsed {
	prompt: string | null;
	options: InboxPick[];
	/** Questions after the options. */
	then: string[];
	/** Other words after the options. */
	rest: string[];
}

/** Options lettered A, B, C … (ascending from A, at least two). */
function lettered(body: string): Parsed | null {
	const d = depths(body);
	const marks: { letter: string; at: number; end: number; rec: boolean }[] = [];
	for (const m of body.matchAll(LETTER)) {
		const letter = m[2] ?? m[3];
		const at = m.index + m[1].length;
		if (d[at] !== 0) continue;
		const prev = marks[marks.length - 1];
		if (prev ? letter <= prev.letter : letter !== 'A') continue;
		marks.push({ letter, at, end: m.index + m[0].length, rec: !!m[4] });
	}
	if (marks.length < 2) return null;
	const then: string[] = [];
	const options = marks.map((m, i): InboxPick => {
		let text = body.slice(m.end, marks[i + 1] ? marks[i + 1].at : body.length);
		if (i === marks.length - 1) {
			const parts = sentences(text);
			while (parts.length > 1 && parts[parts.length - 1].endsWith('?')) then.unshift(parts.pop()!);
			text = parts.join(' ');
		}
		const rec = m.rec || isRec(text);
		return {
			id: m.letter,
			label: m.letter,
			detail: trimEnd(text.replace(REC, '')) || null,
			recommended: rec
		};
	});
	const prompt = trimEnd(body.slice(0, marks[0].at));
	return { prompt: prompt || null, options, then, rest: [] };
}

/* ------------------------------------------------------------ worded options */

/**
 * Options in one sentence: "Topic: this (rec) / that", "topic - this, that, or
 * the other", or a question "this or that?". `ambiguous` when more than one is
 * recommended, which means two questions run together.
 */
function worded(
	sentence: string
): { prompt: string | null; options: InboxPick[]; ambiguous: boolean } | null {
	const s = trimEnd(sentence);
	let topic: string | null = null;
	let region = s;
	for (const sep of [/:\s+/, /\s+[–—-]\s+/]) {
		const parts = splitTop(s, sep);
		if (parts.length > 1) {
			topic = parts[0];
			region = s.slice(topic.length).replace(/^\s*(?::|[–—-])\s*/, '');
			break;
		}
	}
	region = region.replace(/\?$/, '');
	let parts: string[];
	if (hasTop(region, /\s+\/\s+/)) parts = splitTop(region, /\s+\/\s+/);
	else if (hasTop(region, /,\s+or\s+/))
		parts = splitTop(region, /,\s+/).map((p) => p.replace(/^or\s+/i, ''));
	else parts = splitTop(region, /\s+or\s+/);
	parts = parts.map(tidy);
	if (parts.length < 2 || parts.some((p) => !p || p.length > MAX_OPTION)) return null;
	const recs = parts.map(isRec);
	return {
		// Without a topic the options are the whole sentence, so it needs no heading of its own.
		prompt: topic ? cap(trimEnd(topic)) : null,
		options: parts.map((p, i) => ({
			id: String(i + 1),
			label: cap(trimEnd(p.replace(REC, ''))),
			detail: null,
			recommended: recs[i]
		})),
		ambiguous: recs.filter(Boolean).length > 1
	};
}

const YES_NO: InboxPick[] = [
	{ id: 'yes', label: 'Yes', detail: null, recommended: false },
	{ id: 'no', label: 'No', detail: null, recommended: false }
];

/** A question as a call: its options when it names them, else yes/no when it asks one, else written. */
function questionCall(id: string, number: number | null, q: string, required: boolean): InboxCall {
	const w = worded(q);
	if (w && !w.ambiguous) {
		// A follow-up keeps its question, which says what it follows.
		const prompt = w.prompt ?? (number === null ? cap(tidy(q)) : null);
		return { id, number, prompt, options: w.options, required };
	}
	const yesNo = !w && q.trim().endsWith('?') && ASKS_YES_NO.test(q.trim());
	return {
		id,
		number,
		prompt: cap(tidy(q)),
		options: yesNo ? YES_NO.map((o) => ({ ...o })) : [],
		required: required && yesNo
	};
}

/** One numbered call's body: lettered options, worded options, or a question. */
function callBody(n: number, body: string): { call: InboxCall; then: string[]; rest: string[] } {
	const id = String(n);
	const l = lettered(body);
	if (l) {
		const call = {
			id,
			number: n,
			prompt: l.prompt && cap(l.prompt),
			options: l.options,
			required: true
		};
		return { call, then: l.then, rest: [] };
	}
	const [first, ...more] = sentences(body);
	const then = more.filter((s) => s.endsWith('?'));
	const rest = more.filter((s) => !s.endsWith('?'));
	const w = worded(first ?? '');
	if (w && !w.ambiguous) {
		const call = { id, number: n, prompt: w.prompt, options: w.options, required: true };
		return { call, then, rest };
	}
	if (w?.ambiguous) {
		return {
			call: { id, number: n, prompt: cap(trimEnd(first)), options: [], required: false },
			then,
			rest
		};
	}
	return { call: questionCall(id, n, first ?? '', true), then, rest };
}

/** When the text says its recommendations come first, a call without one recommends its first option. */
function recommendFirst(calls: InboxCall[]) {
	for (const c of calls) {
		if (c.options.length && !c.options.some((o) => o.recommended) && !isYesNo(c)) {
			c.options[0].recommended = true;
		}
	}
}

const isYesNo = (c: InboxCall) => c.options.length === 2 && c.options[0].id === 'yes';

/** The calls a question asks the captain to make, or null when its words name no options. */
export function choicesIn(text: string | null | undefined): InboxChoices | null {
	const s = tidy(text ?? '');
	if (!s) return null;
	let follow = 0;
	const followUps = (qs: string[]) =>
		qs.map((q) => questionCall(`then-${++follow}`, null, q, false));

	const num = numbered(s);
	if (num) {
		const calls: InboxCall[] = [];
		const after: string[] = [];
		for (const b of num.bodies) {
			const { call, then, rest } = callBody(b.n, b.text);
			calls.push(call, ...followUps(then));
			after.push(...rest);
		}
		if (!calls.some((c) => c.options.length)) return null;
		if (REC_FIRST.test(num.intro)) recommendFirst(calls);
		return { intro: introOf(num.intro), calls, after: after.join(' ') || null };
	}

	const l = lettered(s);
	if (l) {
		const main: InboxCall = {
			id: 'main',
			number: null,
			prompt: null,
			options: l.options,
			required: true
		};
		return { intro: introOf(l.prompt ?? ''), calls: [main, ...followUps(l.then)], after: null };
	}

	// Unnumbered and unlettered: only a sentence that names a recommendation.
	const all = sentences(s);
	const at = all.findIndex(isRec);
	if (at < 0) return null;
	const w = worded(all[at]);
	if (!w || w.ambiguous) return null;
	const before = all.slice(0, at).join(' ');
	const intro = introOf(
		[before, w.prompt ?? (before ? '' : all[at].replace(REC, ''))].filter(Boolean).join(' ')
	);
	const main: InboxCall = {
		id: 'main',
		number: null,
		prompt: null,
		options: w.options,
		required: true
	};
	const later = all.slice(at + 1);
	return {
		intro,
		calls: [main, ...followUps(later.filter((x) => x.endsWith('?')))],
		after: later.filter((x) => !x.endsWith('?')).join(' ') || null
	};
}

/** The report a question names (a Markdown file under data/), as written. */
export function reportIn(text: string | null | undefined): string | null {
	for (const m of (text ?? '').matchAll(/[^\s()'"`]+\.md\b/g)) {
		if (/(?:^|\/)data\/[^/]+\//.test(m[0])) return m[0];
	}
	return null;
}
