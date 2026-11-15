import { stat, readFile } from 'node:fs/promises';
import path from 'node:path';
import type { BacklogRecord, SecondMateRecord, SnapshotTask } from '../firstmate/contracts';
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
import { findDocPaths } from '../../docpath';
import { plainStatus } from '../../plain';
import { pageOf } from '../../previewnote';
import {
	answerOf,
	holdCardId,
	optionsFor,
	questionLine,
	type InboxCard,
	type InboxChoice,
	type InboxChoices,
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
 * - Captain holds: backlog rows held for the captain (`captain_actionable`),
 *   keyed by the held task's id. When the held task is a fresh row for a call
 *   about another task's work (`Captain hold origin:`), what can be seen comes
 *   from that origin task's status lines.
 * - Merge calls: ship tasks whose green pull request waits for the captain.
 * - Preview sign-offs: an open `board-review` decision, shown with the task's
 *   latest reported preview.
 *
 * A card's answer is matched back from the messages Wheelhouse sent (answerOf);
 * a card leaves the stack when its question closes in Firstmate's records,
 * because it is then no longer built here, or as soon as the captain's
 * dismissal of it is taken (Firstmate then records it closed).
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
	/** Second mates' records: their own questions and their homes' open questions. */
	secondMates?: SecondMateRecord[];
	/** False until Firstmate's state has first been read: no question can be known closed yet. */
	read?: boolean;
}

/** What a card is about: a task, or a second mate standing in for one. */
type Subject = Pick<
	TaskSummary,
	'id' | 'shortTitle' | 'pr' | 'preview' | 'board' | 'pipeline' | 'shots'
> & {
	projectId: string | null;
};

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

function emptyEvidence(t: Subject): InboxEvidence {
	return {
		text: null,
		report: null,
		findings: [],
		file: null,
		pr: t.pr,
		preview: t.preview?.url ?? null,
		previewTask: t.preview ? t.id : null,
		board: t.board?.url ?? null,
		checks: t.pipeline?.ci ?? null,
		screenshots: t.shots ?? [],
		docs: []
	};
}

/** A card's heading when no shorter one is known: the calls' opening words, else the question. */
const titleOf = (question: string, choices: InboxChoices | null) => choices?.intro || question;

const STAMP = /^\s*Captain hold (?:set|origin):.*$/gim;
const ORIGIN = /^\s*Captain hold origin:\s*([^\s()]+)\s*$/im;

/**
 * A held task's body without the stamps Firstmate writes on it (`Captain hold
 * set:` and `Captain hold origin:`), and the origin they name: the internals
 * live under the card's Details.
 */
export function holdBody(body: string | null | undefined): {
	text: string | null;
	origin: string | null;
} {
	const raw = body ?? '';
	const origin = ORIGIN.exec(raw)?.[1] ?? null;
	const text = raw
		.replace(STAMP, '')
		.replace(/\n{3,}/g, '\n\n')
		.trim();
	return { text: text || null, origin };
}

/** The first sentence of some words, up to its closing mark. */
function firstSentence(text: string): string {
	const t = text.replace(/\s+/g, ' ').trim();
	const m = /^.*?[.?!](?=\s|$)/.exec(t);
	return (m ? m[0] : t).trim();
}

const asks = (s: string) => /\?$/.test(s);
const MAX_TITLE = 140;

/**
 * A held question's heading, never the whole hold reason: its first sentence
 * when that is a question; else the task's title when it reads as one (without
 * any file it names); else the opening words before the calls; else the title,
 * and only then the reason's first sentence.
 */
export function holdTitle(
	reason: string,
	title: string | null | undefined,
	intro: string | null | undefined
): string {
	const first = firstSentence(reason);
	if (asks(first) && first.length <= MAX_TITLE) return first;
	let named = (title ?? '').replace(/\s+/g, ' ').trim();
	for (const m of findDocPaths(named).toReversed()) {
		named = named.slice(0, m.start) + named.slice(m.end);
	}
	named = named.replace(/\s+/g, ' ').trim();
	if (named.includes('?')) return named.replace(/(\?)[^?]*$/, '$1').trim();
	const lead = intro?.replace(/[\s:–—-]+$/, '').trim();
	if (lead) return lead;
	if (named) return named;
	return first.length > MAX_TITLE ? `${first.slice(0, MAX_TITLE - 1).trimEnd()}…` : first;
}

function decisionCards(t: Subject, src: InboxSources): InboxCard[] {
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
			title: titleOf(question, choices),
			origin: null,
			following: null,
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

/**
 * Where the work a held question is about can be seen, when the held task's
 * own status lines name nothing: the task it came from, as a live task (its
 * preview, board, screenshots and pull request) or from its ledger alone.
 */
function followOrigin(evidence: InboxEvidence, origin: string | null, src: InboxSources) {
	if (!origin) return;
	const o = src.tasks.find((x) => x.id === origin);
	const ledger = o ? null : src.ledger(origin);
	if (!evidence.preview) {
		evidence.preview = o?.preview?.url ?? ledger?.preview?.url ?? null;
		evidence.previewTask = o?.preview ? o.id : null;
	}
	evidence.board ??= o?.board?.url ?? ledger?.board?.url ?? null;
	if (!evidence.screenshots.length) evidence.screenshots = o?.shots ?? [];
	if (!evidence.pr && o?.pr) {
		evidence.pr = o.pr;
		evidence.checks = o.pipeline?.ci ?? null;
	}
}

function holdCard(
	t: Subject & { attention?: TaskSummary['attention'] },
	src: InboxSources
): InboxCard {
	const b = src.backlog(t.id);
	const home = src.homeDir;
	const evidence = emptyEvidence(t);
	const reason = b?.holdReason ?? t.attention?.text ?? 'Firstmate is holding this for you.';
	const stamped = holdBody(b?.bodyExcerpt);
	const origin = stamped.origin && stamped.origin !== t.id ? stamped.origin : null;
	const body = stamped.text ? scrub(stamped.text, home) : null;
	evidence.text = body && body !== reason ? body : null;
	const rec = recommendationIn(b?.holdReason) ?? recommendationIn(b?.bodyExcerpt);
	const words = scrub(reason, home);
	const choices = choicesIn(words);
	evidence.report = reportOf(words) ?? reportOf(b?.title ?? null) ?? reportOf(body);
	followOrigin(evidence, origin, src);
	const question = scrub(withoutRecommendation(reason), home);
	return {
		id: holdCardId(t.id),
		taskId: t.id,
		taskTitle: t.shortTitle,
		projectId: t.projectId,
		kind: 'hold',
		// The held task's id: the key Firstmate's keyed answers take (fm-captain-hold.sh answers).
		key: t.id,
		question,
		title: holdTitle(question, b?.title, choices?.intro),
		origin,
		following: null,
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
		title: `Merge pull request${n ? ` #${n}` : ''}? Its checks are green.`,
		origin: null,
		following: null,
		askedAt: ready ? iso(ready.ts) : null,
		owner: 'captain',
		evidence,
		options: optionsFor('merge'),
		recommendation: null,
		choices: null,
		sent: null
	};
}

/** The key a held question's answers named before they named its task id. */
const OLD_HOLD_KEY = 'captain-hold';

/**
 * The captain's latest answer to a card, from the messages Wheelhouse sent:
 * one on its key and, when it is known when the question was asked, sent
 * since. A held question known to be asked since (its `Captain hold set:`
 * stamp) is matched on its key alone (its task id), so Firstmate rewording the
 * hold does not reopen it. Any other question has to be the same question:
 * without that stamp a new hold on the same task cannot be told from a
 * reworded one, and an answer under the key holds had before names no task.
 */
function sentFor(card: InboxCard, messages: BridgeMessage[]): InboxCard['sent'] {
	const since = card.askedAt ? Date.parse(card.askedAt) : null;
	const question = questionLine(card.question);
	const hold = card.kind === 'hold';
	for (let i = messages.length - 1; i >= 0; i--) {
		const m = messages[i];
		if (m.taskId !== card.taskId) continue;
		if (since !== null && Date.parse(m.submittedAt) < since) continue;
		const a = answerOf(m.text);
		if (!a) continue;
		const own = a.key === card.key;
		if (!own && !(hold && a.key === OLD_HOLD_KEY)) continue;
		if (!(hold && own && since !== null) && a.question !== question) continue;
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

/**
 * A second mate's questions, as the captain's own workers' are: its own (a
 * captain hold on its row, which waits on the captain, and its row's open
 * decisions, which Firstmate handles first), then its home's — a
 * captain hold there waits on the captain, and a worker's question there goes
 * to that second mate first. Each is about the second mate (an answer goes to
 * Firstmate about it, to pass on) and names the task in its home.
 */
/**
 * Where a second mate's question can be seen, from status lines only: a task
 * in its home, its preview (checked as that task's, through its forward for a
 * remote one) and board; for the second mate's own question, the preview and
 * board its own status lines name, matched to the task in its home that
 * reported that preview. A remote home's address that no task of it reported
 * cannot be opened here, so it is left out.
 */
function mateWhere(
	rec: SecondMateRecord,
	src: InboxSources,
	taskId: string | null
): Pick<InboxEvidence, 'preview' | 'previewTask' | 'board'> {
	const mine = src.tasks.filter((t) => t.secondMate?.id === rec.id);
	if (taskId) {
		const t = mine.find((x) => x.id === `${taskId}@${rec.id}`);
		return {
			preview: t?.preview?.url ?? null,
			previewTask: t?.preview ? t.id : null,
			board: t?.board?.url ?? null
		};
	}
	const own = src.ledger(rec.id);
	const url = own?.preview?.url ?? null;
	const t = url ? mine.find((x) => x.preview && pageOf(x.preview.url) === pageOf(url)) : null;
	return {
		preview: t || !rec.remote ? url : null,
		previewTask: t?.id ?? null,
		board: rec.remote ? null : (own?.board?.url ?? null)
	};
}

function mateCards(rec: SecondMateRecord, src: InboxSources): InboxCard[] {
	const label = `Second mate ${rec.id}`;
	const subject: Subject = {
		id: rec.id,
		shortTitle: label,
		projectId: null,
		pr: null,
		preview: null,
		pipeline: null,
		shots: []
	};
	const held = src.backlog(rec.id)?.captainActionable ? [holdCard(subject, src)] : [];
	const where = mateWhere(rec, src, null);
	const own = [...held, ...decisionCards(subject, src)].map((c) => ({
		...c,
		evidence: { ...c.evidence, ...where },
		secondMate: { id: rec.id, taskId: null, taskTitle: null }
	}));
	const home = (text: string) => scrub(scrub(text, rec.home), src.homeDir);
	const out: InboxCard[] = [...own];
	rec.decisions.forEach((d, i) => {
		const hold = d.verb === 'captain-hold' || d.source === 'backlog';
		const queued = rec.queued.find((q) => q.id === d.id);
		const active = rec.active.find((a) => a.id === d.id);
		const raw = hold
			? (d.question ?? [d.summary, d.reason].filter(Boolean).join(': '))
			: (d.summary ?? '');
		if (!raw) return;
		// A held question in its home is keyed by its task there, as the captain's own are.
		const key = hold ? d.id : (d.key ?? `open-${i + 1}`);
		const kind: InboxKind = hold ? 'hold' : d.verb === 'blocked' ? 'blocked' : 'decision';
		const words = home(raw.replace(META, ' '));
		const choices = kind === 'blocked' ? null : choicesIn(words);
		const evidence = { ...emptyEvidence(subject), ...mateWhere(rec, src, d.id) };
		const reason = home(d.reason ?? '');
		evidence.text = hold && reason && !words.includes(reason) ? reason : null;
		evidence.report = reportOf(words);
		const rec_ = recommendationIn(raw);
		const title = (hold ? (queued?.title ?? d.summary) : (active?.name ?? queued?.title)) ?? d.id;
		const question = hold
			? home(withoutRecommendation(raw))
			: plainStatus(d.verb ?? 'needs-decision', withoutRecommendation(home(raw)));
		out.push({
			id: `${rec.id}:${d.id}:${hold ? OLD_HOLD_KEY : key}`,
			taskId: rec.id,
			taskTitle: `${title} (${label.toLowerCase()})`,
			projectId: queued?.repo ?? active?.repo ?? null,
			kind,
			key,
			question,
			title: hold
				? holdTitle(question, queued?.title ?? d.summary, choices?.intro)
				: titleOf(question, choices),
			origin: null,
			following: null,
			askedAt: null,
			owner: hold ? 'captain' : 'firstmate',
			evidence,
			options: optionsFor(kind, !!choices),
			recommendation: rec_ ? { choice: choiceOf(rec_), text: home(reasonOf(rec_)) } : null,
			choices,
			secondMate: { id: rec.id, taskId: d.id, taskTitle: title },
			sent: null
		});
	});
	return out;
}

/** Every open question, the captain's first (oldest first), then Firstmate's. */
export function buildInbox(src: InboxSources): InboxCard[] {
	let cards: InboxCard[] = [];
	for (const t of src.tasks) {
		if (t.status === 'landed' || t.status === 'closed') continue;
		// A second mate's task's questions are its second mate's cards (mateCards), never asked twice.
		if (t.secondMate) continue;
		const captain = t.attention?.owner === 'captain';
		if (captain && t.attention?.kind === 'review') cards.push(mergeCard(t, src));
		if (captain && t.attention?.kind === 'decision') cards.push(holdCard(t, src));
		cards.push(...decisionCards(t, src));
	}
	for (const rec of src.secondMates ?? []) cards.push(...mateCards(rec, src));
	for (const c of cards) c.sent = sentFor(c, src.messages);
	// A dismissal that was taken ends the question here; a failed one leaves it waiting.
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
