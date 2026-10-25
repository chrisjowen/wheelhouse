import type { Verdict } from '../../types';
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

const FINDINGS = /findings=(\S+)\s+file=(.+?\.txt)\b/;
const STEP = /-(review|test|document|lint|ci)(?:-|$)/;
const CUT = /\s*\[truncated\]\s*$/;

/** Pair each `nm-` question with Firstmate's answer on the same key. */
export function pairDecisions(statuses: StatusLine[]): RawDecision[] {
	const open = new Map<string, Omit<RawDecision, 'decidedAt' | 'answer'>>();
	const out: RawDecision[] = [];
	for (const s of [...statuses].sort((a, b) => a.ts - b.ts)) {
		const key = s.key ?? '';
		if (!key.startsWith('nm-')) continue;
		if (s.state === 'needs-decision') {
			const m = FINDINGS.exec(s.text);
			open.set(key, {
				key,
				step: STEP.exec(key)?.[1] ?? 'review',
				askedAt: s.ts,
				findingsFile: m?.[2] ?? null,
				findingIds: m ? m[1].split(',').filter(Boolean) : []
			});
		} else if (s.state === 'resolved' && open.has(key)) {
			const text = s.text.replace(/^answered:\s*/i, '');
			if (!/^answered:/i.test(s.text) || text.replace(CUT, '').trim().length < 3) continue;
			out.push({ ...open.get(key)!, decidedAt: s.ts, answer: text });
			open.delete(key);
		}
	}
	return out;
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
	/\s*(In the same response|Run:? no-mistakes|Run: |Keep driving|Do not use --yes|If a finding needs a product decision)[\s\S]*$/;

/** The answer is cut short; find the full text in the worker's handled inbox messages. */
export function fullAnswer(answer: string, handled: string[]): { text: string; cut: boolean } {
	const cut = CUT.test(answer);
	const head = answer.replace(CUT, '').trim();
	if (cut) {
		const probe = head.slice(0, 60);
		for (const msg of handled) {
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

/** The call in an answer: Firstmate writes it in capitals (FIX, KEEP, DEFER). */
export function verdictOf(text: string): Verdict {
	const fix = /\bFIX\b/.test(text) || /:\s*fix it\b/i.test(text);
	const keep = /\bKEEP\b/.test(text) || /keep the omission/i.test(text);
	const defer = /\bDEFER/.test(text) || (!fix && !keep && /\bdefer/i.test(text));
	if ([fix, keep, defer].filter(Boolean).length > 1) return 'Mixed';
	return fix ? 'Fix it' : keep ? 'Keep as is' : defer ? 'Defer' : 'Decided';
}

/** Drop the leading call word and keep plain sentences. */
function reasonOf(s: string): string {
	return s
		.replace(/^\s*(FIX|KEEP|DEFER)\b(\s+it)?[\s.:,-]*/i, '')
		.replace(/^by\s+/i, 'By ')
		.replace(/\s+/g, ' ')
		.trim()
		.replace(/^./, (c) => c.toUpperCase());
}

/**
 * One call per raised finding: an answer like "- a: FIX. … - b: KEEP …" is
 * split by finding id; a single-finding answer applies whole.
 */
export function callsFor(answer: string, findings: Finding[]) {
	const body = answer.replace(/^Decisions? on (?:[^:(]|\([^)]*\)){0,200}:\s*/i, '');
	if (findings.length <= 1) {
		return findings.map((f) => ({ finding: f, verdict: verdictOf(body), reason: reasonOf(body) }));
	}
	const marks: { id: string; at: number; end: number }[] = [];
	const re = /(?:^|\s)-\s*([\w.-]+):\s*/g;
	let m: RegExpExecArray | null;
	while ((m = re.exec(body))) marks.push({ id: m[1], at: m.index, end: re.lastIndex });
	const parts = new Map(
		marks.map((k, i) => [k.id, body.slice(k.end, marks[i + 1]?.at ?? body.length)])
	);
	const lead = marks.length ? body.slice(0, marks[0].at) : body;
	return findings.map((f) => {
		const own = parts.get(f.id);
		return { finding: f, verdict: verdictOf(own ?? lead), reason: reasonOf(own ?? lead) };
	});
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
