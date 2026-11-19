/**
 * The discussion crew's replies in Live mode. A reply is prose, which is
 * spoken and shown, and fenced blocks, which are drawn in the chat and never
 * spoken: a Mermaid diagram, a chart, task or pull request cards, a picture
 * to draw, a note passed on to Firstmate, a scout to send, or what a talk about
 * a decision came to (for its form, never sent by itself). Prose is spoken
 * a sentence at a time as it streams in. Pure, so it is unit-tested.
 */

export type ReplyPart =
	{ type: 'prose'; text: string } | { type: 'block'; lang: string; body: string; closed: boolean };

/** A reply, streamed so far, as prose and blocks; a block still open at the end has `closed: false`. */
export function parseReply(text: string): ReplyPart[] {
	const parts: ReplyPart[] = [];
	let i = 0;
	while (i < text.length) {
		const open = text.indexOf('```', i);
		if (open < 0) {
			parts.push({ type: 'prose', text: text.slice(i) });
			break;
		}
		if (open > i) parts.push({ type: 'prose', text: text.slice(i, open) });
		const nl = text.indexOf('\n', open + 3);
		if (nl < 0) {
			parts.push({
				type: 'block',
				lang: text
					.slice(open + 3)
					.trim()
					.toLowerCase(),
				body: '',
				closed: false
			});
			break;
		}
		const lang = text
			.slice(open + 3, nl)
			.trim()
			.toLowerCase();
		const close = text.indexOf('```', nl + 1);
		if (close < 0) {
			parts.push({ type: 'block', lang, body: text.slice(nl + 1), closed: false });
			break;
		}
		parts.push({ type: 'block', lang, body: text.slice(nl + 1, close), closed: true });
		i = close + 3;
	}
	// A backtick or two at the very end may be the start of a fence still arriving.
	const last = parts[parts.length - 1];
	if (last?.type === 'prose') last.text = last.text.replace(/`{1,2}$/, '');
	return parts;
}

/** The prose that can be spoken now: up to the first block still arriving, parts joined by a space. */
export function speakableProse(text: string): string {
	const out: string[] = [];
	for (const p of parseReply(text)) {
		if (p.type === 'prose') out.push(p.text);
		else if (!p.closed) break;
	}
	return out.join(' ');
}

/**
 * The next whole sentences of `prose` after the first `from` characters, and
 * where they end. With `final` (the reply is complete, or a block follows) the
 * unfinished tail goes too.
 */
export function nextSentences(
	prose: string,
	from: number,
	final: boolean
): { sentences: string[]; to: number } {
	const sentences: string[] = [];
	let rest = prose.slice(from);
	let to = from;
	let m: RegExpExecArray | null;
	const END = /^([\s\S]*?[.!?…:])(["')\]]*)(\s+)(?=\S)/;
	while ((m = END.exec(rest))) {
		sentences.push(m[0]);
		to += m[0].length;
		rest = rest.slice(m[0].length);
	}
	if (final && rest.trim()) {
		sentences.push(rest);
		to += rest.length;
	}
	return { sentences, to };
}

/** Prose as it should be said: no Markdown marks or links, pull requests by name. */
export function forSpeech(text: string): string {
	return text
		.replace(/https?:\/\/\S+/g, 'the link')
		.replace(/[*_`#>]/g, '')
		.replace(/\bPR\s*#?(\d+)/g, 'pull request $1')
		.replace(/#(\d+)/g, 'number $1')
		.replace(/\s+—\s+/g, ', ')
		.trim();
}

const words = (s: string) =>
	s
		.toLowerCase()
		.replace(/[^a-z0-9' ]+/g, ' ')
		.split(/\s+/)
		.filter(Boolean);

/**
 * Whether what the microphone heard is the crew's own voice coming back
 * through the speakers: most of its words are in what the crew is saying.
 */
export function isEcho(heard: string, saying: string): boolean {
	const said = ` ${words(saying).join(' ')} `;
	if (!said.trim()) return false;
	const w = words(heard);
	if (!w.length) return true;
	return w.filter((x) => said.includes(` ${x} `)).length / w.length >= 0.6;
}

export interface ChartSpec {
	type: 'bar' | 'line' | 'doughnut';
	title: string;
	labels: string[];
	series: { name: string; data: number[] }[];
	unit: string | null;
}

export type CardSpec =
	| { kind: 'task'; task: string }
	| { kind: 'pr'; url: string; title: string | null }
	| { kind: 'link'; url: string; title: string | null; note: string | null };

/** What a closed block draws. */
export type Visual =
	| { kind: 'diagram'; code: string; title: string }
	| { kind: 'chart'; spec: ChartSpec }
	| { kind: 'cards'; cards: CardSpec[] }
	| { kind: 'picture'; title: string; prompt: string }
	| { kind: 'passon'; note: string }
	/** `asked`: the captain asked for it, so it goes at once; else the captain decides on the card. */
	| { kind: 'scout'; question: string; asked: boolean }
	/**
	 * What talking a decision through came to, for the captain to send from
	 * its form: picks by call (option id), the captain's own words by call, or
	 * one conclusion for the whole decision.
	 */
	| {
			kind: 'decision';
			decision: string;
			picks: Record<string, string>;
			words: Record<string, string>;
			answer: string | null;
	  }
	| { kind: 'invalid'; lang: string; reason: string; body: string };

const json = (s: string): unknown => {
	try {
		return JSON.parse(s);
	} catch {
		try {
			return JSON.parse(s.replace(/,\s*([}\]])/g, '$1'));
		} catch {
			return null;
		}
	}
};
const str = (v: unknown, max = 300) =>
	typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null;
const web = (v: unknown) => {
	const s = str(v, 2000);
	return s && /^https?:\/\//.test(s) ? s : null;
};

function diagramTitle(code: string): string {
	const t = /%%\s*title:\s*(.+)/i.exec(code) ?? /^\s*title[:\s]+(.+)$/im.exec(code);
	if (t) return t[1].trim().slice(0, 80);
	const first = code.trim().split('\n')[0] ?? '';
	if (/^sequenceDiagram/.test(first)) return 'Sequence';
	if (/^stateDiagram/.test(first)) return 'States';
	if (/^classDiagram/.test(first)) return 'Model';
	if (/^erDiagram/.test(first)) return 'Data model';
	if (/^timeline/.test(first)) return 'Timeline';
	return 'Architecture';
}

/** A closed block as what to draw, or why it cannot be drawn. */
export function readBlock(lang: string, body: string): Visual {
	const bad = (reason: string): Visual => ({ kind: 'invalid', lang, reason, body });
	if (lang === 'mermaid')
		return body.trim()
			? { kind: 'diagram', code: body.trim(), title: diagramTitle(body) }
			: bad('The diagram is empty.');
	const v = json(body);
	const rec = (x: unknown) =>
		x && typeof x === 'object' && !Array.isArray(x) ? (x as Record<string, unknown>) : null;
	if (lang === 'chart') {
		const r = rec(v);
		const labels = Array.isArray(r?.labels) ? r.labels.map((l) => String(l).slice(0, 60)) : null;
		const series = Array.isArray(r?.series)
			? r.series
					.map(rec)
					.filter((s): s is Record<string, unknown> => !!s && Array.isArray(s.data))
					.map((s) => ({
						name: str(s.name, 60) ?? '',
						data: (s.data as unknown[]).map((d) =>
							typeof d === 'number' && Number.isFinite(d) ? d : 0
						)
					}))
			: [];
		if (!r || !labels?.length || !series.length) return bad('The chart data could not be read.');
		const type = r.type === 'line' || r.type === 'doughnut' ? r.type : 'bar';
		return {
			kind: 'chart',
			spec: {
				type,
				title: str(r.title, 80) ?? 'Chart',
				labels,
				series: series.slice(0, 6),
				unit: str(r.unit, 20)
			}
		};
	}
	if (lang === 'card') {
		const list = (Array.isArray(v) ? v : [v]).map(rec).filter(Boolean) as Record<string, unknown>[];
		const cards: CardSpec[] = [];
		for (const c of list.slice(0, 6)) {
			if (str(c.task, 160)) cards.push({ kind: 'task', task: str(c.task, 160)! });
			else if (web(c.pr)) cards.push({ kind: 'pr', url: web(c.pr)!, title: str(c.title, 160) });
			else if (web(c.link ?? c.url))
				cards.push({
					kind: 'link',
					url: web(c.link ?? c.url)!,
					title: str(c.title, 160),
					note: str(c.note)
				});
		}
		return cards.length ? { kind: 'cards', cards } : bad('The card could not be read.');
	}
	if (lang === 'image') {
		const r = rec(v);
		const prompt = str(r?.prompt, 2000) ?? (r ? null : str(body, 2000));
		return prompt
			? { kind: 'picture', title: str(r?.title, 80) ?? 'Picture', prompt }
			: bad('Nothing to draw.');
	}
	if (lang === 'firstmate') {
		const note = str(rec(v)?.note, 600) ?? str(body, 600);
		return note ? { kind: 'passon', note } : bad('Nothing to pass on.');
	}
	if (lang === 'decision') {
		const r = rec(v);
		const decision = str(r?.decision, 200);
		const byCall = (x: unknown, max: number) =>
			Object.fromEntries(
				Object.entries(rec(x) ?? {})
					.slice(0, 30)
					.map(([k, w]) => [k.slice(0, 40), str(w, max)])
					.filter((e): e is [string, string] => !!e[1])
			);
		const picks = byCall(r?.picks, 40);
		const words = byCall(r?.words, 300);
		const answer = str(r?.answer, 300);
		if (!decision) return bad('No decision named.');
		return Object.keys(picks).length || Object.keys(words).length || answer
			? { kind: 'decision', decision, picks, words, answer }
			: bad('Nothing decided.');
	}
	if (lang === 'scout') {
		const r = rec(v);
		const question = str(r?.question, 1200) ?? (r ? null : str(body, 1200));
		return question
			? { kind: 'scout', question, asked: r?.asked === true }
			: bad('No question for the scout.');
	}
	return bad(`Unknown block: ${lang}`);
}
