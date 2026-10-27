import type { LedgerStatus, LedgerTask } from './ledger';
import { answerOf } from '../../inbox';
import { FEEDBACK_PREFIX } from '../../preview';
import { changeNoteOf } from '../../prreview';
import type { BridgeMessage, ChangeRequest, ChangeRequests } from '../../types';

/**
 * Changes the captain requested on a task's pull request after it was
 * reported ready, and whose turn that makes it. Pure, so every path is
 * unit-tested; model.ts turns the result into the task's status and stage.
 *
 * Rules that matter:
 * - The PR is reported ready by the worker's `done: PR <url> checks green`
 *   line or by Firstmate's `task.pr_ready` ledger record for that PR; the
 *   latest of them is the ready report everything is measured against.
 * - Changes are requested (the worker's turn) after that report when the PR
 *   gets unresolved review feedback or new commits on GitHub (addressingReview),
 *   when the captain sends feedback from Wheelhouse (preview feedback, a change
 *   asked from the PR review, a Decisions "Fix"), or when the worker's latest
 *   decisive status line says it is working again.
 * - The next ready report hands the PR back to the captain, except that
 *   GitHub feedback left on the PR's current head keeps it with the worker
 *   until the head moves past it or the thread is resolved.
 * - Every request stays on the checklist after that, marked resolved (its
 *   thread is resolved on GitHub) or addressed (a ready report followed it).
 */

/** One piece of review feedback on a pull request, as read from GitHub (times in epoch seconds). */
export interface PrFeedbackItem {
	id: string;
	/** A submitted review with something to say, a review thread (its first comment), or a PR comment. */
	kind: 'review' | 'thread' | 'comment';
	/** A review's state (CHANGES_REQUESTED or COMMENTED); null for threads and comments. */
	state: string | null;
	author: string | null;
	text: string;
	at: number;
	url: string | null;
	/** The commit it was left on (a thread's original commit), when GitHub says. */
	commitId: string | null;
	path: string | null;
	line: number | null;
	/** A review thread resolved on GitHub. */
	resolved: boolean;
}

/** Review feedback and the head of a pull request, as read from GitHub (times in epoch seconds). */
export interface PrFeedback {
	/** The PR's state in lower case (open, closed, merged), when known. */
	state: string | null;
	draft: boolean | null;
	head: { sha: string; at: number | null } | null;
	items: PrFeedbackItem[];
}

/**
 * Whether the captain's review is being addressed rather than awaited: after
 * the PR was reported ready (`readyAt`), it got review feedback that is not
 * resolved (a review thread, a changes-requested or commented review, a PR
 * comment), or new commits. A newer ready report clears that only when it is
 * for a newer head: the PR's head must have moved past the commit the latest
 * feedback was left on. Approvals and dismissed reviews are never feedback.
 */
export function addressingReview(readyAt: number | null, f: PrFeedback | null): boolean {
	if (readyAt === null || !f) return false;
	const feedback = f.items.filter((i) => !i.resolved).sort((a, b) => a.at - b.at);
	const last = feedback[feedback.length - 1] ?? null;
	if (last && last.at > readyAt) return true;
	if (f.head?.at != null && f.head.at > readyAt) return true;
	if (last && f.head && last.commitId === f.head.sha) return true;
	return false;
}

/** A worker's CI-ready report: `done: PR <url> checks green`. */
export const CI_READY_NOTE = /\bPR\b.*checks green|checks green.*\bPR\b/;
/** Status verbs that say what the worker is doing; notes, pauses and resolutions do not. */
export const DECISIVE = new Set(['done', 'working', 'blocked', 'failed', 'needs-decision']);

const isCiReady = (s: LedgerStatus) => s.state === 'done' && CI_READY_NOTE.test(s.text);

/** Every time the PR was reported ready (epoch seconds), oldest first. */
export function readyTimes(prUrl: string, ledger: LedgerTask | null): number[] {
	const times = (ledger?.statuses ?? []).filter(isCiReady).map((s) => s.ts);
	if (ledger?.prReady && ledger.prReady.pr === prUrl) times.push(ledger.prReady.ts);
	return [...new Set(times)].sort((a, b) => a - b);
}

/** The worker's latest decisive status line, when it says it is working again after `readyAt`. */
function workingAgain(ledger: LedgerTask | null, readyAt: number): LedgerStatus | null {
	const statuses = ledger?.statuses ?? [];
	for (let i = statuses.length - 1; i >= 0; i--) {
		const s = statuses[i];
		if (!s.state || !DECISIVE.has(s.state)) continue;
		return s.state === 'working' && s.ts > readyAt ? s : null;
	}
	return null;
}

const TEXT_MAX = 2000;
const iso = (ts: number) => new Date(ts * 1000).toISOString();

/** A change request Wheelhouse sent about the task, read back from the message's text. */
export function wheelhouseRequest(
	m: BridgeMessage
): Pick<ChangeRequest, 'kind' | 'text' | 'where'> | null {
	if (FEEDBACK_PREFIX.test(m.text)) {
		return { kind: 'preview', text: m.text.replace(FEEDBACK_PREFIX, '').trim(), where: null };
	}
	const note = changeNoteOf(m.text);
	if (note) return { kind: 'pr-review', text: note.text, where: note.where };
	const answer = answerOf(m.text);
	if (answer?.choice === 'fix') {
		return {
			kind: 'decision',
			text: answer.note ?? (answer.question ? `Fix: ${answer.question}` : 'Fix it.'),
			where: null
		};
	}
	return null;
}

export interface ChangeInputs {
	prUrl: string;
	ledger: LedgerTask | null;
	/** The PR's review feedback from GitHub (null when it could not be read). */
	feedback: PrFeedback | null;
	/** Messages Wheelhouse sent to Firstmate (any task; this task's are picked out). */
	sent: readonly BridgeMessage[];
	taskId: string;
}

/**
 * The changes requested on a task's pull request: whether it is the worker's
 * turn, and every request as a checklist. Null when the PR has never been
 * reported ready and nothing was requested.
 */
export function changeRequests(i: ChangeInputs): ChangeRequests | null {
	const ready = readyTimes(i.prUrl, i.ledger);
	if (!ready.length) return null;
	const firstReady = ready[0];
	const readyAt = ready[ready.length - 1];
	const f = i.feedback;
	const head = f?.head ?? null;
	const readyAfter = (at: number) => ready.some((r) => r > at);

	const github: (ChangeRequest & { ts: number })[] = (f?.items ?? []).map((x) => ({
		id: `github:${x.id}`,
		source: 'github',
		kind: x.kind,
		author: x.author,
		text:
			x.text.slice(0, TEXT_MAX) || (x.state === 'CHANGES_REQUESTED' ? 'Changes requested.' : ''),
		at: iso(x.at),
		ts: x.at,
		url: x.url,
		where: x.path ? { path: x.path, line: x.line } : null,
		state: x.resolved
			? 'resolved'
			: readyAfter(x.at) && (!x.commitId || !head || head.sha !== x.commitId)
				? 'addressed'
				: 'open'
	}));
	const wheelhouse: (ChangeRequest & { ts: number })[] = i.sent.flatMap((m) => {
		if (m.taskId !== i.taskId || m.delivery === 'failed') return [];
		const ts = Math.floor(Date.parse(m.submittedAt) / 1000);
		if (Number.isNaN(ts) || ts <= firstReady) return [];
		const r = wheelhouseRequest(m);
		if (!r) return [];
		return [
			{
				id: `wheelhouse:${m.requestId}`,
				source: 'wheelhouse' as const,
				...r,
				text: r.text.slice(0, TEXT_MAX),
				author: null,
				at: m.submittedAt,
				ts,
				url: null,
				state: readyAfter(ts) ? ('addressed' as const) : ('open' as const)
			}
		];
	});
	const items = [...github, ...wheelhouse].sort((a, b) => a.ts - b.ts);

	const open = !f?.state || f.state === 'open';
	const onGithub = open && addressingReview(readyAt, f);
	const fromWheelhouse = wheelhouse.filter((x) => x.ts > readyAt);
	const worker = workingAgain(i.ledger, readyAt);
	const active = open && (onGithub || fromWheelhouse.length > 0 || worker !== null);
	if (!active && !items.length) return null;

	let basis: string | null = null;
	let since: number | null = null;
	if (active) {
		const asked = github.filter((x) => x.state === 'open');
		const where = [asked.length && 'on GitHub', fromWheelhouse.length && 'from Wheelhouse'].filter(
			Boolean
		);
		const commits = onGithub && !asked.length && head?.at != null && head.at > readyAt;
		basis = where.length
			? `You asked for changes ${where.join(' and ')} after it was reported ready.`
			: commits
				? 'New commits were pushed after it was reported ready.'
				: 'The worker is working on it again after it was reported ready.';
		const starts = [
			...asked.map((x) => x.ts).filter((t) => t > readyAt),
			...fromWheelhouse.map((x) => x.ts),
			...(onGithub && head?.at != null && head.at > readyAt ? [head.at] : []),
			...(worker ? [worker.ts] : [])
		];
		since = starts.length ? Math.min(...starts) : readyAt;
	}
	return {
		active,
		basis,
		since: since === null ? null : iso(since),
		items: items.map(({ ts, ...x }) => (void ts, x))
	};
}
