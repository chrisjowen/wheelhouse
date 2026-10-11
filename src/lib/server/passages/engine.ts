import { builtinBasis } from './builtin';
import { referencedChecks, type ResolvedPassage, type ResolvedStep } from './resolve';
import { describeCond, refsOf, type Cond, type Note } from './schema';
import type { StageFacts } from '../firstmate/stages';
import type { Passage, PassageCheck, PassageStep } from '../../types';

/**
 * Stage rules: pure functions from Firstmate facts and check results to a
 * passage. Nothing here does I/O; checks run in the scheduler and arrive as
 * results.
 *
 * - The current step is the furthest step whose `reached_when` holds (a high
 *   water mark): every earlier step counts as done, even when its own facts
 *   are gone after cleanup.
 * - A later step whose `failed_when` holds becomes current and is marked
 *   failed (it does not create a "Needs you" item).
 * - `skip_when` marks a step skipped unless it is the current one.
 * - A check that could not tell is unknown: its step stays where it was, with
 *   a note, and is never treated as not reached. `not` over a check that has
 *   observed nothing does not hold.
 * - `floor` is the furthest step already recorded as reached (reached.ts), so
 *   a step reached once does not fall back when its checks can no longer
 *   observe it.
 */

/** A declared check's state for one task, as the stage rules see it. */
export interface CheckState {
	state: PassageCheck['state'];
	/** The outcome names that hold (a published npm version that is also latest holds both). */
	outcomes: string[];
	summary: string;
	url: string | null;
	observedAt: string | null;
}

export type CheckLookup = (checkId: string) => CheckState | undefined;

const norm = (s: string | null | undefined) => (s ?? '').toLowerCase().replace(/[_\s]/g, '-');

function fact(name: string, f: StageFacts): boolean {
	switch (name) {
		case 'task.live':
			return f.live;
		case 'backlog.queued':
			return f.backlogState === 'queued';
		case 'backlog.done':
			return f.backlogState === 'done';
		case 'nm.run':
			return f.crewSource === 'run-step';
		case 'pr.recorded':
			return !!f.prUrl;
		case 'pr.ready':
			return f.prReady;
		case 'crew.done':
			return f.crewState === 'done';
		case 'merged':
			return f.merged;
		case 'hold.captain':
			return f.captainHold;
		case 'report.present':
			return f.reportPresent;
		default:
			return false;
	}
}

export function holds(c: Cond | undefined, f: StageFacts, checks: CheckLookup): boolean {
	if (c === undefined) return false;
	if (typeof c === 'string') {
		const dot = c.indexOf('.');
		const check = dot > 0 ? checks(c.slice(0, dot)) : undefined;
		if (check) return check.outcomes.includes(c.slice(dot + 1));
		return fact(c, f);
	}
	if ('all' in c) return c.all.every((x) => holds(x, f, checks));
	if ('any' in c) return c.any.some((x) => holds(x, f, checks));
	if ('not' in c) {
		const unseen = refsOf(c.not).some((r) => {
			const dot = r.indexOf('.');
			return dot > 0 && checks(r.slice(0, dot))?.outcomes.length === 0;
		});
		return !unseen && !holds(c.not, f, checks);
	}
	if ('mode' in c) return norm(f.mode) === norm(c.mode);
	return c.yolo === 'on' ? norm(f.yolo) === 'on' : norm(f.yolo) !== 'on';
}

function noteText(n: Note | undefined, f: StageFacts, checks: CheckLookup): string | null {
	if (n === undefined) return null;
	if (typeof n === 'string') return n;
	return holds(n.when, f, checks) ? n.text : null;
}

/** Why an upcoming step cannot move yet, from the checks it depends on. */
function waitNote(s: ResolvedStep, checks: CheckLookup): string | null {
	const states = referencedChecks(s)
		.map((id) => checks(id))
		.filter((c): c is CheckState => !!c);
	// Every check a step depends on shares its give-up time, so one that gave up means the rest
	// either gave up too or already have their final answer.
	if (states.some((c) => c.state === 'gave-up')) {
		return `Not reached within ${s.giveUpAfter?.text ?? 'the time allowed'}; Wheelhouse stopped checking.`;
	}
	const off = states.find((c) => c.state === 'off');
	if (off) return off.summary;
	const unknown = states.find((c) => c.state === 'unknown');
	if (unknown) return `Can't tell: ${unknown.summary}`;
	return null;
}

const isHttp = (u: string | null): u is string => !!u && /^https?:\/\//i.test(u);

/** Evaluate a resolved passage for one task. */
export function evaluate(
	p: ResolvedPassage,
	f: StageFacts,
	checks: CheckLookup = () => undefined,
	labels: (id: string) => string = (id) => id,
	floor = 0
): Passage {
	let reached = 0;
	p.steps.forEach((s, i) => {
		if (holds(s.reached_when, f, checks)) reached = i;
	});
	reached = Math.max(reached, floor);
	let index = reached;
	let failed = false;
	for (let j = p.steps.length - 1; j > reached; j--) {
		if (holds(p.steps[j].failed_when, f, checks)) {
			index = j;
			failed = true;
			break;
		}
	}
	const steps: PassageStep[] = p.steps.map((s, i) => {
		const base = {
			key: s.id,
			label: s.label,
			short: s.short,
			column: s.column,
			evidence: [...s.evidence],
			failed: failed && i === index
		};
		if (i !== index && holds(s.skip_when, f, checks)) {
			return { ...base, state: 'skipped', note: s.skip_note ?? 'Skipped.' };
		}
		const fixed = noteText(s.note, f, checks);
		const waiting = i > index || (failed && i === index) ? waitNote(s, checks) : null;
		return {
			...base,
			state: i < index ? 'done' : i === index ? 'current' : 'upcoming',
			note: [waiting, fixed].filter(Boolean).join(' ') || null
		};
	});

	const cur = p.steps[index];
	let basis: string;
	if (failed) {
		basis = `${cur.label} failed: ${evidenceOf(cur.failed_when, f, checks)}`;
	} else if (cur.origin === 'builtin' || !cur.reached_when) {
		basis = builtinBasis(p.track, cur.id, f);
	} else {
		basis = `${cur.label}: ${evidenceOf(cur.reached_when, f, checks)}`;
	}

	let link: Passage['link'] = null;
	for (let i = index; i >= 0 && !link; i--) {
		const pl = p.steps[i].primary_link;
		if (!pl) continue;
		const id = pl.slice(0, -'.url'.length);
		const url = checks(id)?.url ?? null;
		if (isHttp(url)) link = { label: `Open ${labels(id)}`, url };
	}

	const liveAt = p.liveStep ? p.steps.findIndex((s) => s.id === p.liveStep) : -1;
	return {
		track: p.track,
		steps,
		current: index,
		basis,
		custom:
			p.steps.some((s) => s.origin !== 'builtin' || s.changedBy.length > 0) || p.checks.size > 0,
		live: liveAt < 0 ? null : reached >= liveAt,
		link,
		checks: [...p.checks.values()].map((c) => {
			const s = checks(c.id);
			return {
				id: c.id,
				label: labels(c.id),
				type: c.spec.type,
				state: s?.state ?? 'waiting',
				outcome: s && s.state !== 'off' ? (s.outcomes[0] ?? null) : null,
				summary: s?.summary ?? 'Not checked yet.',
				url: isHttp(s?.url ?? null) ? s!.url : null,
				observedAt: s?.observedAt ?? null
			};
		})
	};
}

/** The checks behind a condition that holds, in their own words; else the condition itself. */
function evidenceOf(c: Cond | undefined, f: StageFacts, checks: CheckLookup): string {
	if (c === undefined) return 'no condition';
	const said = [
		...new Set(
			refsOf(c)
				.filter((r) => holds(r, f, checks))
				.map((r) => checks(r.slice(0, r.indexOf('.'))))
				.filter((s) => s?.state !== 'unknown')
				.map((s) => s?.summary)
				.filter((s): s is string => !!s)
				.map((s) => s.replace(/\.$/, ''))
		)
	];
	return said.length ? said.join('; ') : describeCond(c);
}
