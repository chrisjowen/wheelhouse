import {
	CHECK_OUTCOMES,
	durationMs,
	EVIDENCE_KINDS,
	FACTS,
	refsOf,
	type CheckSpec,
	type Cond,
	type Note,
	type PassageFile
} from './schema';
import type { Track } from '../../types';

/**
 * Layering: a built-in base passage, then the project's `.wheelhouse.yaml`
 * (default branch only), then the captain-owned file. Each layer is merged on
 * top of what the layers below produced and the result is checked as a whole;
 * a layer that does not fit is left out with its errors, so a broken file
 * never blanks the dashboard: the passage falls back to the layers below it.
 */

export type Origin = 'builtin' | 'project' | 'captain';

export interface ResolvedStep {
	id: string;
	label: string;
	short: string;
	column: string;
	reached_when?: Cond;
	skip_when?: Cond;
	skip_note?: string;
	failed_when?: Cond;
	evidence: string[];
	primary_link?: string;
	giveUpAfter?: { text: string; ms: number };
	note?: Note;
	/** Where the step was declared. */
	origin: Origin;
	/** Layers that restyled it. */
	changedBy: Origin[];
}

export interface ResolvedCheck {
	id: string;
	spec: CheckSpec;
	origin: Origin;
}

export interface ResolvedPassage {
	track: Track;
	steps: ResolvedStep[];
	checks: Map<string, ResolvedCheck>;
	/** Tasks at or past this step count toward the watch report's "N live". */
	liveStep: string | null;
}

export interface Layer {
	origin: Exclude<Origin, 'builtin'>;
	file: PassageFile;
}

export function fromBase(file: PassageFile): ResolvedPassage {
	const track = file.id ?? 'ship';
	return {
		track,
		steps: file.stages.map((s) => ({
			id: s.id,
			label: s.label ?? s.id,
			short: s.short ?? s.label ?? s.id,
			column: s.column ?? s.id,
			...(s.reached_when !== undefined ? { reached_when: s.reached_when } : {}),
			...(s.skip_when !== undefined ? { skip_when: s.skip_when } : {}),
			...(s.skip_note !== undefined ? { skip_note: s.skip_note } : {}),
			...(s.failed_when !== undefined ? { failed_when: s.failed_when } : {}),
			evidence: [...(s.evidence ?? [])],
			...(s.primary_link ? { primary_link: s.primary_link } : {}),
			...(s.give_up_after ? { giveUpAfter: give(s.give_up_after) } : {}),
			...(s.note !== undefined ? { note: s.note } : {}),
			origin: 'builtin',
			changedBy: []
		})),
		checks: new Map(
			Object.entries(file.checks).map(([id, spec]) => [id, { id, spec, origin: 'builtin' }])
		),
		liveStep: file.headline?.live ?? null
	};
}

const give = (text: string) => ({ text, ms: durationMs(text) ?? 0 });

const CONDITION_FIELDS = ['reached_when', 'skip_when', 'skip_note', 'failed_when'] as const;

/** Merge one overlay onto a resolved passage. Returns the errors instead when it does not fit. */
export function applyLayer(
	base: ResolvedPassage,
	layer: Layer
): { ok: true; passage: ResolvedPassage } | { ok: false; errors: string[] } {
	const errors: string[] = [];
	const { file, origin } = layer;
	if ((file.extends ?? 'ship') !== base.track) {
		return {
			ok: false,
			errors: [`extends ${file.extends}, but this is the ${base.track} passage`]
		};
	}
	const steps = base.steps.map((s) => ({
		...s,
		evidence: [...s.evidence],
		changedBy: [...s.changedBy]
	}));
	const checks = new Map(base.checks);
	for (const [id, spec] of Object.entries(file.checks)) checks.set(id, { id, spec, origin });

	// New steps placed after the same anchor keep the file's order.
	const lastAfter = new Map<string, string>();
	for (const s of file.stages) {
		const existing = steps.find((x) => x.id === s.id);
		if (existing) {
			if (s.after !== undefined) errors.push(`${s.id}.after: only a new step can be placed`);
			if (s.column !== undefined) errors.push(`${s.id}.column: only a new step can set its column`);
			if (existing.origin === 'builtin') {
				for (const f of CONDITION_FIELDS) {
					if (s[f] !== undefined) {
						errors.push(`${s.id}.${f}: a built-in step's ${f} cannot be changed`);
					}
				}
			} else {
				for (const f of CONDITION_FIELDS) {
					if (s[f] !== undefined) (existing as Record<string, unknown>)[f] = s[f];
				}
			}
			if (s.label !== undefined) existing.label = s.label;
			if (s.short !== undefined || s.label !== undefined) existing.short = s.short ?? s.label!;
			if (s.evidence !== undefined) existing.evidence = [...s.evidence];
			if (s.primary_link !== undefined) existing.primary_link = s.primary_link;
			if (s.give_up_after !== undefined) existing.giveUpAfter = give(s.give_up_after);
			if (s.note !== undefined) existing.note = s.note;
			if (!existing.changedBy.includes(origin)) existing.changedBy.push(origin);
			continue;
		}
		if (s.label === undefined) errors.push(`${s.id}.label: a new step needs a label`);
		if (s.reached_when === undefined) {
			errors.push(`${s.id}.reached_when: a new step needs reached_when`);
		}
		let at = steps.length;
		if (s.after !== undefined) {
			const anchor = lastAfter.get(s.after) ?? s.after;
			const i = steps.findIndex((x) => x.id === anchor);
			if (i < 0) {
				errors.push(`${s.id}.after: unknown step '${s.after}'`);
				continue;
			}
			at = i + 1;
			lastAfter.set(s.after, s.id);
		}
		steps.splice(at, 0, {
			id: s.id,
			label: s.label ?? s.id,
			short: s.short ?? s.label ?? s.id,
			column: s.column ?? s.id,
			...(s.reached_when !== undefined ? { reached_when: s.reached_when } : {}),
			...(s.skip_when !== undefined ? { skip_when: s.skip_when } : {}),
			...(s.skip_note !== undefined ? { skip_note: s.skip_note } : {}),
			...(s.failed_when !== undefined ? { failed_when: s.failed_when } : {}),
			evidence: [...(s.evidence ?? [])],
			...(s.primary_link ? { primary_link: s.primary_link } : {}),
			...(s.give_up_after ? { giveUpAfter: give(s.give_up_after) } : {}),
			...(s.note !== undefined ? { note: s.note } : {}),
			origin,
			changedBy: []
		});
	}
	const passage: ResolvedPassage = {
		track: base.track,
		steps,
		checks,
		liveStep: file.headline?.live ?? base.liveStep
	};
	errors.push(...checkReferences(passage));
	return errors.length ? { ok: false, errors } : { ok: true, passage };
}

/** Every reference in a resolved passage must name a fact, a step, or a declared check and outcome. */
export function checkReferences(p: ResolvedPassage): string[] {
	const errors: string[] = [];
	const ref = (where: string, r: string) => {
		if (r in FACTS) return;
		const dot = r.indexOf('.');
		const id = r.slice(0, dot);
		const outcome = r.slice(dot + 1);
		const c = p.checks.get(id);
		if (!c) {
			errors.push(`${where}: unknown reference '${r}'`);
			return;
		}
		const outcomes = CHECK_OUTCOMES[c.spec.type];
		if (!outcomes.includes(outcome)) {
			errors.push(
				`${where}: unknown reference '${r}' (${id} is a ${c.spec.type} check: ${outcomes.join(', ')})`
			);
		}
	};
	const conds = (where: string, c: Cond | undefined) => {
		for (const r of refsOf(c)) ref(where, r);
	};
	p.steps.forEach((s, i) => {
		if (i > 0 && s.reached_when === undefined) errors.push(`${s.id}.reached_when: is required`);
		conds(`${s.id}.reached_when`, s.reached_when);
		conds(`${s.id}.skip_when`, s.skip_when);
		conds(`${s.id}.failed_when`, s.failed_when);
		if (s.note && typeof s.note === 'object') conds(`${s.id}.note.when`, s.note.when);
		for (const e of s.evidence) {
			if (EVIDENCE_KINDS.includes(e)) continue;
			if (e.startsWith('check:') && p.checks.has(e.slice(6))) continue;
			errors.push(
				`${s.id}.evidence: unknown '${e}' (use ${EVIDENCE_KINDS.join(', ')}, or check:<check>)`
			);
		}
		if (s.primary_link) {
			const id = s.primary_link.slice(0, -'.url'.length);
			if (!p.checks.has(id)) errors.push(`${s.id}.primary_link: unknown check '${id}'`);
		}
		if (s.giveUpAfter && !referencedChecks(s).length) {
			errors.push(`${s.id}.give_up_after: the step references no check to give up on`);
		}
	});
	for (const c of p.checks.values()) {
		if (c.spec.type === 'npm.published') {
			const from = p.checks.get(c.spec.version_from);
			if (!from || from.spec.type !== 'github.release') {
				errors.push(
					`checks.${c.id}.version_from: '${c.spec.version_from}' is not a github.release check`
				);
			}
		}
	}
	if (p.liveStep && !p.steps.some((s) => s.id === p.liveStep)) {
		errors.push(`headline.live: unknown step '${p.liveStep}'`);
	}
	return errors;
}

/** Check ids a step's conditions reference. */
export function referencedChecks(s: ResolvedStep): string[] {
	const ids = new Set<string>();
	for (const c of [s.reached_when, s.failed_when]) {
		for (const r of refsOf(c)) if (!(r in FACTS)) ids.add(r.slice(0, r.indexOf('.')));
	}
	return [...ids];
}

/** Resolve a base passage with overlays, leaving out (with their errors) layers that do not fit. */
export function resolvePassage(
	base: PassageFile,
	layers: Layer[]
): { passage: ResolvedPassage; errors: Map<Layer['origin'], string[]> } {
	let passage = fromBase(base);
	const errors = new Map<Layer['origin'], string[]>();
	for (const layer of layers) {
		const r = applyLayer(passage, layer);
		if (r.ok) passage = r.passage;
		else errors.set(layer.origin, r.errors);
	}
	return { passage, errors };
}
