import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { runBounded, type RunOptions, type RunResult } from '../firstmate/exec';
import { which } from '../sessions/tmux';
import { getRuntime } from '../runtime';
import { helperArgs } from '../previewhelper';
import { plainStatus } from '../../plain';
import { structured } from '../../previewhelper';
import {
	TALK_SCHEMA,
	TALK_SYSTEM,
	readTalk,
	talkPrompt,
	type TalkContext,
	type TalkReply,
	type TalkRequest
} from '../../decisiontalk';

/**
 * One turn of talking a decision through (see lib/decisiontalk.ts),
 * answered by one headless Claude run (`claude -p`) with no tools, no session
 * and no settings, given only that decision and what it rests on. It never
 * writes, sends or runs anything; the captain submits the outcome through the
 * decision inbox. `WHEELHOUSE_DECISION_CLAUDE` names the binary (default: the
 * preview helper's, else `claude` on PATH), `WHEELHOUSE_DECISION_MODEL` the
 * model that answers and `WHEELHOUSE_DECISION_BRIEF_MODEL` the one that sums it
 * up (both default to haiku, for speed).
 */

const TIMEOUT_MS = 120_000;
const HISTORY_MAX = 20;
const REPORT_MAX = 16_000;
const BRIEF_MAX = 4_000;

export type TalkResult =
	{ ok: true; value: TalkReply } | { ok: false; status: 404 | 502 | 503; error: string };

export interface TalkDeps {
	env: NodeJS.ProcessEnv;
	run: (file: string, args: string[], opts: RunOptions) => Promise<RunResult>;
	find: (name: string) => string | null;
}

const defaults = (): TalkDeps => ({
	env: process.env,
	run: runBounded,
	find: (name) => which(name, process.env.PATH)
});

/** The quick model by default, so neither the brief nor an answer keeps the captain waiting. */
const model = (req: TalkRequest, env: NodeJS.ProcessEnv) =>
	(req.mode === 'brief' ? env.WHEELHOUSE_DECISION_BRIEF_MODEL : env.WHEELHOUSE_DECISION_MODEL) ||
	'haiku';

const cut = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}\n…(cut)` : s);

/** Gather what the crew is told about one decision; null when the inbox has no such card. */
async function context(cardId: string): Promise<TalkContext | null> {
	const runtime = await getRuntime();
	if (!runtime.configured) return null;
	const card = (await runtime.inbox.view()).cards.find((c) => c.id === cardId);
	if (!card) return null;
	const fleet = runtime.collector.getFleet();
	const taskId = card.secondMate?.taskId
		? `${card.secondMate.taskId}@${card.secondMate.id}`
		: card.taskId;
	const task = fleet.tasks.find((t) => t.id === taskId) ?? null;
	const ledger = runtime.collector.ledgerTask(card.taskId);
	const reportPath = await runtime.inbox.reportFile(card.id).catch(() => null);
	const reportText = reportPath ? await readFile(reportPath, 'utf8').catch(() => null) : null;
	const brief = runtime.collector.backlog(card.taskId)?.body ?? null;
	return {
		kind: card.kind,
		title: card.title,
		question: card.question,
		recommendation: card.recommendation?.text ?? null,
		task: {
			id: taskId,
			title: task?.shortTitle ?? card.taskTitle,
			project: fleet.projects.find((p) => p.id === card.projectId)?.name ?? card.projectId ?? null,
			status: task?.statusLabel ?? null
		},
		brief: brief ? cut(brief, BRIEF_MAX) : null,
		history: (ledger?.statuses ?? [])
			.slice(-HISTORY_MAX)
			.map(
				(s) =>
					`${new Date(s.ts * 1000).toISOString().slice(0, 16).replace('T', ' ')} ${plainStatus(s.state, s.text)}`
			),
		report:
			reportPath && reportText
				? { path: card.evidence.report?.path ?? reportPath, text: cut(reportText, REPORT_MAX) }
				: null,
		evidence: card.evidence.text,
		findings: card.evidence.findings.map(
			(f) => `${f.summary}${f.where ? ` (${f.where})` : ''}${f.serious ? ' [serious]' : ''}`
		),
		origin: card.origin
	};
}

/** One turn: the crew's reply, what the talk came to (if anything), and on the first turn the question's own options. */
export async function talkTurn(req: TalkRequest, deps: TalkDeps = defaults()): Promise<TalkResult> {
	const ctx = await context(req.cardId);
	if (!ctx) return { ok: false, status: 404, error: 'That decision is no longer open.' };
	const bin =
		deps.env.WHEELHOUSE_DECISION_CLAUDE ||
		deps.env.WHEELHOUSE_PREVIEW_CLAUDE ||
		deps.find('claude');
	if (!bin) {
		return {
			ok: false,
			status: 503,
			error: 'Claude Code (`claude`) is not installed or not on PATH, so the crew cannot answer.'
		};
	}
	const r = await deps.run(
		bin,
		helperArgs(model(req, deps.env), [], {
			system: TALK_SYSTEM,
			schema: TALK_SCHEMA,
			read: false
		}),
		{
			cwd: tmpdir(),
			env: deps.env,
			input: talkPrompt(ctx, req),
			timeoutMs: TIMEOUT_MS,
			maxOutputBytes: 1024 * 1024
		}
	);
	if (!r.ok) {
		return {
			ok: false,
			status: 502,
			error:
				r.kind === 'timeout'
					? 'The crew took too long to answer. Try again.'
					: 'The crew could not answer. Try again.'
		};
	}
	const reply = readTalk(
		structured(r.stdout, (text) => ({ reply: text, outcome: null })),
		req
	);
	return reply
		? { ok: true, value: reply }
		: { ok: false, status: 502, error: 'The crew’s answer could not be read. Try again.' };
}
