import type { Item } from './fold';

/**
 * Routine progress in the chat: Firstmate's reports from its supervision
 * rounds (turns a task-notification wake started, already finished) fold, a
 * run at a time, into one line ("3 updates · latest: … · 13:58") that opens
 * in place. A report that asks something (a form, or Claude Code's question
 * picker) is never folded, and anything else shown between reports ends the
 * run; what another thread hides does not. Pure, so it is unit-tested.
 */
export interface ProgressRun {
	/** The first report's id: where the line is drawn, and its key. */
	first: string;
	ids: string[];
	/** The latest report's first line. */
	latest: string;
	at: string;
}

const MAX = 120;

/** A reply's first line, as plain words. */
export function firstWords(text: string): string {
	const line =
		text
			.replace(/```[\s\S]*?```/g, ' ')
			.split('\n')
			.map((l) =>
				l
					.replace(/^\s*(?:[-*+]|\d+[.)]|#{1,6})\s+/, '')
					.replace(/[*_`>]/g, '')
					.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
					.trim()
			)
			.find(Boolean) ?? '';
	return line.length > MAX ? `${line.slice(0, MAX - 1).trimEnd()}…` : line;
}

/**
 * The runs of routine progress, by every report's id. `shown`: whether an
 * item shows at all (another thread's are left out); `asks`: the text parts
 * that carry a form; `breaks`: items something else (a decision, a feedback
 * list) is drawn just before.
 */
export function progressRuns(
	items: Item[],
	shown: (id: string) => boolean,
	asks: (partId: string) => boolean,
	breaks: (index: number) => boolean
): Map<string, ProgressRun> {
	const out = new Map<string, ProgressRun>();
	let run: Item[] = [];
	const close = () => {
		const last = run[run.length - 1];
		if (last && last.kind === 'turn') {
			const texts = last.parts.flatMap((p) => (p.kind === 'text' ? [p.text] : []));
			const r: ProgressRun = {
				first: run[0].id,
				ids: run.map((x) => x.id),
				latest: firstWords(texts[texts.length - 1] ?? ''),
				at: last.at
			};
			for (const x of run) out.set(x.id, r);
		}
		run = [];
	};
	items.forEach((it, i) => {
		if (!shown(it.id)) return;
		if (breaks(i)) close();
		const routine =
			it.kind === 'turn' &&
			it.trigger === 'background' &&
			it.done &&
			it.parts.some((p) => p.kind === 'text' && p.text.trim()) &&
			!it.parts.some((p) => p.kind === 'question' || (p.kind === 'text' && asks(p.id)));
		if (routine) run.push(it);
		else close();
	});
	close();
	return out;
}
