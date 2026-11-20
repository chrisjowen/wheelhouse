/**
 * Scouts from a Live mode discussion. The captain, or the discussion crew with
 * the captain's OK, asks Firstmate for a scout on a question: Wheelhouse sends
 * Firstmate a clearly labelled captain's message carrying a short reference,
 * and asks for the task id `live-scout-<ref>`. The scout is found again by that
 * id, or by the reference in its brief, and its report is brought back into
 * the conversation. Pure, so it is unit-tested.
 */

/** A scout reference: six lowercase hex characters. */
export const SCOUT_REF = /^[0-9a-f]{6}$/;

export const scoutTaskId = (ref: string) => `live-scout-${ref}`;

/** The line Firstmate is asked to keep in the scout's brief. */
export const refLine = (ref: string) => `Live scout ref: ${ref}`;

/** The captain's message asking Firstmate for the scout. */
export function scoutRequest(o: { ref: string; question: string; session: string | null }): string {
	return [
		`Scout request from a Live mode discussion in Wheelhouse${o.session ? ` (session ${o.session.slice(0, 8)})` : ''}.`,
		'',
		'Please dispatch a scout on this question:',
		'',
		...o.question
			.trim()
			.split('\n')
			.map((l) => `> ${l}`),
		'',
		`Give it the task id \`${scoutTaskId(o.ref)}\` if you can, and keep the line "${refLine(o.ref)}" in its brief, so Wheelhouse can bring the report back into the conversation while it is still going.`
	].join('\n');
}

/** Whether a task is the scout with this reference: by its id, or by the reference in its brief. */
export function isScoutFor(ref: string, id: string, brief: string | null): boolean {
	if (id === scoutTaskId(ref) || id.split('@')[0].endsWith(`-${ref}`)) return true;
	return !!brief && brief.includes(refLine(ref));
}

const clip = (s: string, max: number) =>
	s.length > max ? `${s.slice(0, max - 1).replace(/\s+\S*$/, '')}…` : s;

/** Plain text of a Markdown paragraph, for a one-glance summary. */
const plain = (s: string) =>
	s
		.replace(/!\[[^\]]*\]\([^)]*\)/g, '')
		.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
		.replace(/[*_`]+/g, '')
		.replace(/^\s*(?:[-*+]|\d+[.)])\s+/gm, '')
		.replace(/\s+/g, ' ')
		.trim();

/**
 * A report's gist: the first paragraph under a Summary, TL;DR, Answer,
 * Findings or Conclusion heading (or a bold "Summary:" lead), else its first
 * paragraph of prose.
 */
export function reportSummary(report: string, max = 480): string {
	const text = report.replace(/\r\n/g, '\n').replace(/^---\n[\s\S]*?\n---\n/, '');
	const lead = /^\s*\*\*(?:summary|tl;?dr|answer|bottom line)[:.]?\*\*:?\s*(.+)$/im.exec(text);
	if (lead) return clip(plain(lead[1]), max);
	const lines = text.split('\n');
	const heading = (l: string) => /^\s{0,3}#{1,6}\s/.test(l);
	const at = lines.findIndex(
		(l) => heading(l) && /summary|tl;?dr|answer|finding|conclusion|bottom line|verdict/i.test(l)
	);
	if (at >= 0) {
		const para: string[] = [];
		for (const l of lines.slice(at + 1)) {
			if (heading(l) || (!l.trim() && para.length)) break;
			if (l.trim()) para.push(l);
		}
		if (plain(para.join('\n'))) return clip(plain(para.join('\n')), max);
	}
	const blocks = text.split(/\n\s*\n/);
	const prose = (b: string) => !heading(b) && !/^\s*(```|~~~|\||<)/.test(b) && plain(b).length > 0;
	const first = blocks.find(prose);
	return first ? clip(plain(first), max) : '';
}

/** What the discussion crew is told when a scout's report is in. */
export function reportForCrew(o: {
	question: string;
	task: string;
	report: string;
	max?: number;
}): string {
	return `(Wheelhouse, not the captain: the scout report is in for "${clip(o.question, 200)}", from task ${o.task}. Tell the captain the gist in a sentence or two, then carry on the discussion with it. The report:)\n\n${clip(o.report.trim(), o.max ?? 6000)}`;
}
