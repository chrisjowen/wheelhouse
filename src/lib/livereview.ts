/**
 * Live review sessions (the experimental `livereview` feature): the captain
 * uses a task's live preview and talks, while a scribe records what they do
 * and say. Wheelhouse shows the preview through a proxy that adds a small
 * recorder to every page (server/livereview/proxy.ts, livereview/recorder.js);
 * the recorder reports clicks, page changes, typing (masked), choices and
 * errors to the page around it. Each thing the captain says is a remark,
 * stamped against that timeline and linked to the part of the page they had
 * just used or were pointing at (`aboutWhat`). A scribe (one `claude -p` run
 * per round, see server/livereview/scribe.ts) keeps notes for the worker, and
 * a second run answers out loud when the captain asks something. At the end
 * the notes become a feedback pack, which goes to Firstmate as one message
 * for the same task, in the preview helper's batch shape so the chat shows it
 * as a card (`packMessage`, previewhelper.ts `parseBatch`): the captain's
 * request for changes. Approving instead sends the captain's go for the task
 * (`approvalMessage`, or an answer to its open sign-off or merge question).
 *
 * The shapes the page and the server share, the prompts, and the reading of
 * the scribe's answers live here, pure, so they are unit-tested.
 */
import { structured } from './previewhelper';

/** A part of the page, as the recorder names it: in plain words, and where it was. */
export interface PagePart {
	label: string;
	text: string;
	tag: string;
	selector: string;
	rect: { x: number; y: number; w: number; h: number };
}

export type EventKind =
	'start' | 'click' | 'input' | 'choose' | 'nav' | 'scroll' | 'error' | 'pause' | 'mark';

/** Something that happened on the page, `t` milliseconds into the session. */
export interface ReviewEvent {
	id: string;
	t: number;
	type: EventKind;
	label: string;
	page: string;
	el?: PagePart | null;
	shotId?: string | null;
}

/** Something the captain said, with what it is about. */
export interface Remark {
	id: string;
	t0: number;
	t1: number;
	text: string;
	page: string;
	/** The event it is about (a click just before it), when there is one. */
	anchor: string | null;
	/** Else the part of the page the pointer was on. */
	pointing: PagePart | null;
	shotId: string | null;
}

export type NoteKind = 'problem' | 'change' | 'idea' | 'question' | 'praise';
export type Severity = 'must' | 'should' | 'could' | 'none';

/** One of the scribe's notes for the worker. */
export interface Note {
	id: string;
	kind: NoteKind;
	severity: Severity;
	text: string;
	quote: string;
	anchor: string;
	utterances: string[];
}

export interface Turn {
	who: 'captain' | 'scribe';
	text: string;
}

/** One point of the feedback pack. */
export interface PackIssue {
	title: string;
	detail: string;
	severity: Severity;
	kind: NoteKind;
	notes: string[];
	anchor: string;
	quote: string;
}

export interface Pack {
	summary: string;
	issues: PackIssue[];
	openQuestions: string[];
}

/** What the scribe is told about the task. */
export interface ReviewContext {
	task: { id: string; title: string; project: string | null };
	url: string;
	brief: string | null;
}

export const KINDS: NoteKind[] = ['problem', 'change', 'idea', 'question', 'praise'];
export const SEVERITIES: Severity[] = ['must', 'should', 'could', 'none'];
export const SEVERITY_WORDS: Record<Severity, string> = {
	must: 'Must fix',
	should: 'Should fix',
	could: 'Could do',
	none: 'Keep'
};
export const MAX_TIMELINE = 160;
export const MAX_NOTES = 40;
export const MAX_TEXT = 1000;
export const PAGE_TEXT_MAX = 6000;
/** A remark is about what was used in the seconds before it. */
export const ABOUT_WINDOW_MS = 8000;

const tidy = (s: string) => s.replace(/\s+/g, ' ').trim();
const cut = (s: string, max: number) => (s.length > max ? s.slice(0, max - 1).trimEnd() + '…' : s);
const str = (v: unknown, max = MAX_TEXT) => (typeof v === 'string' ? cut(tidy(v), max) : '');

/** m:ss from the start of the session. */
export function mmss(ms: number): string {
	const s = Math.max(0, Math.round(ms / 1000));
	return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** `n thing` or `n things`. */
export const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** “This”, “here”: the captain means what the pointer is on. */
export const POINTING_WORDS = /\b(this|here|that one|these)\b/i;

/**
 * What a remark is about: what was just used (clicked, typed in, chosen) or
 * an area the captain marked, in the seconds before it or while saying it,
 * unless it says “this” or “here” and the pointer has since moved on to
 * something else (a marked area always counts); else what the pointer is on.
 */
export function aboutWhat(
	events: ReviewEvent[],
	text: string,
	t0: number,
	t1: number,
	hover: (PagePart & { t: number }) | null
): { ev: ReviewEvent } | { pointing: PagePart | null } {
	const ev =
		events
			.filter(
				(e) =>
					(e.type === 'click' || e.type === 'input' || e.type === 'choose' || e.type === 'mark') &&
					e.t >= t0 - ABOUT_WINDOW_MS &&
					e.t <= t1
			)
			.pop() ?? null;
	const moved =
		ev?.type !== 'mark' &&
		POINTING_WORDS.test(text) &&
		hover &&
		ev &&
		hover.t > ev.t + 400 &&
		hover.selector !== ev.el?.selector;
	if (ev && !moved) return { ev };
	return { pointing: hover ?? null };
}

/** The session as the scribe reads it: one line per event (eN) and remark (uN), in time order. */
export function timelineLines(events: ReviewEvent[], remarks: Remark[]): string[] {
	const label = (id: string) => events.find((e) => e.id === id)?.label ?? '';
	return [
		...events.map((e) => ({
			t: e.t,
			s: `${e.id} ${mmss(e.t)} ${e.label}${e.type !== 'nav' && e.page ? ` (on ${e.page})` : ''}`
		})),
		...remarks.map((u) => ({
			t: u.t0,
			s: `${u.id} ${mmss(u.t0)}–${mmss(u.t1)} captain said: “${u.text}”${u.anchor ? ` [about ${u.anchor}: ${label(u.anchor)}]` : ''}${u.pointing ? ` [pointing at ${u.pointing.label}]` : ''} (on ${u.page})`
		}))
	]
		.sort((a, b) => a.t - b.t)
		.map((x) => x.s)
		.slice(-MAX_TIMELINE);
}

/* ------------------------------------------------------------- the notes */

export const NOTES_SYSTEM = [
	'You are the scribe in a Wheelhouse live review session. The captain is using the live preview of one task a coding worker built, and talks about it as they go, out loud. Wheelhouse records what they do on the page (clicks, page changes, typing (masked), choices, console errors, failed requests) and what they say, each stamped with the time and linked to the part of the page they had just used or were pointing at.',
	'Keep the running list of notes for the worker. Return the WHOLE list every time: keep the ids of notes that already exist (n1, n2, ...), refine a note when a later remark adds to it, merge remarks about the same thing, and add new notes with the next free id. One change or finding per note.',
	"Each note: `kind` (problem: something broken or confusing; change: something to do differently; idea: a suggestion to consider; question: the captain is unsure or asks something the worker should answer; praise: something that works well and must be kept), `severity` (must, should, could; none for praise), `text` (the note for the worker in plain words, saying where on the page, one or two sentences), `quote` (the captain's own words it came from, trimmed, verbatim), `anchor` (the id of the timeline event it is about, e.g. e12, or empty), `utterances` (ids of the remarks it came from, e.g. u3).",
	'The captain also talks to you directly ("what is this page for?", "how do I get to the next step?"); another part of you answers those out loud. Such questions are conversation, not notes, unless they show a problem with the page (for example the captain could not tell what a screen is for: note that it is unclear).',
	'Do not invent problems the captain did not raise, except console errors or failed requests the timeline shows: note those as problems only when the captain was on that page, and say the captain did not mention it. Ignore chit-chat and thinking aloud that asks for nothing.',
	'`heard`: a few words acknowledging the latest remark, like a scribe nodding (e.g. "Noted: the save button feels hidden."). Never say you will fix, change or send anything.',
	'Write for someone who is not a programmer: no code, selectors or jargon.'
].join('\n\n');

const NOTE_SCHEMA = {
	type: 'object',
	properties: {
		id: { type: 'string' },
		kind: { type: 'string', enum: KINDS },
		severity: { type: 'string', enum: SEVERITIES },
		text: { type: 'string' },
		quote: { type: 'string' },
		anchor: { type: 'string' },
		utterances: { type: 'array', items: { type: 'string' } }
	},
	required: ['id', 'kind', 'severity', 'text', 'quote', 'anchor', 'utterances'],
	additionalProperties: false
} as const;

export const NOTES_SCHEMA = {
	type: 'object',
	properties: {
		notes: { type: 'array', items: NOTE_SCHEMA },
		heard: { type: 'string' }
	},
	required: ['notes', 'heard'],
	additionalProperties: false
} as const;

function contextLines(ctx: ReviewContext): string[] {
	return [
		`# The task\n${ctx.task.title} (${ctx.task.id})${ctx.task.project ? `, project ${ctx.task.project}` : ''}. Preview: ${ctx.url}`,
		`# Its instructions\n${ctx.brief?.trim() || 'Not available.'}`
	];
}

const notesList = (notes: Note[]) =>
	notes.length
		? JSON.stringify(
				notes.map(({ id, kind, severity, text, quote, anchor, utterances }) => ({
					id,
					kind,
					severity,
					text,
					quote,
					anchor,
					utterances
				}))
			)
		: 'None yet.';

export function notesPrompt(
	ctx: ReviewContext,
	req: { timeline: string[]; notes: Note[] }
): string {
	return [
		...contextLines(ctx),
		`# Timeline (m:ss from the start; e = something the captain did or the page did, u = something the captain said)\n${req.timeline.join('\n') || 'Nothing yet.'}`,
		`# Your notes so far\n${notesList(req.notes)}`,
		'Return the whole list of notes now.'
	].join('\n\n');
}

function readNote(raw: unknown): Note | null {
	const r = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
	const text = str(r.text);
	if (!text) return null;
	return {
		id: str(r.id, 20) || 'n0',
		kind: KINDS.includes(r.kind as NoteKind) ? (r.kind as NoteKind) : 'change',
		severity: SEVERITIES.includes(r.severity as Severity) ? (r.severity as Severity) : 'should',
		text,
		quote: str(r.quote, 500),
		anchor: str(r.anchor, 20),
		utterances: Array.isArray(r.utterances)
			? r.utterances.filter((u): u is string => typeof u === 'string').slice(0, 20)
			: []
	};
}

/** The scribe's notes, from claude's JSON result; null when they cannot be read. */
export function readNotes(stdout: string): { notes: Note[]; heard: string } | null {
	const out = structured(stdout, () => null);
	if (!out || !Array.isArray(out.notes)) return null;
	const notes = (out.notes as unknown[])
		.map(readNote)
		.filter((n): n is Note => !!n)
		.slice(0, MAX_NOTES);
	// Ids are the page's handle on a note: make them unique.
	const seen = new Set<string>();
	for (const n of notes) {
		while (seen.has(n.id)) n.id = `${n.id}'`;
		seen.add(n.id);
	}
	return { notes, heard: str(out.heard, 200) };
}

/* ---------------------------------------------------------- the answers */

export const REPLY_SYSTEM = [
	'You are the scribe and advisor sitting beside the captain in a Wheelhouse live review. The captain is using the live preview of one task a coding worker built and talking out loud as they go. You hear what they say and see what they do on the page. Another part of you quietly takes notes for the worker; your job here is the conversation.',
	"When the captain asks you something or speaks to you (what is this, what is it for, how do I, what should I try, did that work), answer at once: one to three short sentences, spoken aloud, so plain spoken English, no lists, no markdown. Use the task's instructions, the page's text and what just happened on the page. When you do not know, say so and suggest what to try.",
	'When the captain is only remarking on the page (this is too small, I like this), usually say nothing (empty reply), or at most a few words that confirm you caught it, for example "Got it, noted." Never more than one sentence for a remark.',
	'Now and then, when a remark is vague, you may ask one short question that would make the note useful (what did you expect instead?). Do not ask twice in a row.',
	'You cannot change the page or the work, and nothing goes to Firstmate until the captain ends the session. Never claim you fixed or sent anything. No code or jargon.'
].join('\n\n');

export const REPLY_SCHEMA = {
	type: 'object',
	properties: {
		reply: { type: 'string', description: 'What you say out loud; empty to stay quiet.' }
	},
	required: ['reply'],
	additionalProperties: false
} as const;

export interface ReplyRequest {
	said: string;
	page: { url: string; title: string; text: string } | null;
	timeline: string[];
	notes: string[];
	convo: Turn[];
}

export function replyPrompt(ctx: ReviewContext, req: ReplyRequest): string {
	return [
		...contextLines(ctx),
		`# The page the captain is on\n${req.page ? `${req.page.title} ${req.page.url}\nVisible text (trimmed):\n${req.page.text || '(none)'}` : 'Not available.'}`,
		`# What happened lately (m:ss)\n${req.timeline.slice(-30).join('\n') || 'Nothing yet.'}`,
		`# Notes taken so far\n${req.notes.map((n) => `- ${n}`).join('\n') || 'None.'}`,
		`# The conversation so far\n${
			req.convo
				.slice(-12)
				.map((c) => `${c.who === 'captain' ? 'Captain' : 'You'}: ${c.text}`)
				.join('\n') || 'Nothing yet.'
		}`,
		`# The captain just said\n“${req.said}”`,
		'Answer now (or stay quiet).'
	].join('\n\n');
}

/** The scribe's answer: its words, or '' to stay quiet; null when it cannot be read. */
export function readAnswer(stdout: string): string | null {
	const out = structured(stdout, (text) => ({ reply: text }));
	if (!out || typeof out.reply !== 'string') return null;
	return cut(out.reply.trim(), MAX_TEXT);
}

/* ------------------------------------------------------------- the pack */

export const PACK_SYSTEM = [
	'You are the scribe of a Wheelhouse live review session that has just ended. Turn your notes and the session timeline into the feedback pack Firstmate will route to the coding worker that built this preview.',
	'`summary`: two or three plain sentences: what the captain tried, how it went overall, and the most important thing to fix.',
	"`issues`: the notes as the worker should get them, most severe first; merge duplicates; keep every distinct ask and every praise (as a keep item). Each: `title` (under 9 words), `detail` (what to change and where, plain words), `severity` (must, should, could, none), `kind`, `notes` (the note ids it came from), `anchor` (the timeline event id it is about, or empty), `quote` (the captain's words, verbatim, trimmed).",
	'Questions the captain put to you about the page are conversation, not points, unless they showed something unclear.',
	'`openQuestions`: things the worker should check with the captain, if any.',
	'Never say you will fix or send anything. Plain words, no code.'
].join('\n\n');

export const PACK_SCHEMA = {
	type: 'object',
	properties: {
		summary: { type: 'string' },
		issues: {
			type: 'array',
			items: {
				type: 'object',
				properties: {
					title: { type: 'string' },
					detail: { type: 'string' },
					severity: { type: 'string', enum: SEVERITIES },
					kind: { type: 'string', enum: KINDS },
					notes: { type: 'array', items: { type: 'string' } },
					anchor: { type: 'string' },
					quote: { type: 'string' }
				},
				required: ['title', 'detail', 'severity', 'kind', 'notes', 'anchor', 'quote'],
				additionalProperties: false
			}
		},
		openQuestions: { type: 'array', items: { type: 'string' } }
	},
	required: ['summary', 'issues', 'openQuestions'],
	additionalProperties: false
} as const;

export function packPrompt(ctx: ReviewContext, req: { timeline: string[]; notes: Note[] }): string {
	return [
		...contextLines(ctx),
		`# Timeline (m:ss)\n${req.timeline.join('\n') || 'Nothing.'}`,
		`# Your notes\n${notesList(req.notes)}`,
		'Write the feedback pack now.'
	].join('\n\n');
}

/** The tidied pack, from claude's JSON result; null when there is no point in it or it cannot be read. */
export function readPack(stdout: string): Pack | null {
	const out = structured(stdout, () => null);
	if (!out || !Array.isArray(out.issues)) return null;
	const issues: PackIssue[] = [];
	for (const raw of out.issues as unknown[]) {
		const r = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
		const title = str(r.title, 200);
		const detail = str(r.detail);
		if (!title && !detail) continue;
		issues.push({
			title: title || shortTitle(detail),
			detail,
			severity: SEVERITIES.includes(r.severity as Severity) ? (r.severity as Severity) : 'should',
			kind: KINDS.includes(r.kind as NoteKind) ? (r.kind as NoteKind) : 'change',
			notes: Array.isArray(r.notes)
				? r.notes.filter((n): n is string => typeof n === 'string').slice(0, 20)
				: [],
			anchor: str(r.anchor, 20),
			quote: str(r.quote, 500)
		});
		if (issues.length === MAX_NOTES) break;
	}
	if (!issues.length) return null;
	return {
		summary: str(out.summary, 2000),
		issues,
		openQuestions: Array.isArray(out.openQuestions)
			? out.openQuestions
					.map((q) => str(q, 300))
					.filter(Boolean)
					.slice(0, 10)
			: []
	};
}

/** A point's title from a note: its first clause, cut at a word if long. */
export function shortTitle(text: string): string {
	const first = text.split(/[.(]|, (?:that|which|so|and)\b/)[0].trim();
	if (first.length <= 64) return first;
	return first.slice(0, 64).replace(/\s+\S*$/, '') + '…';
}

/** A note for a remark the scribe has not filed (it could not answer in time): a plain guess. */
export function plainNote(id: string, remark: Remark, where: string | null): Note {
	const t = remark.text.toLowerCase();
	const kind: NoteKind =
		/\b(love|like|nice|great|good|perfect)\b/.test(t) && !/\bnot\b/.test(t)
			? 'praise'
			: /\?|\bwhy\b|\bnot sure\b/.test(t)
				? 'question'
				: /\b(broken|bug|error|doesn'?t|does not|can'?t|wrong|fails?|nothing happens|confus)/.test(
							t
					  )
					? 'problem'
					: /\b(maybe|could|would be nice|idea|what if)\b/.test(t)
						? 'idea'
						: 'change';
	const text = remark.text.charAt(0).toUpperCase() + remark.text.slice(1);
	return {
		id,
		kind,
		severity:
			kind === 'praise'
				? 'none'
				: kind === 'problem'
					? 'must'
					: kind === 'idea'
						? 'could'
						: 'should',
		text: `${text}${where ? ` (about ${where} on ${remark.page})` : ` (on ${remark.page})`}`,
		quote: remark.text,
		anchor: remark.anchor ?? '',
		utterances: [remark.id]
	};
}

/** A question put to the scribe, which is conversation rather than a point for the worker. */
export const askedTheScribe = (text: string) =>
	/\?\s*$|^(what|how|why|where|when|can you|could you|is this|does|do i|which)\b/i.test(
		text.trim()
	);

/** The pack from the notes as they stand, before (or without) the scribe's tidier version. */
export function quickPack(notes: Note[], session: { title: string; duration: number }): Pack {
	return {
		summary: notes.length
			? `The captain reviewed ${session.title} for ${mmss(session.duration)} and raised ${plural(notes.length, 'point')}.`
			: 'Nothing was raised in this session, so there is nothing to pass on yet.',
		issues: notes.map((n) => ({
			title: shortTitle(n.text),
			detail: n.text,
			severity: n.severity,
			kind: n.kind,
			notes: [n.id],
			anchor: n.anchor,
			quote: n.quote
		})),
		openQuestions: []
	};
}

/* ----------------------------------------------------------- the message */

/** A point as it goes to Firstmate: where it is, when it was said, and its screenshot's file. */
export interface PackLine {
	severity: Severity;
	title: string;
	detail: string;
	where: string | null;
	quote: string;
	at: string | null;
	shot: string | null;
}

/**
 * The one message the pack goes to Firstmate as, for the same task: the
 * preview batch's head and tail (so the chat shows it as a feedback card, see
 * `parseBatch`), the summary, each point with where it is, the captain's
 * words and its screenshot, what went wrong on the page, and the session file.
 */
export function packMessage(
	task: { id: string; title: string },
	url: string,
	session: { duration: number; remarks: number; clicks: number; pages: number },
	pack: { summary: string; lines: PackLine[]; errors: string[]; openQuestions: string[] },
	sessionFile: string | null
): string {
	const out = [
		`Preview feedback for ${task.id} (${tidy(task.title)}), sent together from the Preview tab (${url}):`,
		`Live review session: ${mmss(session.duration)}, ${plural(session.remarks, 'remark')}, ${plural(session.clicks, 'click')}, ${plural(session.pages, 'page')}. ${tidy(pack.summary)}`,
		'The captain requests these changes: the preview is not approved yet.'
	];
	pack.lines.forEach((l, i) => {
		out.push(`${i + 1}. [${SEVERITY_WORDS[l.severity]}] ${tidy(l.title)}. ${tidy(l.detail)}`);
		if (l.where) out.push(`   Points at: ${tidy(l.where)}`);
		if (l.quote) out.push(`   Captain said${l.at ? ` (${l.at})` : ''}: “${tidy(l.quote)}”`);
		if (l.shot) out.push(`   Screenshot: ${l.shot}`);
	});
	if (pack.errors.length) {
		out.push('', 'Seen on the page during the session:', ...pack.errors.map((e) => `- ${e}`));
	}
	if (pack.openQuestions.length) {
		out.push('', 'Open questions for the captain:', ...pack.openQuestions.map((q) => `- ${q}`));
	}
	if (sessionFile)
		out.push('', `The whole session (every click, page, remark and screenshot): ${sessionFile}`);
	out.push(
		'',
		'Firstmate: pass these to this task’s worker, the same task (start no new one). You may add notes of your own, marked as yours.'
	);
	return out.join('\n');
}

/**
 * The captain's approval from the review panel, for a task with no open
 * sign-off or merge question to answer: the captain's go for its pull
 * request, with any notes they took, which do not hold it up.
 */
export function approvalMessage(
	task: { id: string; title: string },
	url: string,
	notes: string[]
): string {
	const out = [
		`Preview approved for ${task.id} (${tidy(task.title)}): the captain reviewed the preview (${url}) and approves it.`,
		'This is the captain’s go for its pull request: land it under this project’s rules.'
	];
	if (notes.length)
		out.push('', 'Notes the captain took (not blocking):', ...notes.map((n) => `- ${tidy(n)}`));
	return out.join('\n');
}

/* ------------------------------------------------------------ requests */

export type ReviewAction = 'proxy' | 'notes' | 'reply' | 'pack' | 'save';

/** The page's request, checked and bounded; or why it is refused. */
export function readReviewRequest(
	body: unknown
):
	| { ok: true; action: 'proxy' }
	| { ok: true; action: 'notes' | 'pack'; timeline: string[]; notes: Note[] }
	| { ok: true; action: 'reply'; reply: ReplyRequest }
	| { ok: true; action: 'save'; session: unknown; shots: Record<string, string> }
	| { ok: false; error: string } {
	const b = (typeof body === 'object' && body !== null ? body : {}) as Record<string, unknown>;
	const lines = (v: unknown, max = MAX_TIMELINE) =>
		Array.isArray(v)
			? v
					.filter((l): l is string => typeof l === 'string')
					.slice(-max)
					.map((l) => cut(l, MAX_TEXT))
			: [];
	switch (b.action) {
		case 'proxy':
			return { ok: true, action: 'proxy' };
		case 'notes':
		case 'pack':
			return {
				ok: true,
				action: b.action,
				timeline: lines(b.timeline),
				notes: (Array.isArray(b.notes) ? b.notes : [])
					.map(readNote)
					.filter((n): n is Note => !!n)
					.slice(0, MAX_NOTES)
			};
		case 'reply': {
			const said = str(b.said);
			if (!said) return { ok: false, error: 'Say something first.' };
			const p = b.page as Record<string, unknown> | null | undefined;
			const convo = (Array.isArray(b.convo) ? b.convo : [])
				.map((c) => (typeof c === 'object' && c !== null ? (c as Record<string, unknown>) : {}))
				.filter((c) => (c.who === 'captain' || c.who === 'scribe') && typeof c.text === 'string')
				.slice(-12)
				.map((c) => ({ who: c.who as Turn['who'], text: str(c.text) }));
			return {
				ok: true,
				action: 'reply',
				reply: {
					said,
					page:
						p && typeof p === 'object'
							? {
									url: str(p.url, 500),
									title: str(p.title, 200),
									text: typeof p.text === 'string' ? p.text.slice(0, PAGE_TEXT_MAX) : ''
								}
							: null,
					timeline: lines(b.timeline, 30),
					notes: lines(b.notes, MAX_NOTES),
					convo
				}
			};
		}
		case 'save': {
			const shots: Record<string, string> = {};
			const raw = (typeof b.shots === 'object' && b.shots !== null ? b.shots : {}) as Record<
				string,
				unknown
			>;
			for (const [id, data] of Object.entries(raw).slice(0, 60)) {
				if (/^s\d{1,4}$/.test(id) && typeof data === 'string') shots[id] = data;
			}
			return { ok: true, action: 'save', session: b.session ?? null, shots };
		}
		default:
			return { ok: false, error: 'Choose proxy, notes, reply, pack or save.' };
	}
}
