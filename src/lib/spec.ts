/**
 * The Spec tab's model: a spec the captain builds in an interview with an
 * agent (or fills in section by section in the quick form), assembled into
 * one Markdown document and sent to Firstmate as a single build request.
 * Shared by the page (document, sending) and the server (which keeps drafts in
 * Wheelhouse's state directory and validates what it stores).
 */

export const SPEC_SCHEMA = 'wheelhouse-spec.v1';

/**
 * Longest message sent to Firstmate in one go (its inbox, used when it runs
 * elsewhere, takes at most 16 KiB); a longer spec goes as a file.
 */
export const MAX_MESSAGE_BYTES = 16 * 1024;

/** A screenshot or picture attached to the spec, stored beside it under `name`. */
export interface SpecImage {
	name: string;
	caption: string;
}

/** One message in the spec interview. */
export interface InterviewTurn {
	role: 'agent' | 'captain';
	text: string;
	at: string;
	/** Answers the agent offers to pick from (agent turns only). */
	options: string[];
	/** Which of `options` the agent recommends; null for none. */
	recommended: number | null;
	/** The spec sections this agent turn changed. */
	changed: SpecSectionId[];
}

/** A comment the captain left on the spec, for the agent to address. */
export interface SpecComment {
	id: string;
	section: SpecSectionId;
	/** The words the captain selected, if any. */
	quote: string;
	text: string;
	at: string;
	/** When the agent addressed it; null while it is open. */
	resolvedAt: string | null;
	/** What the agent said or did about it. */
	reply: string;
}

/** What the interview has cost so far, as the claude CLI reports it. */
export interface InterviewUsage {
	turns: number;
	inputTokens: number;
	outputTokens: number;
	/** At API prices; a Claude plan may not bill it this way. */
	costUsd: number;
}

export interface Interview {
	turns: InterviewTurn[];
	/** The agent judged the spec ready to build. */
	done: boolean;
	usage: InterviewUsage;
}

export type SpecMode = 'interview' | 'form';

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
	/** How the captain is building it: the agent's interview or the quick form. */
	mode: SpecMode;
	interview: Interview;
	comments: SpecComment[];
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
		questions: [],
		mode: 'interview',
		interview: emptyInterview(),
		comments: []
	};
}

export function emptyInterview(): Interview {
	return {
		turns: [],
		done: false,
		usage: { turns: 0, inputTokens: 0, outputTokens: 0, costUsd: 0 }
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

/** A section's body as Markdown, without its heading; empty when nothing is written. */
export function sectionMarkdown(
	d: SpecDraft,
	id: SpecSectionId,
	image: (img: SpecImage) => string = (img) => img.name
): string {
	const sub = (title: string, text: string) => (has(text) ? `**${title}**\n\n${text.trim()}` : '');
	const join = (parts: string[]) => parts.filter(Boolean).join('\n\n');
	switch (id) {
		case 'project':
			return join([has(d.project) ? `**Project:** ${d.project.trim()}` : '', d.summary.trim()]);
		case 'problem':
			return join([sub('Problem', d.problem), sub('Goal', d.goal)]);
		case 'audience':
			return d.audience.trim();
		case 'journeys':
			return items(d.journeys)
				.map((j, i) => bullet(`${i + 1}. `, j))
				.join('\n');
		case 'scope':
			return join([sub('In scope', d.scope), sub('Not in scope', d.nonGoals)]);
		case 'requirements':
			return items(d.requirements)
				.map((r) => bullet('- [ ] ', r))
				.join('\n');
		case 'ui': {
			const links = items(d.links);
			return join([
				d.uiNotes.trim(),
				links.map((l) => `- ${link(l)}`).join('\n'),
				d.images
					.map((img) => `![${img.caption.trim() || 'Screenshot'}](<${image(img)}>)`)
					.join('\n\n')
			]);
		}
		case 'constraints':
			return join([sub('Constraints', d.constraints), sub('Risks', d.risks)]);
		case 'questions':
			return items(d.questions)
				.map((q) => bullet('- ', q))
				.join('\n');
	}
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
	for (const s of SPEC_SECTIONS) {
		const body = sectionMarkdown(d, s.id, image);
		if (!body) continue;
		if (s.id === 'project') out.push(body);
		else out.push(`## ${s.title}`, body);
	}
	return out.join('\n\n') + '\n';
}

/** The sections whose text differs between two versions of a draft (the title counts as the project's). */
export function changedSections(before: SpecDraft, after: SpecDraft): SpecSectionId[] {
	return SPEC_SECTIONS.filter((s) =>
		s.id === 'project'
			? before.title !== after.title ||
				sectionMarkdown(before, 'project') !== sectionMarkdown(after, 'project')
			: sectionMarkdown(before, s.id) !== sectionMarkdown(after, s.id)
	).map((s) => s.id);
}

/** The short line that opens the message to Firstmate, marking it as a build request. */
export function leadLine(d: SpecDraft): string {
	const what = has(d.project) ? `Build request for ${d.project.trim()}` : 'Build request';
	const title = has(d.title) ? `: ${d.title.trim()}` : '';
	return `${what}${title}. Please build the spec below; come back to me with any questions before planning the work.`;
}

/**
 * The one message "Send to build" posts: the lead line, then the spec. When
 * `attachment` names the file the whole spec was written to (a spec too long
 * for one message), the message carries the summary and points at the file.
 */
export function specMessage(
	d: SpecDraft,
	image: (img: SpecImage) => string,
	attachment: string | null = null
): string {
	if (!attachment) return `${leadLine(d)}\n\n${specMarkdown(d, image)}`;
	const reqs = items(d.requirements).length;
	return [
		leadLine(d),
		`# ${specTitle(d)}`,
		sectionMarkdown(d, 'project', image),
		`The full spec${reqs ? ` (${reqs} requirement${reqs === 1 ? '' : 's'})` : ''} is too long for one message, so it is attached as a file: <${attachment}>`
	]
		.filter(Boolean)
		.join('\n\n')
		.concat('\n');
}

// ------------------------------------------------------------------ validation

export const SPEC_ID = /^spec-[0-9a-z]{6,32}$/;
export const IMAGE_NAME = /^img-[0-9a-z]{6,32}\.(png|jpe?g|webp|gif)$/;
export const COMMENT_ID = /^c-[0-9a-z]{6,32}$/;
/** Most turns an interview keeps. */
export const MAX_TURNS = 400;
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
const count = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0);
const SECTION_IDS = new Set<string>(SPEC_SECTIONS.map((s) => s.id));
export const isSectionId = (v: unknown): v is SpecSectionId =>
	typeof v === 'string' && SECTION_IDS.has(v);
const objects = (v: unknown, max: number) =>
	Array.isArray(v)
		? v
				.filter(
					(x): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x)
				)
				.slice(-max)
		: [];

/** A draft from before the interview that the captain had already written in: it stays a form. */
const legacyFilled = (o: Record<string, unknown>) =>
	o.interview === undefined &&
	Object.entries(o).some(
		([k, v]) =>
			!['schema', 'id', 'createdAt', 'updatedAt', 'sentAt', 'images'].includes(k) &&
			(typeof v === 'string' ? !!v.trim() : Array.isArray(v) && v.some((x) => !!String(x).trim()))
	);

function normalizeInterview(v: unknown, at: string): Interview {
	const o = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
	const u = (o.usage && typeof o.usage === 'object' ? o.usage : {}) as Record<string, unknown>;
	const turns = objects(o.turns, MAX_TURNS)
		.filter((t) => t.role === 'agent' || t.role === 'captain')
		.map((t): InterviewTurn => {
			const options = list(t.options).slice(0, 6);
			const rec = typeof t.recommended === 'number' ? t.recommended : null;
			return {
				role: t.role as InterviewTurn['role'],
				text: text(t.text),
				at: time(t.at, at),
				options,
				recommended:
					rec !== null && Number.isInteger(rec) && rec >= 0 && rec < options.length ? rec : null,
				changed: Array.isArray(t.changed) ? t.changed.filter(isSectionId) : []
			};
		});
	return {
		turns,
		done: o.done === true,
		usage: {
			turns: count(u.turns),
			inputTokens: count(u.inputTokens),
			outputTokens: count(u.outputTokens),
			costUsd: count(u.costUsd)
		}
	};
}

function normalizeComments(v: unknown, at: string): SpecComment[] {
	return objects(v, MAX_ITEMS)
		.filter((c) => typeof c.id === 'string' && COMMENT_ID.test(c.id) && isSectionId(c.section))
		.map((c) => ({
			id: c.id as string,
			section: c.section as SpecSectionId,
			quote: text(c.quote).slice(0, 2000),
			text: text(c.text),
			at: time(c.at, at),
			resolvedAt:
				c.resolvedAt === null || c.resolvedAt === undefined ? null : time(c.resolvedAt, at),
			reply: text(c.reply)
		}));
}

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
		questions: list(o.questions),
		mode: o.mode === 'form' || (o.mode === undefined && legacyFilled(o)) ? 'form' : 'interview',
		interview: normalizeInterview(o.interview, at),
		comments: normalizeComments(o.comments, at)
	};
}
