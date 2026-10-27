import type { LedgerStatus, LedgerTask } from './ledger';
import { answerOf } from '../../inbox';
import { FEEDBACK_PREFIX } from '../../preview';
import { changeNoteOf } from '../../prreview';
import type { BridgeMessage, ChangeRequest, TaskRun, TaskRuns } from '../../types';

/**
 * Changes the captain requested on a task's pull request after it was
 * reported ready, and the runs they start. Pure, so every path is
 * unit-tested; model.ts turns the result into the task's status and stage.
 *
 * Rules that matter:
 * - The PR is reported ready by the worker's `done: PR <url> checks green`
 *   line or by Firstmate's `task.pr_ready` ledger record for that PR; the
 *   latest of them is the ready report everything is measured against.
 * - Changes are requested (a new run, the worker's turn) after that report when the PR
 *   gets unresolved review feedback or new commits on GitHub (addressingReview),
 *   when the captain sends feedback from Wheelhouse (preview feedback, a change
 *   asked from the PR review, a Decisions "Fix"), or when the worker's latest
 *   decisive status line says it is working again.
 * - The next ready report ends that run and hands the PR back to the
 *   captain, except that GitHub feedback left on the PR's current head keeps
 *   the run going until the head moves past it or the thread is resolved.
 * - Every run keeps its requests after that, each marked resolved (its
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
	/** A merge or landing was recorded. */
	merged?: boolean;
}

type Stamped = ChangeRequest & { ts: number };
type Trigger = { ts: number; kind: 'asked' | 'commits' | 'worker'; item?: Stamped };

/**
 * The task's runs: run 1 is the first build up to its ready report, and every
 * time changes are requested after a ready report a new run starts, which
 * builds, checks and reports the pull request ready again. Each run carries
 * the requests that started it (and any asked while it was being built), so
 * earlier runs stay visible. Null when the PR has never been reported ready.
 */
export function taskRuns(i: ChangeInputs): TaskRuns | null {
	const ready = readyTimes(i.prUrl, i.ledger);
	if (!ready.length) return null;
	const firstReady = ready[0];
	const f = i.feedback;
	const head = f?.head ?? null;
	const readyAfter = (at: number) => ready.some((r) => r > at);

	const github: Stamped[] = (f?.items ?? []).map((x) => ({
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
	const wheelhouse: Stamped[] = i.sent.flatMap((m) => {
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
	// GitHub feedback left on the PR's current head is not dealt with until the head moves.
	const onHead = (x: Stamped) =>
		x.source === 'github' &&
		x.state === 'open' &&
		!!head &&
		(f?.items.find((g) => `github:${g.id}` === x.id)?.commitId ?? null) === head.sha;

	const triggers: Trigger[] = [
		...[...github, ...wheelhouse]
			.filter((x) => x.state !== 'resolved' || x.source === 'wheelhouse')
			.map((item) => ({ ts: item.ts, kind: 'asked' as const, item })),
		...(head?.at != null && head.at > firstReady
			? [{ ts: head.at, kind: 'commits' as const }]
			: []),
		...(i.ledger?.statuses ?? [])
			.filter((s) => s.state === 'working' && s.ts > firstReady)
			.map((s) => ({ ts: s.ts, kind: 'worker' as const }))
	];
	// Resolved threads still belong on the checklist of the run they were asked in.
	const resolved = github.filter((x) => x.state === 'resolved');
	const events = [
		...ready.map((ts) => ({ ts, ready: true as const })),
		...triggers.map((t) => ({ ...t, ready: false as const }))
	].sort((a, b) => a.ts - b.ts || (a.ready ? -1 : 1));

	interface Building {
		n: number;
		start: number | null;
		readyAt: number | null;
		endedAt: number | null;
		kinds: Set<Trigger['kind'] | 'github' | 'wheelhouse'>;
		items: Stamped[];
	}
	const runs: Building[] = [
		{
			n: 1,
			start: i.ledger?.dispatched?.ts ?? null,
			readyAt: null,
			endedAt: null,
			kinds: new Set(),
			items: []
		}
	];
	// Requests asked before the first ready report wait for the run that deals with them.
	const early: Stamped[] = [];
	for (const e of events) {
		const cur = runs[runs.length - 1];
		if (e.ready) {
			if (cur.readyAt !== null) continue;
			if (cur.n > 1 && cur.items.some(onHead)) continue;
			cur.readyAt = e.ts;
			continue;
		}
		if (cur.readyAt === null) {
			if (e.item) (cur.n > 1 ? cur.items : early).push(e.item);
			if (cur.n > 1) cur.kinds.add(e.kind);
			continue;
		}
		cur.endedAt = e.ts;
		runs.push({
			n: cur.n + 1,
			start: e.ts,
			readyAt: null,
			endedAt: null,
			kinds: new Set([e.kind]),
			items: [...(cur.n === 1 ? early.splice(0) : []), ...(e.item ? [e.item] : [])]
		});
	}
	for (const x of resolved) {
		const run = [...runs].reverse().find((r) => r.n > 1 && r.start !== null && r.start <= x.ts);
		if (run && !run.items.includes(x)) run.items.push(x);
	}

	const open = !f?.state || f.state === 'open';
	const last = runs[runs.length - 1];
	const out: TaskRun[] = runs.map((r) => {
		const sources = new Set(r.items.map((x) => x.source));
		const where = [
			sources.has('github') && 'on GitHub',
			sources.has('wheelhouse') && 'from Wheelhouse'
		].filter(Boolean);
		const basis =
			r.n === 1
				? null
				: where.length
					? `You asked for changes ${where.join(' and ')} after run ${r.n - 1} was reported ready.`
					: r.kinds.has('commits')
						? `New commits were pushed after run ${r.n - 1} was reported ready.`
						: `The worker went back to work after run ${r.n - 1} was reported ready.`;
		const outcome: TaskRun['outcome'] =
			r !== last
				? 'changes-requested'
				: i.merged
					? 'landed'
					: r.readyAt !== null
						? 'ready'
						: open
							? 'building'
							: 'closed';
		return {
			n: r.n,
			startedAt: r.start === null ? null : iso(r.start),
			readyAt: r.readyAt === null ? null : iso(r.readyAt),
			endedAt: r.endedAt === null ? null : iso(r.endedAt),
			outcome,
			basis,
			changes: r.items.sort((a, b) => a.ts - b.ts).map(({ ts, ...x }) => (void ts, x))
		};
	});
	const current = out[out.length - 1];
	return {
		current: current.n,
		reworking: current.n > 1 && current.outcome === 'building',
		runs: out
	};
}
