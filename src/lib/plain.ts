/**
 * Worker status lines and crew-state details in the captain's terms. Firstmate's
 * status lines are written for Firstmate (keys, run ids, file paths, script
 * names); cards, the Now line, timelines and the task-page summary show only
 * what this module makes of them. Known shapes get a fixed sentence; anything
 * else is cleaned of internals, and when nothing readable is left, a generic
 * sentence for the state stands in. The raw line stays on the task page,
 * behind a "details" disclosure. Pure, so it is unit-tested with real lines.
 */

const FALLBACK: Record<string, string> = {
	working: 'Working',
	'needs-decision': 'Waiting on Firstmate',
	paused: 'Paused',
	parked: 'Paused',
	blocked: 'Blocked: needs Firstmate',
	failed: 'Failed',
	done: 'Finished',
	resolved: 'Firstmate answered; work continues',
	note: 'Working'
};

/** The generic sentence for a state, used when a line cannot be translated cleanly. */
export const fallbackFor = (state: string | null | undefined): string =>
	FALLBACK[state ?? ''] ?? 'Working';

const PULL = /(?:\b(?:PR|pull request)\s+)?https?:\/\/\S+?\/pull\/(\d+)\S*/gi;
const URL = /\bhttps?:\/\/[^\s;,)]+/g;
const META = /\[(?:key|at)=[^\]]*\]/g;
const MAX = 140;

const capitalise = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** A short phrase for the pipeline step a crew-state detail or status line names. */
function knownShape(state: string | null, text: string): string | null {
	const t = text;
	const findings = /\bask-user findings=(\S+)/.exec(t);
	if (findings) {
		const n = findings[1].split(',').filter(Boolean).length;
		return `Review raised ${plural(n, 'question', 'questions')}; Firstmate is deciding`;
	}
	const green = /\bPR\s+https?:\/\/\S+?\/pull\/(\d+)\S*\s+checks green\b/.exec(t);
	if (green) return `Pull request #${green[1]} ready for your review`;
	if (/^checks green\b/.test(t)) {
		const n = /\/pull\/(\d+)/.exec(t)?.[1];
		return n ? `Pull request #${n} ready for your review` : 'Checks green; ready for your review';
	}
	const merge = /\bmerge of (?:PR|pull request)\s+https?:\/\/\S+?\/pull\/(\d+)/i.exec(t);
	if (merge) return `Waiting for your merge of pull request #${merge[1]}`;
	if (/\bfix round\b/i.test(t) || /^validating \(fixing\)/.test(t)) {
		const round = /\bfix round (\d+)\b/i.exec(t)?.[1];
		return `Fixing review findings${round ? ` (round ${round})` : ''}`;
	}
	const parked = /^parked at ([\w-]+)(?::\s*(\d+) finding)?/.exec(t);
	if (parked) {
		const step = parked[1] === 'ci' ? 'CI' : parked[1];
		return parked[2]
			? `${capitalise(step)} found ${plural(Number(parked[2]), 'issue', 'issues')}; waiting on a decision`
			: `Paused at the ${step} step; waiting on a decision`;
	}
	if (/^ci running\b/.test(t)) return 'Waiting for CI checks';
	if (
		/\bno-mistakes\b.*\b(run|running|started|in progress|re-?validat)/i.test(t) ||
		/\bre-?validat/i.test(t) ||
		/^validating \(/.test(t) ||
		/\bbackgrounded drive call\b/.test(t)
	) {
		return 'Running automated review and tests';
	}
	if (/^run completed\b/.test(t)) return 'Automated review and tests finished';
	if (/^run failed\b/.test(t)) return 'Automated review and tests failed';
	if (/^run cancelled\b/.test(t)) return 'Automated review and tests were cancelled';
	if (/^harness busy\b/.test(t)) return 'Working';
	if (/^harness state unavailable\b/.test(t)) return 'Worker state unavailable';
	if (/^backend (target gone|unreachable)\b/.test(t)) return 'Lost contact with the worker';
	if (/^no current-state source\b/.test(t)) return 'State unknown';
	if (state === 'resolved' || /^answered:/.test(t)) return FALLBACK.resolved;
	if (/^preview:?\s+https?:\/\//i.test(t)) return 'Shared a live preview';
	const committed = /^(.+?)\s+committed\b/.exec(t);
	if (committed && state === 'done') {
		const what = clean(committed[1]);
		return what ? `Committed: ${what}` : 'Work committed';
	}
	if (/^report (?:at|in|written)\b/.test(t)) return 'Report ready';
	return null;
}

/** Remove internals (paths, ids, keys, script names, URLs) from free text; '' when nothing is left. */
export function clean(text: string): string {
	// A line that names a Firstmate script is about Firstmate's internals.
	if (/\b[\w.-]+\.(?:sh|mjs|cjs|py|jq)\b/.test(text)) return '';
	let s = text
		.replace(META, ' ')
		.replace(/\s*\[truncated\]\s*$/, '')
		.replace(/\bfile=.*$/, ' ')
		.replace(PULL, (_m, n: string) => `PR #${n}`)
		.replace(/(?:\s+(?:left\s+)?running)?\s+(?:at|on|in)\s+https?:\/\/[^\s;,)]+/g, '')
		.replace(URL, ' ')
		// Absolute paths, which may contain spaces between slash-led segments.
		.replace(
			/(?:~|\/(?:Users|home|private|tmp|var|opt|etc))(?:\/[^\s/;,)]*)+(?:\s+\/[^\s;,)]+)*/g,
			' '
		)
		// Relative paths with a known root or a file extension, and branch names.
		.replace(/\b(?:data|state|bin|src|docs|tests|projects|fm)\/[^\s;,)]+/g, ' ')
		.replace(/\b[\w.-]+(?:\/[\w.-]+)+\.\w{1,5}\b/g, ' ')
		.replace(/\b[\w.-]+\.(?:sh|mjs|cjs|js|ts|py|jq|txt|md|json|jsonl|log)\b/g, ' ')
		.replace(/\b\w+=\S+/g, ' ')
		.replace(/\b(?:run:?\s*)?[0-9A-Z]{26}\b/g, ' ')
		.replace(/\bpid \d+\b/g, ' ')
		.replace(/\b[0-9a-f]{7,40}\b/g, ' ')
		.replace(/`([^`]*)`/g, '$1');
	// Parentheticals left empty or still technical are dropped whole.
	s = s.replace(/\(([^()]*)\)/g, (m, inner: string) =>
		!inner.trim() || /[=_/`:]|\bnm-/.test(inner) ? ' ' : m
	);
	s = s
		.replace(/\s+/g, ' ')
		.replace(/\s+(?:on|at|in|for|via|from|to|of)\s*(?=[;,.]|$)/g, '')
		.replace(/\s+([;,.:])/g, '$1')
		.replace(/(?:[;,:]\s*)+(?=[;,]|$)/g, '')
		.replace(/^[\s;,:.-]+|[\s;,:-]+$/g, '')
		.trim();
	if (/[=`]|\bnm-|[A-Za-z]_[A-Za-z]/.test(s) || s.length < 3) return '';
	return s;
}

function bound(s: string): string {
	if (s.length <= MAX) return s;
	const cut = s.slice(0, MAX - 1);
	const at = cut.lastIndexOf(' ');
	return `${(at > MAX / 2 ? cut.slice(0, at) : cut).replace(/[\s;,:.-]+$/, '')}…`;
}

/**
 * A status line (`state` is its verb, `text` its note) or a crew-state detail
 * in plain words. A crew-state detail's extra ` · ` components (run ids,
 * superseded notes) are never shown.
 */
export function plainStatus(
	state: string | null | undefined,
	text: string | null | undefined
): string {
	const verb = state ?? null;
	const raw = (text ?? '').replace(META, ' ').replace(/\s+/g, ' ').trim();
	const first = raw.split(' · ')[0].trim();
	if (!first) return fallbackFor(verb);
	const known = knownShape(verb, first);
	if (known) return known;
	// "setup done on <branch>; what comes next" keeps only what comes next.
	const setup = /^setup done\b[^;]*;?\s*(.*)$/i.exec(first);
	if (setup) {
		const rest = clean(setup[1]);
		return rest ? bound(capitalise(rest)) : 'Set up and started work';
	}
	const cleaned = clean(first);
	return cleaned ? bound(capitalise(cleaned)) : fallbackFor(verb);
}
