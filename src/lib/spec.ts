/**
 * The Spec tab's model: a guided spec the captain fills in section by
 * section, assembled into one Markdown document and sent to Firstmate as a
 * single message. Shared by the page (preview, sending) and the server (which
 * keeps drafts in Wheelhouse's state directory and validates what it stores).
 */

export const SPEC_SCHEMA = 'wheelhouse-spec.v1';

/** A screenshot or picture attached to the spec, stored beside it under `name`. */
export interface SpecImage {
	name: string;
	caption: string;
}

export interface SpecDraft {
	schema: typeof SPEC_SCHEMA;
	id: string;
	createdAt: string;
	updatedAt: string;
	/** When the spec was last sent to Firstmate. */
	sentAt: string | null;
	project: string;
	title: string;
	summary: string;
	problem: string;
	goal: string;
	audience: string;
	journeys: string[];
	scope: string;
	nonGoals: string;
	requirements: string[];
	uiNotes: string;
	links: string[];
	images: SpecImage[];
	constraints: string;
	risks: string;
	questions: string[];
}

/** What the drafts list shows. */
export interface SpecSummary {
	id: string;
	title: string;
	project: string;
	updatedAt: string;
	sentAt: string | null;
	filled: number;
}

export type SpecSectionId =
	| 'project'
	| 'problem'
	| 'audience'
	| 'journeys'
	| 'scope'
	| 'requirements'
	| 'ui'
	| 'constraints'
	| 'questions';

export interface SpecSection {
	id: SpecSectionId;
	title: string;
	/** What to write, in one line. */
	prompt: string;
	/** A short worked example. */
	example: string;
}

/** The guided sections, in order. Every one is optional. */
export const SPEC_SECTIONS: readonly SpecSection[] = [
	{
		id: 'project',
		title: 'Project',
		prompt: 'Which project this is for, a short name for the work, and the idea in one sentence.',
		example:
			'Photo library · Shared albums · Let a family add photos to one album and see each other’s.'
	},
	{
		id: 'problem',
		title: 'Problem and goal',
		prompt: 'What is wrong or missing today, and what will be true once this is done.',
		example:
			'Problem: photos from a trip end up scattered across four phones. Goal: everyone adds to one album and sees the lot.'
	},
	{
		id: 'audience',
		title: 'Who it is for',
		prompt: 'The people who will use it, what they are trying to get done, and how often.',
		example: 'Families sharing holiday photos, mostly on phones, a few times a year.'
	},
	{
		id: 'journeys',
		title: 'User journeys',
		prompt: 'Walk through how someone uses it, step by step. One journey per entry.',
		example:
			'Open Albums → “New shared album” → invite by email → a guest opens the link and adds photos.'
	},
	{
		id: 'scope',
		title: 'Scope and non-goals',
		prompt: 'What this piece of work includes, and what it deliberately leaves for later.',
		example: 'In: creating, inviting and adding photos. Not now: comments and likes.'
	},
	{
		id: 'requirements',
		title: 'Requirements',
		prompt: 'The checks that tell you it is done. Each becomes a tick box Firstmate works through.',
		example: 'A guest can add photos without making an account.'
	},
	{
		id: 'ui',
		title: 'UI notes and references',
		prompt: 'How it should look and feel, with links or screenshots of anything to follow.',
		example: 'Match the existing album page; quiet, no new colours. See the album grid screenshot.'
	},
	{
		id: 'constraints',
		title: 'Constraints and risks',
		prompt: 'Rules it must follow, and what could go wrong or needs care.',
		example:
			'Must keep originals private unless shared. Risk: very large uploads on slow connections.'
	},
	{
		id: 'questions',
		title: 'Open questions',
		prompt: 'Anything you have not decided yet. Firstmate will come back to you on these.',
		example: 'Can a guest remove a photo someone else added?'
	}
];

export function emptySpec(id: string, now: Date = new Date()): SpecDraft {
	const at = now.toISOString();
	return {
		schema: SPEC_SCHEMA,
		id,
		createdAt: at,
		updatedAt: at,
		sentAt: null,
		project: '',
		title: '',
		summary: '',
		problem: '',
		goal: '',
		audience: '',
		journeys: [],
		scope: '',
		nonGoals: '',
		requirements: [],
		uiNotes: '',
		links: [],
		images: [],
		constraints: '',
		risks: '',
		questions: []
	};
}

const has = (s: string) => s.trim().length > 0;
const items = (list: string[]) => list.map((s) => s.trim()).filter(Boolean);

/** Whether the captain has written anything in a section. */
export function sectionFilled(d: SpecDraft, id: SpecSectionId): boolean {
	switch (id) {
		case 'project':
			return has(d.project) || has(d.title) || has(d.summary);
		case 'problem':
			return has(d.problem) || has(d.goal);
		case 'audience':
			return has(d.audience);
		case 'journeys':
			return items(d.journeys).length > 0;
		case 'scope':
			return has(d.scope) || has(d.nonGoals);
		case 'requirements':
			return items(d.requirements).length > 0;
		case 'ui':
			return has(d.uiNotes) || items(d.links).length > 0 || d.images.length > 0;
		case 'constraints':
			return has(d.constraints) || has(d.risks);
		case 'questions':
			return items(d.questions).length > 0;
	}
}

export function filledCount(d: SpecDraft): number {
	return SPEC_SECTIONS.filter((s) => sectionFilled(d, s.id)).length;
}

export function specTitle(d: Pick<SpecDraft, 'title'>): string {
	return d.title.trim() || 'Untitled spec';
}

export function summarize(d: SpecDraft): SpecSummary {
	return {
		id: d.id,
		title: specTitle(d),
		project: d.project.trim(),
		updatedAt: d.updatedAt,
		sentAt: d.sentAt,
		filled: filledCount(d)
	};
}

/** A link's own text, or a Markdown link when it is a web address. */
function link(s: string): string {
	return /^https?:\/\/\S+$/i.test(s) ? `<${s}>` : s;
}

/** One list entry, keeping a multi-line entry inside its bullet. */
function bullet(prefix: string, s: string): string {
	return `${prefix}${s.replace(/\n/g, '\n  ')}`;
}

/**
 * The spec as Markdown. `image` says how a screenshot is referenced: a URL
 * the page can show in the preview, or a file path Firstmate can open (in
 * angle brackets, so a path with spaces stays one link).
 * Sections with nothing in them are left out.
 */
export function specMarkdown(
	d: SpecDraft,
	image: (img: SpecImage) => string = (img) => img.name
): string {
	const out: string[] = [`# ${specTitle(d)}`];
	const meta: string[] = [];
	if (has(d.project)) meta.push(`**Project:** ${d.project.trim()}`);
	if (meta.length) out.push(meta.join('\n'));
	if (has(d.summary)) out.push(d.summary.trim());

	const section = (title: string, body: string[]) => {
		const parts = body.filter(Boolean);
		if (parts.length) out.push(`## ${title}`, ...parts);
	};
	const sub = (title: string, text: string) => (has(text) ? `**${title}**\n\n${text.trim()}` : '');

	section('Problem and goal', [sub('Problem', d.problem), sub('Goal', d.goal)]);
	section('Who it is for', [d.audience.trim()]);
	const journeys = items(d.journeys);
	section('User journeys', [journeys.map((j, i) => bullet(`${i + 1}. `, j)).join('\n')]);
	section('Scope and non-goals', [sub('In scope', d.scope), sub('Not in scope', d.nonGoals)]);
	const reqs = items(d.requirements);
	section('Requirements', [reqs.map((r) => bullet('- [ ] ', r)).join('\n')]);
	const links = items(d.links);
	section('UI notes and references', [
		d.uiNotes.trim(),
		links.length ? links.map((l) => `- ${link(l)}`).join('\n') : '',
		d.images.map((img) => `![${img.caption.trim() || 'Screenshot'}](<${image(img)}>)`).join('\n\n')
	]);
	section('Constraints and risks', [sub('Constraints', d.constraints), sub('Risks', d.risks)]);
	const qs = items(d.questions);
	section('Open questions', [qs.map((q) => bullet('- ', q)).join('\n')]);
	return out.join('\n\n') + '\n';
}

/** The short line that opens the message to Firstmate. */
export function leadLine(d: SpecDraft): string {
	const what = has(d.project) ? `A new spec for ${d.project.trim()}` : 'A new spec';
	const title = has(d.title) ? `: ${d.title.trim()}` : '';
	return `${what}${title}. Please read it and come back to me with any questions before planning the work.`;
}

/** The one message "Send to Firstmate" posts: the lead line, then the spec. */
export function specMessage(d: SpecDraft, image: (img: SpecImage) => string): string {
	return `${leadLine(d)}\n\n${specMarkdown(d, image)}`;
}

// ------------------------------------------------------------------ validation

export const SPEC_ID = /^spec-[0-9a-z]{6,32}$/;
export const IMAGE_NAME = /^img-[0-9a-z]{6,32}\.(png|jpe?g|webp|gif)$/;
/** Longest a single text field may be. */
const MAX_TEXT = 20_000;
/** Most entries in one list. */
const MAX_ITEMS = 100;

const text = (v: unknown) => (typeof v === 'string' ? v.slice(0, MAX_TEXT) : '');
const list = (v: unknown) =>
	Array.isArray(v)
		? v
				.filter((x) => typeof x === 'string')
				.slice(0, MAX_ITEMS)
				.map(text)
		: [];
const time = (v: unknown, fallback: string) =>
	typeof v === 'string' && !Number.isNaN(Date.parse(v)) ? v : fallback;

/**
 * A stored or submitted draft, made safe: unknown fields dropped, strings and
 * lists bounded, picture names checked. Null when it is not a draft at all.
 */
export function normalizeSpec(v: unknown, id: string, now: Date = new Date()): SpecDraft | null {
	if (!v || typeof v !== 'object' || Array.isArray(v) || !SPEC_ID.test(id)) return null;
	const o = v as Record<string, unknown>;
	const at = now.toISOString();
	const images = Array.isArray(o.images)
		? o.images
				.filter(
					(x): x is { name: string; caption?: unknown } =>
						!!x && typeof x === 'object' && IMAGE_NAME.test(String((x as SpecImage).name))
				)
				.slice(0, MAX_ITEMS)
				.map((x) => ({ name: x.name, caption: text(x.caption) }))
		: [];
	return {
		schema: SPEC_SCHEMA,
		id,
		createdAt: time(o.createdAt, at),
		updatedAt: time(o.updatedAt, at),
		sentAt: o.sentAt === null || o.sentAt === undefined ? null : time(o.sentAt, at),
		project: text(o.project),
		title: text(o.title),
		summary: text(o.summary),
		problem: text(o.problem),
		goal: text(o.goal),
		audience: text(o.audience),
		journeys: list(o.journeys),
		scope: text(o.scope),
		nonGoals: text(o.nonGoals),
		requirements: list(o.requirements),
		uiNotes: text(o.uiNotes),
		links: list(o.links),
		images,
		constraints: text(o.constraints),
		risks: text(o.risks),
		questions: list(o.questions)
	};
}
