import type { BuildInsight } from '../../buildlog';
import type { RecordRef } from '../../prreview';
import type { DecisionView } from '../../types';

/**
 * The task's own records that a "why" may rest on, each with a short label the
 * agent cites (I1 the captain's intent, S1 Firstmate's spec, C1… commits, P1 the
 * PR description, F1… review findings and Firstmate's call on each, Q1… the
 * worker's questions and their answers, N1… what each check step did).
 * Anything not here is not a recorded reason.
 */

export interface TaskRecord extends RecordRef {
	/** What it says, bounded. */
	text: string;
}

export interface RecordInputs {
	brief: string | null;
	commits: { sha: string; subject: string; body: string }[];
	prBody: string | null;
	build: BuildInsight | null;
	decided: DecisionView[];
}

const MAX_TEXT = 6000;
const MAX_COMMITS = 40;
const MAX_FINDINGS = 60;

const cut = (s: string, n = MAX_TEXT) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);
const excerptOf = (s: string) => cut(s.replace(/\s+/g, ' ').trim(), 180);

/**
 * One `##` (or `#`) section of a brief by its heading, without the heading;
 * null when the brief has no such section.
 */
export function briefSection(md: string, heading: RegExp): string | null {
	const lines = md.replace(/\r\n?/g, '\n').split('\n');
	const at = lines.findIndex((l) => /^#{1,3} /.test(l) && heading.test(l.replace(/^#+ /, '')));
	if (at < 0) return null;
	const level = /^#+/.exec(lines[at])![0].length;
	const out: string[] = [];
	for (const l of lines.slice(at + 1)) {
		const m = /^(#+) /.exec(l);
		if (m && m[1].length <= level) break;
		out.push(l);
	}
	const text = out.join('\n').trim();
	return text || null;
}

export function taskRecords(r: RecordInputs): TaskRecord[] {
	const out: TaskRecord[] = [];
	const add = (label: string, name: string, text: string) => {
		const t = cut(text.trim());
		if (t) out.push({ label, name, text: t, excerpt: excerptOf(t) });
	};

	if (r.brief) {
		const intent = briefSection(r.brief, /^captain'?s intent/i);
		const spec = briefSection(r.brief, /^firstmate spec/i);
		if (intent) add('I1', 'Captain’s intent', intent);
		if (spec) add('S1', 'Firstmate’s spec', spec);
		if (!intent && !spec) {
			const task = briefSection(r.brief, /^task\b/i);
			if (task) add('S1', 'The task’s brief', task);
		}
	}

	r.commits.slice(0, MAX_COMMITS).forEach((c, i) => {
		add(
			`C${i + 1}`,
			`Commit ${c.sha.slice(0, 7)}`,
			c.body.trim() ? `${c.subject}\n\n${c.body.trim()}` : c.subject
		);
	});

	if (r.prBody?.trim()) add('P1', 'The pull request’s description', r.prBody);

	let f = 0;
	const conv = r.build?.conversation.available ? r.build.conversation.value : [];
	for (const e of conv) {
		if (e.kind !== 'review') continue;
		for (const q of e.questions) {
			if (f >= MAX_FINDINGS) break;
			const call = q.verdict
				? `\nFirstmate’s call: ${q.verdict}.${q.reason ? ` ${q.reason}` : ''}`
				: '\nNo call recorded.';
			add(
				`F${++f}`,
				q.serious ? 'Review finding (marked serious)' : 'Review finding',
				`${q.where ? `${q.where}: ` : ''}${q.detail ?? q.summary}${call}`
			);
		}
	}
	// Decided-for-you calls the conversation did not carry (e.g. once the inbox is gone).
	if (!f) {
		for (const d of r.decided) {
			for (const c of d.calls) {
				if (f >= MAX_FINDINGS) break;
				add(
					`F${++f}`,
					`Finding from the ${d.step} step`,
					`${c.file ? `${c.file}: ` : ''}${c.detail || c.question}\nFirstmate’s call: ${c.verdict}.${c.reason ? ` ${c.reason}` : ''}`
				);
			}
		}
	}

	let q = 0;
	for (const e of conv) {
		if (e.kind !== 'question' && e.kind !== 'blocked' && e.kind !== 'steer') continue;
		const said = [e.title, e.body].filter(Boolean).join('\n');
		const reply = e.reply ? `\nAnswer: ${e.reply.text}` : '';
		add(
			`Q${++q}`,
			e.kind === 'steer' ? 'Firstmate’s instruction to the worker' : 'The worker’s question',
			`${said}${reply}`
		);
	}

	let n = 0;
	const steps = r.build?.checks.available ? r.build.checks.value.steps : [];
	for (const s of steps) {
		if (!s.notes.length) continue;
		add(`N${++n}`, `What the ${s.label} step did`, s.notes.join('\n'));
	}
	return out;
}

/** The records as the agent reads them. */
export const recordsText = (records: TaskRecord[]) =>
	records.length
		? records.map((r) => `[${r.label}] ${r.name}\n${r.text}`).join('\n\n')
		: '(The task has no records: no brief, commits, description or review findings were found.)';
