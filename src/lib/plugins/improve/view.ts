import { parse } from 'yaml';
import type { TaskSummary } from '../../types';
import type {
	HarnessView,
	ImproveUi,
	Pattern,
	ProposalDecision,
	ProposalItem,
	Visibility
} from './types';
import {
	countMix,
	countRows,
	countsSentence,
	deliveryLabel,
	firstSentence,
	KIND_LABEL,
	kindOf,
	patternSentence,
	statusGroup,
	statusLabel,
	statusShort,
	surfaceLabel,
	visibilityLabel,
	visibilityOfDelivery,
	visibilityShort
} from './words';

/**
 * Turns what improve's Firstmate adapter printed, and improve's own proposal
 * files, into the HarnessView the panels draw. Pure: every input has already
 * been read; nothing here runs or reads anything, and nothing is decided that
 * improve did not decide (visibility, routing and due-ness are improve's).
 */

const isRecord = (v: unknown): v is Record<string, unknown> =>
	typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string | null =>
	typeof v === 'string' && v.trim() ? v.replace(/\s+/g, ' ').trim() : null;
const num = (v: unknown): number | null => (typeof v === 'number' && isFinite(v) ? v : null);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

/** improve's verdict on a proposal's files (`proposal-check-cli`'s `firstmate` block). */
export interface Check {
	visibility: Visibility;
	surfaces: string[];
	delivery: string | null;
	/** Why improve refuses or splits it, if it does. */
	finding: string | null;
}

/** One record in `.harness/firstmate/routed.json`, as `decisions` prints it. */
export interface Routed {
	file: string;
	proposal: string | null;
	taskId: string;
	delivery: string | null;
	routedAt: string | null;
}

export interface Raw {
	/** `cli.mjs detect`. */
	detect: unknown;
	/** `cli.mjs import`, without --save. */
	observations: unknown;
	/** `cli.mjs inventory`. */
	inventory: unknown;
	/** `cli.mjs route` (a dry run): its entries, or why routing is unavailable. */
	route: { ok: true; entries: unknown[] } | { ok: false; reason: string };
	/** `cli.mjs decisions` (a dry run): the proposals already filed. */
	routed: Routed[];
	/** Each file under `.harness/proposals/`, with its text when it could be read. */
	proposals: { file: string; text: string | null }[];
	checks: Record<string, Check>;
	/** `.harness/firstmate/review-state.json`. */
	reviewState: unknown;
	/** `cli.mjs due`, or null when it was not run (it would have started the count). */
	due: unknown;
	tasks: TaskSummary[];
	ui: ImproveUi;
	problems: string[];
	now: number;
}

/** `cli.mjs decisions` output as routed records. */
export function parseRouted(v: unknown): Routed[] {
	return arr(v).flatMap((r) => {
		if (!isRecord(r) || !str(r.file) || !str(r.task_id)) return [];
		return [
			{
				file: str(r.file)!,
				proposal: str(r.proposal),
				taskId: str(r.task_id)!,
				delivery: str(r.delivery),
				routedAt: str(r.routed_at)
			}
		];
	});
}

/** `.harness/firstmate/routed.json` as routed records. */
export function parseLedger(text: string | null): Routed[] {
	if (!text) return [];
	try {
		const v = JSON.parse(text);
		if (!isRecord(v) || !isRecord(v.proposals)) return [];
		return parseRouted(
			Object.entries(v.proposals).map(([file, r]) => (isRecord(r) ? { file, ...r } : null))
		);
	} catch {
		return [];
	}
}

/** `proposal-check-cli` prints one indented JSON object per file, back to back. */
export function parseChecks(stdout: string): Record<string, Check> {
	const out: Record<string, Check> = {};
	for (const chunk of stdout.split(/\n(?=\{)/)) {
		let r: unknown;
		try {
			r = JSON.parse(chunk);
		} catch {
			continue;
		}
		if (!isRecord(r) || !str(r.file)) continue;
		const fm = isRecord(r.firstmate) ? r.firstmate : {};
		const v = fm.visibility;
		const findings = arr(fm.findings).filter(isRecord);
		out[str(r.file)!.split('/').pop()!] = {
			visibility: v === 'captain-private' || v === 'shared-tracked' || v === 'mixed' ? v : null,
			surfaces: arr(fm.surfaces).filter((s): s is string => typeof s === 'string'),
			delivery: str(fm.delivery),
			finding: findings.length ? str(findings[0].detail) : null
		};
	}
	return out;
}

/** The fields of a proposal file the pages show; a file that does not parse keeps its name. */
export function readProposal(file: string, text: string | null) {
	let y: Record<string, unknown> = {};
	if (text) {
		try {
			const v = parse(text);
			if (isRecord(v)) y = v;
		} catch {
			// not YAML improve can use either; show the file by name
		}
	}
	const scope = isRecord(y.scope) ? y.scope : {};
	const intervention = isRecord(y.intervention) ? y.intervention : {};
	return {
		file,
		id: str(y.id) ?? file.replace(/\.ya?ml$/i, ''),
		title: str(y.title) ?? file,
		status: str(y.status) ?? 'draft',
		layer: str(y.layer),
		changes: str(intervention.summary),
		why: str(y.hypothesis) ?? str(y.objective),
		files: arr(scope.files).filter((f): f is string => typeof f === 'string'),
		evidence: arr(y.evidence)
			.filter(isRecord)
			.map((e) => ({ source: str(e.source) ?? 'evidence', observation: str(e.observation) ?? '' }))
			.filter((e) => e.observation),
		confidence: str(y.confidence),
		createdAt:
			str(y.created_at) ?? (y.created_at instanceof Date ? y.created_at.toISOString() : null)
	};
}

const LANDED = new Set(['done', 'landed']);

/** Where a routed proposal's Firstmate task stands, in plain words. */
export function decisionOf(
	r: Routed,
	tasks: TaskSummary[],
	changedSinceFiling: boolean
): ProposalDecision {
	const t = tasks.find((x) => x.id === r.taskId);
	const state = !t
		? 'Filed as a decision'
		: t.attention?.owner === 'captain'
			? 'Waiting for your call'
			: LANDED.has(t.status)
				? 'Answered'
				: t.statusLabel || 'Filed as a decision';
	return {
		taskId: r.taskId,
		href: t ? `/tasks/${encodeURIComponent(t.id)}` : null,
		state,
		routedAt: r.routedAt,
		changedSinceFiling
	};
}

/** A proposal in improve's own UI: its own page where the UI has one, else the UI's front page. */
export function proposalUrl(ui: ImproveUi, file: string): string {
	return ui.deepLinks ? `${ui.url}/proposals?p=${encodeURIComponent(file)}` : ui.url;
}

export function openUrl(ui: ImproveUi, file: string): string | null {
	return ui.running ? proposalUrl(ui, file) : null;
}

/** One proposal, from its file, improve's check, its routing and its Firstmate task. */
export function proposalItem(
	p: ReturnType<typeof readProposal>,
	o: {
		check: Check | null;
		routed: Routed | null;
		route: Record<string, unknown> | null;
		tasks: TaskSummary[];
		ui: ImproveUi;
	}
): ProposalItem {
	const routeVis = o.route?.visibility;
	const visibility: Visibility =
		o.check?.visibility ??
		(routeVis === 'captain-private' || routeVis === 'shared-tracked'
			? routeVis
			: visibilityOfDelivery(o.routed?.delivery ?? o.route?.delivery));
	const raw = o.check?.surfaces.length
		? o.check.surfaces
		: arr(o.route?.surfaces).filter((s): s is string => typeof s === 'string');
	const surfaces = raw.map(surfaceLabel);
	const kind = kindOf(raw, p.layer);
	const refused = o.check?.delivery === 'refuse' ? o.check.finding : null;
	const filing = o.route?.action === 'hold';
	const routing =
		p.status !== 'proposed'
			? null
			: o.routed && filing
				? 'Changed since it was filed; the next review files it again.'
				: !o.routed && filing
					? 'Not filed yet: the next /improve review files it as a decision for you.'
					: !o.routed && o.route?.action === 'skip' && str(o.route.why)
						? `Not filed: ${str(o.route.why)}.`
						: null;
	return {
		...p,
		statusLabel: statusLabel(p.status),
		statusShort: statusShort(p.status),
		group: statusGroup(p.status),
		kind,
		kindLabel: KIND_LABEL[kind],
		summary: firstSentence(p.changes),
		waiting: p.status === 'proposed',
		surfaces: [...new Set(surfaces)],
		visibility,
		visibilityLabel: visibilityLabel(visibility),
		visibilityShort: visibilityShort(visibility),
		deliveryLabel: deliveryLabel(
			visibility,
			refused?.replace(/^This proposal /, '').replace(/\.$/, '') ?? null
		),
		decision: o.routed ? decisionOf(o.routed, o.tasks, !!o.routed && filing) : null,
		routing,
		openUrl: openUrl(o.ui, p.file)
	};
}

function patterns(obs: Record<string, unknown>): Pattern[] {
	const rep = isRecord(obs.repeated) ? obs.repeated : {};
	const from = (kind: 'ask-user' | 'decision', list: unknown, answers: string) =>
		arr(list)
			.filter(isRecord)
			.flatMap((g) => {
				const example = str(g.example);
				const count = num(g.count);
				if (!example || !count) return [];
				const tasks = arr(g.tasks).length;
				return [
					{
						sentence: patternSentence(kind, count, tasks, example),
						example,
						kind: kind === 'ask-user' ? ('review' as const) : ('decision' as const),
						count,
						tasks,
						answers: [
							...new Set(
								arr(g[answers])
									.filter((a): a is string => typeof a === 'string')
									.map((a) => a.replace(/^answered:\s*/i, ''))
							)
						]
					}
				];
			});
	return [
		...from('ask-user', rep.ask_user_findings, 'decided_answers'),
		...from('decision', rep.decisions, 'answers')
	].sort((a, b) => b.count - a.count);
}

function inventoryLines(inv: unknown): string[] {
	if (!isRecord(inv)) return [];
	const lines: string[] = [];
	const c = isRecord(inv.contract) ? inv.contract : null;
	const tokens = num(c?.estimated_tokens);
	if (c && tokens !== null) {
		const share = num(c.startup_memory_budget_tokens) ? num(c.share_of_budget) : null;
		lines.push(
			`${str(c.file) ?? 'AGENTS.md'} is about ${tokens.toLocaleString('en')} tokens${
				share !== null ? `, ${Math.round(share * 100)}% of the startup budget` : ''
			}.`
		);
	}
	const sk = isRecord(inv.skills) ? inv.skills : null;
	const n = num(sk?.count);
	if (n !== null) {
		const largest = arr(sk?.largest).filter(isRecord)[0];
		lines.push(
			`${n} ${n === 1 ? 'skill' : 'skills'}${
				largest && str(largest.skill) ? `; the largest is ${str(largest.skill)}` : ''
			}.`
		);
	}
	return lines;
}

function sizeOf(inv: unknown): HarnessView['size'] {
	if (!isRecord(inv) || !isRecord(inv.contract)) return null;
	const c = inv.contract;
	const tokens = num(c.estimated_tokens);
	if (tokens === null) return null;
	const sk = isRecord(inv.skills) ? inv.skills : null;
	const largest = arr(sk?.largest).filter(isRecord)[0];
	return {
		contractFile: str(c.file) ?? 'AGENTS.md',
		contractTokens: tokens,
		budgetShare: num(c.startup_memory_budget_tokens) ? num(c.share_of_budget) : null,
		skills: num(sk?.count),
		largestSkill: largest ? str(largest.skill) : null
	};
}

function review(raw: Raw): HarnessView['review'] {
	const state0 = isRecord(raw.reviewState) ? raw.reviewState : {};
	if (!isRecord(raw.detect)) {
		return {
			due: null,
			headline: 'Wheelhouse could not read improve’s review schedule.',
			reasons: [],
			lastReviewedAt: str(state0.last_reviewed_at),
			periodic: ''
		};
	}
	const d = raw.detect;
	const periodic = isRecord(d.periodic_review) ? d.periodic_review : {};
	const state = isRecord(raw.reviewState) ? raw.reviewState : {};
	const lastReviewedAt = str(state.last_reviewed_at);
	const on = periodic.enabled === true;
	const tasks = num(periodic.every_tasks);
	const days = num(periodic.every_days);
	const every = [tasks ? `${tasks} tasks` : null, days ? `${days} days` : null].filter(Boolean);
	const periodicText = !on
		? 'Periodic review is off, so improve will not remind you; run /improve review when you want one.'
		: `Periodic review comes after ${every.join(' or ') || 'a while'}${every.length > 1 ? ', whichever is first' : ''}.`;
	const due = isRecord(raw.due) ? raw.due : null;
	const reasons = arr(due?.reasons).filter((r): r is string => typeof r === 'string');
	if (!on) {
		return {
			due: null,
			headline: 'No review is scheduled: periodic review is off.',
			reasons: [],
			lastReviewedAt,
			periodic: periodicText
		};
	}
	if (!due) {
		return {
			due: null,
			headline: 'Periodic review is on; improve starts counting at its next Claude Code session.',
			reasons: [],
			lastReviewedAt,
			periodic: periodicText
		};
	}
	const isDue = due.due === true;
	return {
		due: isDue,
		headline: isDue
			? `A harness review is due: ${reasons[0] ?? 'improve says so'}.`
			: 'No harness review is due.',
		reasons,
		lastReviewedAt,
		periodic: periodicText
	};
}

export function buildHarness(raw: Raw): HarnessView {
	const obs = isRecord(raw.observations) ? raw.observations : {};
	const counts = isRecord(obs.counts) ? obs.counts : {};
	const routeEntries = raw.route.ok ? raw.route.entries.filter(isRecord) : [];
	const proposals = raw.proposals
		.map(({ file, text }) =>
			proposalItem(readProposal(file, text), {
				check: raw.checks[file] ?? null,
				routed: raw.routed.find((r) => r.file === file) ?? null,
				route: routeEntries.find((e) => e.file === file) ?? null,
				tasks: raw.tasks,
				ui: raw.ui
			})
		)
		// Waiting first, then the newest.
		.sort(
			(a, b) =>
				Number(b.waiting) - Number(a.waiting) ||
				(b.createdAt ?? '').localeCompare(a.createdAt ?? '') ||
				a.file.localeCompare(b.file)
		);
	const problems = [...raw.problems];
	if (!raw.route.ok)
		problems.push(`Proposals are not filed as decisions here: ${raw.route.reason}`);
	return {
		schema: 'wheelhouse-improve.v1',
		review: review(raw),
		waiting: proposals.filter((p) => p.waiting).length,
		proposals,
		evidence: {
			importedAt: str(obs.imported_at),
			summary: countsSentence(counts),
			counts: countRows(counts),
			mix: countMix(counts),
			patterns: patterns(obs)
		},
		inventory: inventoryLines(raw.inventory),
		size: sizeOf(raw.inventory),
		problems,
		ui: raw.ui
	};
}
