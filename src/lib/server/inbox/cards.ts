import { stat, readFile } from 'node:fs/promises';
import path from 'node:path';
import type { BacklogRecord, SnapshotTask } from '../firstmate/contracts';
import type { LedgerTask } from '../firstmate/ledger';
import {
	parseFindings,
	scrub,
	summary as findingSummary,
	verdictOf,
	whereOf,
	type Finding
} from '../insights/decisions';
import { isInside } from '../store/store';
import { plainStatus } from '../../plain';
import {
	answerOf,
	holdCardId,
	optionsFor,
	questionLine,
	type InboxCard,
	type InboxChoice,
	type InboxEvidence,
	type InboxFinding,
	type InboxKind,
	type InboxView
} from '../../inbox';
import type { BridgeMessage, TaskSummary } from '../../types';
import { choicesIn, reportIn } from './options';

/**
 * Builds the decision inbox from the records Wheelhouse already reads; it
 * never asks Firstmate anything new and never writes.
 *
 * - Open keyed decisions: the snapshot's `hints.open_decisions` (Firstmate's
 *   fold of state/<task>.status), each with the findings file its status line
 *   names (only a file inside that task's own data folder is read).
 * - Captain holds: backlog rows held for the captain (`captain_actionable`).
 * - Merge calls: ship tasks whose green pull request waits for the captain.
 * - Preview sign-offs: an open `board-review` decision, shown with the task's
 *   latest reported preview.
 *
 * A card's answer is matched back from the messages Wheelhouse sent (answerOf);
 * a card leaves the stack when its question closes in Firstmate's records,
 * because it is then no longer built here, or as soon as the captain's close
 * for it is taken (Firstmate then records it resolved on its key).
 */

export interface InboxSources {
	tasks: TaskSummary[];
	/** A live task's snapshot row (its open decisions), if any. */
	row: (id: string) => SnapshotTask | null;
	/** A task's backlog record (its hold reason and body), if any. */
	backlog: (id: string) => BacklogRecord | null;
	ledger: (id: string) => LedgerTask | null;
	/** A findings file's raw text, read safely (null when it cannot be read). */
	findings: (taskId: string, file: string) => string | null;
	messages: BridgeMessage[];
	homeDir: string | null;
}

const FINDINGS = /findings=(\S+)\s+file=(.+?\.txt)\b/;
const RECOMMEND =
	/\b(?:Firstmate\s+)?recommend(?:s|ed|ation)?(?:\s+is)?\s*[:=–—-]\s*([^\n]+?)(?:\.\s|\.$|\n|$)/i;

/** A recorded recommendation in a piece of text ("Recommendation: FIX …"). */
export function recommendationIn(text: string | null | undefined): string | null {
	const m = text ? RECOMMEND.exec(text) : null;
	return m?.[1]?.trim() || null;
}

/** The question without its recorded recommendation, which the card shows on its own. */
export function withoutRecommendation(text: string): string {
	const m = RECOMMEND.exec(text);
	if (!m) return text;
	const out = (text.slice(0, m.index) + text.slice(m.index + m[0].length)).trim();
	return out || text;
}

/** A recommendation's reasoning, without the call word the button already says. */
function reasonOf(text: string): string {
	const r = text
		.replace(/^(?:FIX|KEEP|DEFER\w*|DISCARD|APPROVE|SKIP|MERGE)\b(?:\s+it)?[\s.:,;–—-]*/i, '')
		.trim();
	return r ? r.charAt(0).toUpperCase() + r.slice(1) : text;
}

/** Which button a recommendation points at, when it is clear. */
export function choiceOf(text: string): InboxChoice | null {
	const v = verdictOf(text);
	if (v === 'Fix it') return 'fix';
	if (v === 'Keep as is') return 'approve';
	if (v === 'Defer' || v === 'No change') return 'skip';
	if (/\b(?:approve|merge|go ahead|proceed|accept|ship it|yes)\b/i.test(text)) return 'approve';
	if (/\b(?:fix|change|rework)\b/i.test(text)) return 'fix';
	if (/\b(?:skip|defer|later|hold off|leave it)\b/i.test(text)) return 'skip';
	return null;
}

/** `recommendation:` (or `recommend:`) fields in a findings file, by finding id. */
export function findingRecommendations(text: string): Map<string, string> {
	const out = new Map<string, string>();
	for (const block of text.split(/\n\s*\n/)) {
		const id = /^id:\s?(.*)$/m.exec(block)?.[1]?.trim();
		const rec = /^recommend(?:ation)?:\s?(.*)$/m.exec(block)?.[1]?.trim().replace(/\.$/, '');
		if (id && rec) out.set(id, rec);
	}
	return out;
}

const META = /\[(?:key|at)=[^\]]*\]/g;

/** The report a question names; the service fills in where it is served once it is found. */
const reportOf = (text: string | null) => {
	const p = reportIn(text);
	return p ? { path: p, url: null } : null;
};

const iso = (ts: number) => new Date(ts * 1000).toISOString();

/** A recorded date or time as ISO, or null when it does not read as one. */
function isoOf(text: string | null | undefined): string | null {
	const ms = text ? Date.parse(text) : NaN;
	return Number.isNaN(ms) ? null : new Date(ms).toISOString();
}

/** The latest status line that opened this key (its text names the findings file). */
function openingLine(ledger: LedgerTask | null, key: string | null) {
	if (!ledger || !key) return null;
	for (let i = ledger.statuses.length - 1; i >= 0; i--) {
		const s = ledger.statuses[i];
		if (s.key === key && (s.state === 'needs-decision' || s.state === 'blocked')) return s;
	}
	return null;
}

const RAISED_IN: Record<string, string> = {
	review: 'the automated review',
	test: 'the tests',
	document: 'the docs check',
	lint: 'the code style check',
	ci: 'CI'
};

function emptyEvidence(t: TaskSummary): InboxEvidence {
	return {
		text: null,
		report: null,
		findings: [],
		file: null,
		pr: t.pr,
		preview: t.preview?.url ?? null,
		checks: t.pipeline?.ci ?? null,
		screenshots: t.shots ?? []
	};
}

function decisionCards(t: TaskSummary, src: InboxSources): InboxCard[] {
	const row = src.row(t.id);
	if (!row) return [];
	const ledger = src.ledger(t.id);
	const home = src.homeDir;
	const out: InboxCard[] = [];
	row.openDecisions.forEach((d, i) => {
		if (!d.summary && !d.key) return;
		const verb = d.verb ?? 'needs-decision';
		const key = d.key ?? `open-${i + 1}`;
		const opening = openingLine(ledger, d.key);
		const raw = opening?.text ?? d.summary ?? '';
		const m = FINDINGS.exec(raw) ?? FINDINGS.exec(d.summary ?? '');
		const kind: InboxKind =
			verb === 'blocked'
				? 'blocked'
				: key === 'board-review'
					? 'preview'
					: key.startsWith('nm-') && m
						? 'review'
						: 'decision';
		const evidence = emptyEvidence(t);
		let question = plainStatus(verb, withoutRecommendation(d.summary ?? raw));
		let recommendation: string | null = recommendationIn(raw);
		if (m) {
			const ids = m[1].split(',').filter(Boolean);
			const text = src.findings(t.id, m[2]);
			const all = text ? parseFindings(text) : [];
			const recs = text ? findingRecommendations(text) : new Map<string, string>();
			const raised: Finding[] = ids.map(
				(id) =>
					all.find((f) => f.id === id) ?? {
						id,
						severity: null,
						file: null,
						line: null,
						description: ''
					}
			);
			evidence.file = path.basename(m[2]);
			evidence.findings = raised.map((f): InboxFinding => {
				const sum = scrub(findingSummary(f), home);
				const detail = scrub(f.description, home);
				return {
					id: f.id,
					summary: sum,
					detail: detail && detail.replace(/…$/, '') !== sum.replace(/…$/, '') ? detail : null,
					where: whereOf(f, home),
					serious: f.severity === 'error'
				};
			});
			const step = /-(review|test|document|lint|ci)(?:-|$)/.exec(key)?.[1] ?? 'review';
			const from = RAISED_IN[step];
			question =
				evidence.findings.length === 1
					? evidence.findings[0].summary
					: `${evidence.findings.length} questions from ${from}`;
			const named = raised.map((f) => recs.get(f.id) ?? recommendationIn(f.description));
			recommendation ??= named.find(Boolean) ?? null;
		} else {
			evidence.text = scrub(raw, home) || null;
		}
		const words = kind === 'decision' ? scrub(raw.replace(META, ' '), home) : '';
		const choices = choicesIn(words);
		evidence.report = reportOf(words);
		out.push({
			id: `${t.id}:${key}`,
			taskId: t.id,
			taskTitle: t.shortTitle,
			projectId: t.projectId,
			kind,
			key,
			question,
			askedAt: opening ? iso(opening.ts) : null,
			owner: kind === 'preview' ? 'captain' : 'firstmate',
			evidence,
			options: optionsFor(kind, !!choices),
			recommendation: recommendation
				? { choice: choiceOf(recommendation), text: scrub(reasonOf(recommendation), home) }
				: null,
			choices,
			sent: null
		});
	});
	return out;
}

function holdCard(t: TaskSummary, src: InboxSources): InboxCard {
	const b = src.backlog(t.id);
	const home = src.homeDir;
	const evidence = emptyEvidence(t);
	const reason = b?.holdReason ?? t.attention?.text ?? 'Firstmate is holding this for you.';
	const body = b?.bodyExcerpt ? scrub(b.bodyExcerpt, home) : null;
	evidence.text = body && body !== reason ? body : null;
	const rec = recommendationIn(b?.holdReason) ?? recommendationIn(b?.bodyExcerpt);
	const words = scrub(reason, home);
	const choices = choicesIn(words);
	evidence.report = reportOf(words) ?? reportOf(body);
	return {
		id: holdCardId(t.id),
		taskId: t.id,
		taskTitle: t.shortTitle,
		projectId: t.projectId,
		kind: 'hold',
		key: 'captain-hold',
		question: scrub(withoutRecommendation(reason), home),
		askedAt: isoOf(b?.holdSet),
		owner: 'captain',
		evidence,
		options: optionsFor('hold', !!choices),
		recommendation: rec ? { choice: choiceOf(rec), text: scrub(reasonOf(rec), home) } : null,
		choices,
		sent: null
	};
}

function mergeCard(t: TaskSummary, src: InboxSources): InboxCard {
	const evidence = emptyEvidence(t);
	// Waiting for a merge word means its checks read green (model.ts prAwaitsMerge).
	evidence.checks = t.pipeline?.ci ?? 'green';
	evidence.pr = t.pr ?? (t.attention?.url ? { url: t.attention.url, number: null } : null);
	const ready = src.ledger(t.id)?.prReady;
	const n = evidence.pr?.number;
	return {
		id: `${t.id}:merge-pr`,
		taskId: t.id,
		taskTitle: t.shortTitle,
		projectId: t.projectId,
		kind: 'merge',
		key: 'merge-pr',
		question: `Merge pull request${n ? ` #${n}` : ''}? Its checks are green.`,
		askedAt: ready ? iso(ready.ts) : null,
		owner: 'captain',
		evidence,
		options: optionsFor('merge'),
		recommendation: null,
		choices: null,
		sent: null
	};
}

/**
 * The captain's latest answer to a card, from the messages Wheelhouse sent:
 * one that names this same question and, when it is known when the question
 * was asked, was sent since.
 */
function sentFor(card: InboxCard, messages: BridgeMessage[]): InboxCard['sent'] {
	const since = card.askedAt ? Date.parse(card.askedAt) : null;
	const question = questionLine(card.question);
	for (let i = messages.length - 1; i >= 0; i--) {
		const m = messages[i];
		if (m.taskId !== card.taskId) continue;
		if (since !== null && Date.parse(m.submittedAt) < since) continue;
		const a = answerOf(m.text);
		if (!a || a.key !== card.key) continue;
		if (a.question !== question) continue;
		return {
			choice: a.choice,
			picks: a.picks,
			note: a.note,
			at: m.submittedAt,
			delivery: m.delivery,
			detail: m.deliveryDetail,
			requestId: m.requestId
		};
	}
	return null;
}

/** Every open question, the captain's first (oldest first), then Firstmate's. */
export function buildInbox(src: InboxSources): InboxCard[] {
	let cards: InboxCard[] = [];
	for (const t of src.tasks) {
		if (t.status === 'landed') continue;
		const captain = t.attention?.owner === 'captain';
		if (captain && t.attention?.kind === 'review') cards.push(mergeCard(t, src));
		if (captain && t.attention?.kind === 'decision') cards.push(holdCard(t, src));
		cards.push(...decisionCards(t, src));
	}
	for (const c of cards) c.sent = sentFor(c, src.messages);
	// A close that was taken ends the question here; a failed one leaves it waiting.
	cards = cards.filter((c) => c.sent?.choice !== 'close' || c.sent.delivery === 'failed');
	const at = (c: InboxCard) => (c.askedAt ? Date.parse(c.askedAt) : Number.POSITIVE_INFINITY);
	return cards.sort(
		(a, b) =>
			(a.owner === 'captain' ? 0 : 1) - (b.owner === 'captain' ? 0 : 1) ||
			at(a) - at(b) ||
			a.id.localeCompare(b.id)
	);
}

const MAX_FINDINGS_BYTES = 256 * 1024;

/**
 * Findings files for the inbox, read on demand and kept until they change.
 * Only a file inside the task's own data folder (data/<task>/) is read.
 */
export class FindingsFiles {
	private cache = new Map<string, { mtimeMs: number; text: string | null }>();

	constructor(private dataDir: () => string) {}

	/** Bring every file the given cards' sources name up to date, then `get` reads from memory. */
	async load(wanted: { taskId: string; file: string }[]): Promise<void> {
		await Promise.all(
			wanted.map(async ({ taskId, file }) => {
				const resolved = path.resolve(file);
				if (!isInside(resolved, path.join(this.dataDir(), taskId))) return;
				const st = await stat(resolved).catch(() => null);
				if (!st?.isFile() || st.size > MAX_FINDINGS_BYTES) {
					this.cache.set(resolved, { mtimeMs: 0, text: null });
					return;
				}
				if (this.cache.get(resolved)?.mtimeMs === st.mtimeMs) return;
				const text = await readFile(resolved, 'utf8').catch(() => null);
				this.cache.set(resolved, { mtimeMs: st.mtimeMs, text });
			})
		);
	}

	get(taskId: string, file: string): string | null {
		const resolved = path.resolve(file);
		if (!isInside(resolved, path.join(this.dataDir(), taskId))) return null;
		return this.cache.get(resolved)?.text ?? null;
	}
}

/** The findings files open decisions name, to read before building. */
export function findingsWanted(
	tasks: TaskSummary[],
	row: InboxSources['row'],
	ledger: InboxSources['ledger']
): { taskId: string; file: string }[] {
	const out: { taskId: string; file: string }[] = [];
	for (const t of tasks) {
		for (const d of row(t.id)?.openDecisions ?? []) {
			const text = openingLine(ledger(t.id), d.key)?.text ?? d.summary ?? '';
			const m = FINDINGS.exec(text) ?? FINDINGS.exec(d.summary ?? '');
			if (m) out.push({ taskId: t.id, file: m[2] });
		}
	}
	return out;
}

export function inboxView(
	cards: InboxCard[],
	canAnswer: boolean,
	reason: string | null
): InboxView {
	return { schema: 'wheelhouse-inbox.v1', available: true, reason, canAnswer, cards };
}
