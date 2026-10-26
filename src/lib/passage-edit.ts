import {
	isMap,
	isScalar,
	isSeq,
	parseDocument,
	type Document,
	type YAMLMap,
	type YAMLSeq
} from 'yaml';
import { diffLines, linesOf } from './linediff';
import type { PassageEditorBase, Track } from './types';

/**
 * The passage editor's model: edits made in the form are applied to the
 * file's YAML document, so comments and layout the captain wrote survive a
 * form edit. Pure functions over text, for the browser; the server validates
 * every result with the strict validator.
 */

export type Cond =
	| string
	| { all: Cond[] }
	| { any: Cond[] }
	| { not: Cond }
	| { mode: string }
	| { yolo: 'on' | 'off' };

export interface StageLike {
	id?: unknown;
	label?: unknown;
	short?: unknown;
	after?: unknown;
	reached_when?: Cond;
	failed_when?: Cond;
	skip_when?: Cond;
	skip_note?: unknown;
	evidence?: unknown;
	primary_link?: unknown;
	give_up_after?: unknown;
	note?: unknown;
	[k: string]: unknown;
}

export interface FileModel {
	extends: Track;
	checks: Record<string, Record<string, unknown>>;
	stages: StageLike[];
}

export const starterText = (track: Track = 'ship') => `version: 1\nextends: ${track}\n`;

/** Parse text into a document, or say why it is not YAML. */
export function load(text: string): { doc: Document; error: string | null } {
	const doc = parseDocument(text || starterText(), { uniqueKeys: true });
	return {
		doc,
		error: doc.errors.length ? doc.errors[0].message.split('\n')[0] : null
	};
}

/** The file as plain data (whatever shape it has; the server says what is wrong with it). */
export function model(text: string): FileModel | null {
	const { doc, error } = load(text);
	if (error) return null;
	let js: unknown;
	try {
		js = doc.toJS({ maxAliasCount: 0 });
	} catch {
		return null;
	}
	const o = (js && typeof js === 'object' && !Array.isArray(js) ? js : {}) as Record<
		string,
		unknown
	>;
	const checks =
		o.checks && typeof o.checks === 'object' && !Array.isArray(o.checks)
			? (o.checks as FileModel['checks'])
			: {};
	const stages = Array.isArray(o.stages)
		? (o.stages.filter((s) => s && typeof s === 'object') as StageLike[])
		: [];
	return { extends: o.extends === 'scout' ? 'scout' : 'ship', checks, stages };
}

/** One step in the editor's list: the passage in order, below layers and the file together. */
export interface ListedStep {
	id: string;
	label: string;
	/** Declared below the file (built-in or a lower layer), or added by this file. */
	added: boolean;
	/** Index of the file's entry for this step, if the file has one. */
	fileIndex: number | null;
	/** The file renames or restyles a step declared below it. */
	restyled: boolean;
	/** The file places it after a step that does not exist. */
	lost: boolean;
}

/** The steps in passage order, placing the file's new steps the way Wheelhouse does. */
export function listSteps(base: PassageEditorBase, stages: StageLike[]): ListedStep[] {
	const steps: ListedStep[] = base.steps.map((s) => ({
		id: s.id,
		label: s.label,
		added: false,
		fileIndex: null,
		restyled: false,
		lost: false
	}));
	const lastAfter = new Map<string, string>();
	stages.forEach((s, i) => {
		if (typeof s.id !== 'string' || !s.id) return;
		const label = typeof s.label === 'string' && s.label ? s.label : null;
		const existing = steps.find((x) => x.id === s.id);
		if (existing) {
			if (existing.added) return; // listed twice; the validator says so
			existing.fileIndex = i;
			existing.restyled = true;
			if (label) existing.label = label;
			return;
		}
		let at = steps.length;
		let lost = false;
		if (typeof s.after === 'string' && s.after) {
			const anchor = lastAfter.get(s.after) ?? s.after;
			const j = steps.findIndex((x) => x.id === anchor);
			if (j < 0) lost = true;
			else at = j + 1;
			lastAfter.set(s.after, s.id);
		}
		steps.splice(at, 0, {
			id: s.id,
			label: label ?? s.id,
			added: true,
			fileIndex: i,
			restyled: false,
			lost
		});
	});
	return steps;
}

function stagesSeq(doc: Document): YAMLSeq {
	let seq = doc.get('stages', true);
	if (!isSeq(seq)) {
		seq = doc.createNode([]) as YAMLSeq;
		doc.set('stages', seq);
	}
	return seq as YAMLSeq;
}

const keyOf = (k: unknown) => (isScalar(k) ? k.value : k);

function checksMap(doc: Document): YAMLMap {
	let map = doc.get('checks', true);
	if (!isMap(map)) {
		map = doc.createNode({}) as YAMLMap;
		// Checks read best before the stages that use them.
		doc.set('checks', map);
		const contents = doc.contents as YAMLMap;
		const items = contents.items;
		const ci = items.findIndex((p) => keyOf(p.key) === 'checks');
		const si = items.findIndex((p) => keyOf(p.key) === 'stages');
		if (si >= 0 && ci > si) items.splice(si, 0, ...items.splice(ci, 1));
	}
	return map as YAMLMap;
}

const empty = (v: unknown) =>
	v === undefined ||
	v === null ||
	v === '' ||
	(Array.isArray(v) && v.length === 0) ||
	(typeof v === 'object' && !Array.isArray(v) && Object.keys(v as object).length === 0);

const OUT = { lineWidth: 0 } as const;

/**
 * Apply an edit to the text's document and return the new text. Lines the
 * edit did not change keep exactly how the captain wrote them: the document
 * is printed before and after the edit, and every line both printings share
 * is taken from the original text (when printing kept its line count).
 */
export function edit(text: string, fn: (doc: Document) => unknown): string {
	const { doc, error } = load(text);
	if (error) return text;
	const before = linesOf(doc.toString(OUT));
	if (fn(doc) === false) return text;
	const after = doc.toString(OUT);
	const original = linesOf(text);
	if (!text || original.length !== before.length) return after;
	const out = diffLines(before, linesOf(after))
		.filter((d) => d.op !== '-')
		.map((d) => (d.op === ' ' ? original[d.from!] : d.text));
	return `${out.join('\n')}\n`;
}

/** Set (or remove, when empty) a field of the file's stage entry at `index`. */
export function setStageField(doc: Document, index: number, key: string, value: unknown): void {
	const node = stagesSeq(doc).get(index, true);
	if (!isMap(node)) return;
	if (empty(value)) node.delete(key);
	else node.set(key, node_(doc, value));
}

/** A new node; lists are written inline (`[a, b]`), as passage files usually are. */
function node_(doc: Document, value: unknown) {
	const n = doc.createNode(value);
	if (isSeq(n) && n.items.every((x) => isScalar(x))) n.flow = true;
	return n;
}

/** Rename a step's id (a step added in this session), updating what refers to it. */
export function renameStage(doc: Document, from: string, to: string): void {
	const seq = stagesSeq(doc);
	for (const n of seq.items) {
		if (!isMap(n)) continue;
		if (n.get('id') === from) n.set('id', to);
		if (n.get('after') === from) n.set('after', to);
		if (n.get('column') === from) n.set('column', to);
	}
	if (doc.getIn(['headline', 'live']) === from) doc.setIn(['headline', 'live'], to);
}

/** The file's entry for a step declared below it, created when the file has none. */
export function entryFor(doc: Document, id: string): number {
	const seq = stagesSeq(doc);
	const i = seq.items.findIndex((n) => isMap(n) && n.get('id') === id);
	if (i >= 0) return i;
	seq.add(doc.createNode({ id }));
	return seq.items.length - 1;
}

/** Remove the file's stage entry at `index` (a new step, or a restyle of one below). */
export function removeStage(doc: Document, index: number): void {
	stagesSeq(doc).delete(index);
}

/** A new step id from its name, unique among `taken`. */
export function slug(name: string, taken: Iterable<string>, fallback = 'step'): string {
	const used = new Set(taken);
	let base =
		name
			.toLowerCase()
			.normalize('NFKD')
			.replace(/[^a-z0-9]+/g, '-')
			.replace(/^-+|-+$/g, '')
			.slice(0, 32) || fallback;
	if (!/^[a-z]/.test(base)) base = `${fallback}-${base}`.slice(0, 32);
	let id = base;
	for (let n = 2; used.has(id); n++) id = `${base}-${n}`;
	return id;
}

/** Add a new step after `afterId`; returns its file index. */
export function addStage(doc: Document, stage: StageLike, afterId: string | null): number {
	const seq = stagesSeq(doc);
	const s: Record<string, unknown> = { id: stage.id, label: stage.label };
	if (afterId) s.after = afterId;
	for (const [k, v] of Object.entries(stage)) if (!(k in s) && !empty(v)) s[k] = v;
	const n = doc.createNode(s) as YAMLMap;
	for (const p of n.items) {
		if (isSeq(p.value) && p.value.items.every((x) => isScalar(x))) p.value.flow = true;
	}
	seq.add(n);
	return seq.items.length - 1;
}

/**
 * Put an added step at `index` in the passage. Every added step is then
 * placed explicitly after the step before it, and the file lists them in
 * passage order, so Wheelhouse places them exactly as shown.
 */
export function placeStage(
	doc: Document,
	base: PassageEditorBase,
	id: string,
	index: number
): boolean {
	const js = doc.toJS() as { stages?: StageLike[] } | null;
	const list = listSteps(base, Array.isArray(js?.stages) ? js!.stages! : []);
	const i = list.findIndex((s) => s.id === id);
	if (i < 0 || !list[i].added || index < 1 || index >= list.length || index === i) return false;
	const [moved] = list.splice(i, 1);
	list.splice(index, 0, moved);
	const seq = stagesSeq(doc);
	const byId = new Map<string, unknown>();
	for (const n of seq.items) if (isMap(n)) byId.set(String(n.get('id')), n);
	const kept = seq.items.filter((n) => {
		const nid = isMap(n) ? String(n.get('id')) : '';
		return !list.some((s) => s.added && s.id === nid);
	});
	const added = list
		.map((s, k) => ({ s, prev: list[k - 1] }))
		.filter(({ s }) => s.added)
		.map(({ s, prev }) => {
			const n = byId.get(s.id) as YAMLMap;
			n.set('after', prev.id);
			return n;
		});
	seq.items = [...kept, ...added];
	return true;
}

/** Move an added step one place up or down in the passage. */
export function moveStage(
	doc: Document,
	base: PassageEditorBase,
	id: string,
	delta: -1 | 1
): boolean {
	const js = doc.toJS() as { stages?: StageLike[] } | null;
	const list = listSteps(base, Array.isArray(js?.stages) ? js!.stages! : []);
	const i = list.findIndex((s) => s.id === id);
	return i >= 0 && placeStage(doc, base, id, i + delta);
}

/** Set a check (replacing it whole), or remove it with null. */
export function setCheck(doc: Document, id: string, spec: Record<string, unknown> | null): void {
	const map = checksMap(doc);
	if (spec === null) {
		map.delete(id);
		if (!map.items.length) doc.delete('checks');
		return;
	}
	const clean: Record<string, unknown> = {};
	for (const [k, v] of Object.entries(spec)) {
		if (v && typeof v === 'object' && !Array.isArray(v)) {
			const inner = Object.fromEntries(Object.entries(v).filter(([, x]) => !empty(x)));
			if (!empty(inner)) clean[k] = inner;
		} else if (!empty(v)) clean[k] = v;
	}
	const existing = map.get(id, true);
	if (isMap(existing)) {
		// Keep the existing node (and its comments): update fields in place.
		for (const k of [...existing.items.map((p) => String(keyOf(p.key)))]) {
			if (!(k in clean)) existing.delete(k);
		}
		const now = existing.toJSON() as Record<string, unknown>;
		for (const [k, v] of Object.entries(clean)) {
			if (JSON.stringify(now[k]) !== JSON.stringify(v)) existing.set(k, node_(doc, v));
		}
	} else {
		const n = doc.createNode(clean) as YAMLMap;
		for (const p of n.items) {
			if (isSeq(p.value) && p.value.items.every((x) => isScalar(x))) p.value.flow = true;
		}
		map.set(id, n);
	}
}

/** Set a top-level field (extends, headline…), or remove it when empty. */
export function setTop(doc: Document, key: string, value: unknown): void {
	if (empty(value)) doc.delete(key);
	else doc.set(key, doc.createNode(value));
}

/** References that mention a check, so removing it can update them. */
export function refsTo(stages: StageLike[], checkId: string): string[] {
	const out: string[] = [];
	const walk = (c: unknown) => {
		if (typeof c === 'string' && c.startsWith(`${checkId}.`)) out.push(c);
		else if (c && typeof c === 'object') for (const v of Object.values(c)) walk(v);
	};
	for (const s of stages) {
		walk(s.reached_when);
		walk(s.failed_when);
		walk(s.skip_when);
		if (s.note && typeof s.note === 'object') walk((s.note as { when?: unknown }).when);
		if (Array.isArray(s.evidence) && s.evidence.includes(`check:${checkId}`))
			out.push(`check:${checkId}`);
		if (s.primary_link === `${checkId}.url`) out.push(`${checkId}.url`);
	}
	return out;
}

/** A condition the form can edit: all or any of a list of references, each possibly negated. */
export interface Builder {
	join: 'all' | 'any';
	items: { not: boolean; ref: string }[];
}

/** The builder for a condition, or null when it needs the YAML view (nesting, mode, yolo). */
export function toBuilder(c: Cond | undefined): Builder | null {
	if (c === undefined || c === null) return { join: 'all', items: [] };
	const item = (x: Cond): { not: boolean; ref: string } | null => {
		if (typeof x === 'string') return { not: false, ref: x };
		if (x && typeof x === 'object' && 'not' in x && typeof x.not === 'string')
			return { not: true, ref: x.not };
		return null;
	};
	const one = item(c);
	if (one) return { join: 'all', items: [one] };
	if (typeof c !== 'object') return null;
	const join = 'all' in c ? 'all' : 'any' in c ? 'any' : null;
	if (!join) return null;
	const list = (c as Record<string, unknown>)[join];
	if (!Array.isArray(list)) return null;
	const items = list.map((x) => item(x as Cond));
	return items.every((x) => x) ? { join, items: items as Builder['items'] } : null;
}

/** The condition a builder says (undefined when it says nothing). */
export function fromBuilder(b: Builder): Cond | undefined {
	const items = b.items.filter((x) => x.ref);
	const one = (x: { not: boolean; ref: string }): Cond => (x.not ? { not: x.ref } : x.ref);
	if (!items.length) return undefined;
	if (items.length === 1) return one(items[0]);
	return b.join === 'all' ? { all: items.map(one) } : { any: items.map(one) };
}
