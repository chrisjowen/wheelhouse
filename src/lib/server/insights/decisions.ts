import type { Verdict } from '../../types';
import { roundId, type AskedQuestion, type QuestionRound } from '../../buildlog';
import type { StatusLine } from './timing';

/**
 * Review questions Firstmate answered on the captain's behalf.
 *
 * A worker raises the automated review's ask-user findings as a
 * `needs-decision` status keyed `nm-<run>-<step>…`, naming a findings file;
 * Firstmate answers with a `resolved … answered: …` line on the same key.
 * Only `nm-` keys count: keys such as `board-review` carry the captain's own
 * words and are never shown here. The status line keeps only the start of
 * the answer, so the full text is taken from the worker's handled inbox
 * message when it still exists, with the operational instructions to the
 * worker removed.
 */

export interface Finding {
	id: string;
	severity: string | null;
	file: string | null;
	line: string | null;
	description: string;
}

export interface RawDecision {
	key: string;
	step: string;
	askedAt: number;
	decidedAt: number;
	findingsFile: string | null;
	findingIds: string[];
	/** The answer as the status line has it (possibly cut short). */
	answer: string;
}

/** A round of review questions put to Firstmate, answered or not yet. */
export interface RawRound extends Omit<RawDecision, 'decidedAt' | 'answer'> {
	decidedAt: number | null;
	answer: string | null;
	/** Closed by a `resolved` line that carries no answer (the worker moved on). */
	closed: boolean;
}

const FINDINGS = /findings=(\S+)\s+file=(.+?\.txt)\b/;
const STEP = /-(review|test|document|lint|ci)(?:-|$)/;
const CUT = /\s*\[truncated\]\s*$/;

/** Every `nm-` question round, in the order asked, with Firstmate's answer on the same key once it lands. */
export function pairRounds(statuses: StatusLine[]): RawRound[] {
	const open = new Map<string, RawRound>();
	const out: RawRound[] = [];
	for (const s of [...statuses].sort((a, b) => a.ts - b.ts)) {
		const key = s.key ?? '';
		if (!key.startsWith('nm-')) continue;
		if (s.state === 'needs-decision') {
			// Raised again while still open: the same questions.
			if (open.has(key)) continue;
			const m = FINDINGS.exec(s.text);
			const round: RawRound = {
				key,
				step: STEP.exec(key)?.[1] ?? 'review',
				askedAt: s.ts,
				findingsFile: m?.[2] ?? null,
				findingIds: m ? m[1].split(',').filter(Boolean) : [],
				decidedAt: null,
				answer: null,
				closed: false
			};
			open.set(key, round);
			out.push(round);
		} else if (s.state === 'resolved' && open.has(key)) {
			const round = open.get(key)!;
			const text = s.text.replace(/^answered:\s*/i, '');
			if (!/^answered:/i.test(s.text) || text.replace(CUT, '').trim().length < 3) {
				// An acknowledgement or a placeholder: a real answer may still follow.
				round.closed = true;
				continue;
			}
			round.decidedAt = s.ts;
			round.answer = text;
			round.closed = false;
			open.delete(key);
		}
	}
	return out;
}

/** Pair each `nm-` question with Firstmate's answer on the same key. */
export function pairDecisions(statuses: StatusLine[]): RawDecision[] {
	return pairRounds(statuses)
		.filter((r) => r.answer !== null)
		.map(({ key, step, askedAt, decidedAt, findingsFile, findingIds, answer }) => ({
			key,
			step,
			askedAt,
			decidedAt: decidedAt!,
			findingsFile,
			findingIds,
			answer: answer!
		}));
}

/** Findings files: blocks of `key: value` lines separated by blank lines. */
export function parseFindings(text: string): Finding[] {
	const out: Finding[] = [];
	for (const block of text.split(/\n\s*\n/)) {
		const f: Record<string, string> = {};
		let last: string | null = null;
		for (const l of block.split('\n')) {
			const m = /^(\w+):\s?(.*)$/.exec(l);
			if (m) {
				f[m[1]] = m[2];
				last = m[1];
			} else if (last === 'description' && l.trim()) {
				f.description += ' ' + l.trim();
			}
		}
		if (f.id) {
			out.push({
				id: f.id,
				severity: f.severity || null,
				file: f.file || null,
				line: f.line || null,
				description: (f.description ?? '').trim()
			});
		}
	}
	return out;
}

const OPS =
	/\s*(In the same response|Run:? no-mistakes|Run: |Keep driving|Do not use --yes|Respond (?:through|via|to|at) the (?:active )?gate|If a finding needs a product decision)[\s\S]*$/;

/** The answer is cut short; find the full text in the worker's inbox messages (read or not yet). */
export function fullAnswer(answer: string, messages: string[]): { text: string; cut: boolean } {
	const cut = CUT.test(answer);
	const head = answer.replace(CUT, '').trim();
	if (cut) {
		const probe = head.slice(0, 60);
		for (const msg of messages) {
			const body =
				msg
					.split(/\n--\n/)
					.slice(1)
					.join('\n--\n')
					.trim() || msg.trim();
			if (probe && body.startsWith(probe))
				return { text: body.replace(OPS, '').trim(), cut: false };
		}
	}
	return { text: head.replace(OPS, '').trim(), cut };
}

/** The call in an answer: Firstmate writes it in capitals (FIX, KEEP, NO CHANGE, DEFER). */
export function verdictOf(text: string): Verdict {
	const none = /\bNO (?:CODE )?CHANGES?\b/.test(text) || /\bDISCARD\b/.test(text);
	const fix = /\bFIX\b/.test(text) || /:\s*fix it\b/i.test(text);
	const keep = /\bKEEP\b/.test(text) || /keep the omission/i.test(text);
	const defer = /\bDEFER/.test(text) || (!fix && !keep && !none && /\bdefer/i.test(text));
	if ([fix, keep, defer, none].filter(Boolean).length > 1) return 'Mixed';
	return fix ? 'Fix it' : keep ? 'Keep as is' : none ? 'No change' : defer ? 'Defer' : 'Decided';
}

/** Drop the leading call word and keep plain sentences. */
function reasonOf(s: string): string {
	return s
		.replace(/^\s*[-:–—,.]*\s*/, '')
		.replace(/^(FIX|KEEP|DEFER\w*|DISCARD|NO (?:CODE )?CHANGES?)\b(\s+it)?[\s.:,;–—-]*/i, '')
		.replace(/^by\s+/i, 'By ')
		.replace(/\s+/g, ' ')
		.trim()
		.replace(/[\s;,]+$/, '')
		.replace(/^./, (c) => c.toUpperCase());
}

/** The lead-in Firstmate puts before its calls: "Decision for key … (run …, step review), finding x:". */
const PREAMBLE =
	/^(?:Round-\d+\s+)?Decisions?\s+(?:for|on)\s+(?:key\s+\S+(?:\s*\([^)]*\))?|(?:[^:(]|\([^)]*\)){0,200})(?:,\s*findings?\b)?\s*:?\s*/i;

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * One call per raised finding. Firstmate names each finding by its id, in
 * several shapes ("- a: FIX. …", "F3 FIX - …", "finding a: KEEP …"); the text
 * from one id to the next is that finding's call. A finding the answer does not
 * name takes the lead-in ("FIX both."); a single-finding answer applies whole.
 */
export function callsFor(answer: string, findings: Finding[]) {
	const body = answer.replace(PREAMBLE, '');
	if (findings.length <= 1) {
		const own = findings[0] ? body.replace(idAt(findings[0].id, true), '') : body;
		return findings.map((f) => ({ finding: f, verdict: verdictOf(own), reason: reasonOf(own) }));
	}
	const marks: { id: string; at: number; end: number }[] = [];
	for (const f of findings) {
		// Prefer the id where a call starts (after a dash, a stop or the start); else anywhere.
		const m = idAt(f.id, false).exec(body) ?? new RegExp(`\\b${escape(f.id)}\\b`).exec(body);
		if (!m) continue;
		const start = m.index + m[0].indexOf(f.id);
		// The stop before an id ends the call before it.
		const at = m.index + (/^[.;]/.test(m[0]) ? 1 : 0);
		marks.push({ id: f.id, at, end: start + f.id.length });
	}
	marks.sort((x, y) => x.at - y.at);
	const parts = new Map(
		marks.map((k, i) => [k.id, body.slice(k.end, marks[i + 1]?.at ?? body.length)])
	);
	const lead = marks.length ? body.slice(0, marks[0].at) : body;
	return findings.map((f) => {
		const own = parts.get(f.id);
		const text = own && own.replace(/^[\s:–—-]*/, '').trim() ? own : lead;
		return { finding: f, verdict: verdictOf(text), reason: reasonOf(text) };
	});
}

/** A finding id where a call starts: at the start, or after a dash, stop, semicolon or "finding". */
function idAt(id: string, anchored: boolean): RegExp {
	const at = `(?:^|[.;]\\s+|\\s-\\s*|\\bfindings?\\s+|\\(\\d+\\)\\s*)`;
	return new RegExp(`${anchored ? '^' : at}${escape(id)}(?![\\w-])\\s*:?`);
}

/** The first sentence of a finding, for its one-line summary. */
export function gist(f: Finding): string {
	if (!f.description) return f.id.replace(/[-_]+/g, ' ');
	const first = f.description.split(/(?<=[.!?])\s/)[0];
	return first.length > 220 ? first.slice(0, 217).trimEnd() + '…' : first;
}

/** The headline call: the shared one, else Mixed. */
export function overall(verdicts: Verdict[]): Verdict {
	const set = new Set(verdicts);
	return set.size === 1 ? verdicts[0] : set.size === 0 ? 'Decided' : 'Mixed';
}

const RAISED_IN: Record<string, string> = {
	review: 'the automated review',
	test: 'the tests',
	document: 'the docs check',
	lint: 'the code style check',
	ci: 'CI'
};

/** Text without Firstmate's internals: decision keys, run ids and paths in its home. */
export function scrub(text: string, homeDir: string | null): string {
	let s = text;
	if (homeDir) {
		const home = homeDir.replace(/\/+$/, '');
		s = s.split(home + '/').join('');
	}
	return s
		.replace(/\bnm-[0-9A-Z]{26}[\w-]*/g, 'the review')
		.replace(/\s*\(?\brun:?\s+[0-9A-Z]{26}\b\)?/g, '')
		.replace(/\b[0-9A-Z]{26}\b/g, '')
		.replace(/`([^`]*)`/g, '$1')
		.replace(/[ \t]+/g, ' ')
		.trim();
}

/** A question in a sentence or two: its first sentence, and the next when the first is short. */
export function summary(f: Finding): string {
	if (!f.description) return f.id.replace(/[-_]+/g, ' ');
	const sentences = f.description.replace(/`([^`]*)`/g, '$1').split(/(?<=[.!?])\s+/);
	let s = sentences[0];
	if (s.length < 90 && sentences[1] && s.length + sentences[1].length < 240)
		s += ' ' + sentences[1];
	return s.length > 240 ? s.slice(0, 237).trimEnd() + '…' : s;
}

/** Where a finding is, in plain words: "src/lib/export.ts, line 23". Never a path in Firstmate's home. */
export function whereOf(f: Finding, homeDir: string | null): string | null {
	let file = f.file?.trim() || null;
	if (
		file &&
		(file.startsWith('/') || file.startsWith('~') || (homeDir && file.startsWith(homeDir)))
	)
		file = file.split('/').pop() || null;
	const line = f.line && /^\d+(?:-\d+)?$/.test(f.line.trim()) ? f.line.trim() : null;
	if (!file) return line ? `line ${line}` : null;
	return line ? `${file}, line ${line}` : file;
}

/**
 * Each review round put to Firstmate, newest first: every question in plain
 * words, waiting or answered, with Firstmate's call on each once it lands.
 * `findingsOf` gives a round's parsed findings file; `messages` are the
 * worker's inbox messages, for the full text of an answer the ledger cut short.
 */
export function questionRounds(
	rounds: RawRound[],
	findingsOf: (file: string | null) => Finding[],
	messages: string[],
	homeDir: string | null
): QuestionRound[] {
	const out: QuestionRound[] = [];
	for (const r of rounds) {
		const all = findingsOf(r.findingsFile);
		const raised = r.findingIds.map(
			(id) =>
				all.find((f) => f.id === id) ?? {
					id,
					severity: null,
					file: null,
					line: null,
					description: ''
				}
		);
		if (!raised.length) continue;
		const answer = r.answer === null ? null : fullAnswer(r.answer, messages);
		const calls = answer ? callsFor(answer.text, raised) : null;
		const status: AskedQuestion['status'] = answer ? 'answered' : r.closed ? 'closed' : 'waiting';
		const id = roundId(r.key, r.askedAt);
		out.push({
			id,
			raisedIn: RAISED_IN[r.step] ?? 'the automated review',
			askedAt: new Date(r.askedAt * 1000).toISOString(),
			answeredAt: r.decidedAt === null ? null : new Date(r.decidedAt * 1000).toISOString(),
			status,
			answerCut: !!answer?.cut,
			questions: raised.map((f, i) => {
				const sum = scrub(summary(f), homeDir);
				const detail = scrub(f.description, homeDir);
				const call = calls?.[i];
				return {
					id: `${id}-${i}`,
					summary: sum,
					detail: detail && detail.replace(/…$/, '') !== sum.replace(/…$/, '') ? detail : null,
					where: whereOf(f, homeDir),
					serious: f.severity === 'error',
					status,
					verdict: call?.verdict ?? null,
					reason: call ? scrub(call.reason, homeDir) || null : null
				};
			})
		});
	}
	return out.reverse();
}
