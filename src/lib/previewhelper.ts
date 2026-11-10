/**
 * The preview helper: a conversation about one task's live preview, before
 * any feedback goes to Firstmate. The captain talks it through with a helper
 * (a headless Claude, see server/previewhelper.ts) that sees only that
 * preview: the page, the part the captain points at, the task's screenshots,
 * its instructions and its history. The helper answers, asks, suggests, and
 * turns what the captain wants changed into lines on a feedback list the
 * captain edits; nothing leaves until the captain sends the list, which then
 * goes to Firstmate as one message for the same task (`batchText`), shown in
 * the main chat as a card addressed to Firstmate (`parseBatch`). A plugin
 * with the `feedback` capability sends its lists in the same shape
 * (`pluginBatchText`), attributed to it.
 *
 * The shapes the page and the server share, the prompt, and the reading of
 * the helper's answer live here, pure, so they are unit-tested.
 */

/** What the captain pointed at on the page. */
export interface Pointer {
	/** element: the part of the page clicked; spot: a place on a page Wheelhouse cannot look inside. */
	kind: 'element' | 'spot';
	/** In plain words, e.g. "the “Copy link” button" or "a spot about halfway down, on the right". */
	label: string;
	/** More about it, for the helper: the element's text, or where the spot is in the frame. */
	detail: string | null;
}

export interface HelperTurn {
	who: 'captain' | 'helper';
	text: string;
	points?: Pointer | null;
}

export interface HelperRequest {
	turns: HelperTurn[];
	/** The feedback list as it stands, so the helper does not suggest a line twice. */
	list: string[];
}

export interface HelperReply {
	reply: string;
	/** Feedback lines the helper proposes for the list; the captain adds them or not. */
	suggest: string[];
}

/** What the helper is shown about the task, gathered by the server. */
export interface HelperContext {
	task: { id: string; title: string; project: string | null; status: string };
	preview: { url: string; text: string | null };
	/** The task's instructions as Firstmate wrote them, when Wheelhouse can read them. */
	brief: string | null;
	/** The task's history, oldest first, one line each. */
	history: string[];
	/** The task's screenshots: their names, and the files the helper may read. */
	screenshots: { name: string; file: string }[];
}

export const MAX_TURNS = 40;
export const MAX_TURN_CHARS = 4000;
export const MAX_LIST = 30;
export const MAX_LINE_CHARS = 500;
export const MAX_SUGGEST = 3;
export const PAGE_TEXT_MAX = 8000;

const tidy = (s: string) => s.replace(/\s+/g, ' ').trim();
const cut = (s: string, max: number) => (s.length > max ? s.slice(0, max - 1).trimEnd() + '…' : s);

/** A request from the page, checked: the turns and list as sent, bounded; or why it is refused. */
export function readRequest(
	body: unknown
): { ok: true; value: HelperRequest } | { ok: false; error: string } {
	const b = (typeof body === 'object' && body !== null ? body : {}) as Record<string, unknown>;
	if (!Array.isArray(b.turns) || !b.turns.length)
		return { ok: false, error: 'Say something first.' };
	if (b.turns.length > MAX_TURNS)
		return {
			ok: false,
			error: 'This conversation is too long; send the list and start a new one.'
		};
	const turns: HelperTurn[] = [];
	for (const t of b.turns as unknown[]) {
		const r = (typeof t === 'object' && t !== null ? t : {}) as Record<string, unknown>;
		if ((r.who !== 'captain' && r.who !== 'helper') || typeof r.text !== 'string') {
			return { ok: false, error: 'Each message needs who said it and its words.' };
		}
		if (r.text.length > MAX_TURN_CHARS) return { ok: false, error: 'A message is too long.' };
		const p = r.points as Record<string, unknown> | null | undefined;
		const points: Pointer | null =
			p && (p.kind === 'element' || p.kind === 'spot') && typeof p.label === 'string'
				? {
						kind: p.kind,
						label: cut(tidy(p.label), 200),
						detail: typeof p.detail === 'string' ? cut(tidy(p.detail), 500) : null
					}
				: null;
		turns.push({ who: r.who, text: r.text, points });
	}
	if (turns[turns.length - 1].who !== 'captain') {
		return { ok: false, error: 'The last message must be yours.' };
	}
	const list = Array.isArray(b.list)
		? (b.list as unknown[])
				.filter((l): l is string => typeof l === 'string')
				.slice(0, MAX_LIST)
				.map((l) => cut(tidy(l), MAX_LINE_CHARS))
		: [];
	return { ok: true, value: { turns, list } };
}

/** The helper's instructions. */
export const HELPER_SYSTEM = [
	'You are the preview helper in Wheelhouse. The captain is reviewing the live preview of one task a coding worker built, and is talking it through with you before any feedback goes to Firstmate, who runs the crew.',
	'You see only this task: its page, the part the captain points at, its screenshots (read them with the Read tool when they help), its instructions and its history. You know nothing else and cannot change anything.',
	'Answer what the captain asks about the page or the work, plainly and briefly. When what the captain wants is unclear, ask one short question back. When the instructions or history settle a question, say so and quote them.',
	'Whenever the captain wants something changed, put it in `suggest` as one feedback line for the worker: one change per line, in plain words, saying where on the page it is. Do not suggest a line already on the list. When the captain only asks a question, `suggest` is empty.',
	'Never say you will change, send or fix anything: the captain edits the list and sends it to Firstmate when ready.',
	'Write for someone who is not a programmer: no code, file names or jargon. Keep `reply` to a few sentences.'
].join('\n\n');

/** The JSON shape the helper answers in (claude --json-schema). */
export const HELPER_SCHEMA = {
	type: 'object',
	properties: {
		reply: { type: 'string', description: 'What you say to the captain.' },
		suggest: {
			type: 'array',
			items: { type: 'string' },
			description: 'Feedback lines for the worker the captain may add to the list.'
		}
	},
	required: ['reply', 'suggest'],
	additionalProperties: false
} as const;

const pointed = (p: Pointer | null | undefined) =>
	p ? ` [pointing at ${p.label}${p.detail ? `: ${p.detail}` : ''}]` : '';

/** What the helper is given to read: the task, the page, the list and the conversation so far. */
export function helperPrompt(ctx: HelperContext, req: HelperRequest): string {
	const out: string[] = [];
	out.push(
		`# The task\n${ctx.task.title}${ctx.task.project ? ` (project ${ctx.task.project})` : ''}. Status: ${ctx.task.status}.`
	);
	out.push(`# Its instructions\n${ctx.brief?.trim() || 'Not available.'}`);
	out.push(
		`# Its history\n${ctx.history.length ? ctx.history.map((h) => `- ${h}`).join('\n') : 'Not available.'}`
	);
	out.push(
		`# The preview\n${ctx.preview.url}\n\nThe page's text as served (it may be filled in later by scripts):\n${ctx.preview.text?.trim() || '(no text could be read)'}`
	);
	out.push(
		`# Screenshots\n${ctx.screenshots.length ? ctx.screenshots.map((s) => `- ${s.name}: ${s.file}`).join('\n') : 'None.'}`
	);
	out.push(
		`# The feedback list so far\n${req.list.length ? req.list.map((l, i) => `${i + 1}. ${l}`).join('\n') : 'Empty.'}`
	);
	out.push(
		`# The conversation\n${req.turns
			.map(
				(t) => `${t.who === 'captain' ? 'Captain' : 'You'}: ${t.text.trim()}${pointed(t.points)}`
			)
			.join('\n\n')}`
	);
	out.push('Answer the captain’s last message.');
	return out.join('\n\n');
}

/**
 * The object a helper run answered with, from claude's JSON result: its
 * structured output, else its result text read as JSON, else (`plain`) that
 * text as given; null when there is none or the run failed.
 */
function structured(
	stdout: string,
	plain: (text: string) => Record<string, unknown> | null
): Record<string, unknown> | null {
	let v: unknown;
	try {
		v = JSON.parse(stdout);
	} catch {
		return null;
	}
	const r = (typeof v === 'object' && v !== null ? v : {}) as {
		is_error?: unknown;
		structured_output?: unknown;
		result?: unknown;
	};
	if (r.is_error === true) return null;
	const out = r.structured_output;
	if (typeof out === 'object' && out !== null) return out as Record<string, unknown>;
	if (typeof r.result !== 'string') return null;
	try {
		const parsed = JSON.parse(r.result) as unknown;
		return typeof parsed === 'object' && parsed !== null
			? (parsed as Record<string, unknown>)
			: plain(r.result);
	} catch {
		return plain(r.result);
	}
}

/** The helper's answer, from claude's JSON result; null when it cannot be read. */
export function readReply(stdout: string): HelperReply | null {
	const out = structured(stdout, (text) => ({ reply: text, suggest: [] }));
	if (!out || typeof out.reply !== 'string' || !out.reply.trim()) return null;
	const suggest = Array.isArray(out.suggest)
		? out.suggest
				.filter((s): s is string => typeof s === 'string' && !!s.trim())
				.map((s) => cut(tidy(s), MAX_LINE_CHARS))
				.slice(0, MAX_SUGGEST)
		: [];
	return { reply: out.reply.trim(), suggest };
}

/* ------------------------------------------------------------- the summary */

/**
 * The same helper, asked to tidy a feedback list before it is sent: a list a
 * plugin collected (a shared review's comment threads, say), one line per
 * item with what it points at, becomes a few clear points for the worker,
 * each naming the items it came from. The captain then reads, edits and picks
 * the points; nothing is sent by the helper, and the items themselves are
 * kept by whoever collected them.
 */

/** A feedback list to tidy: what it is about, and its items as they would be sent. */
export interface SummaryRequest {
	task: { id: string; title: string };
	subject: string | null;
	items: { text: string; points: string | null }[];
}

/** One tidied point: its words, what it points at, and the items (numbered from 1) it came from. */
export interface SummaryPoint {
	text: string;
	points: string | null;
	from: number[];
}

/** What a point may point at (the feedback capability's limit). */
export const MAX_SUMMARY_POINTS_CHARS = 200;

/** The helper's instructions for tidying a list. */
export const SUMMARY_SYSTEM = [
	'You are the preview helper in Wheelhouse. The captain is about to send Firstmate, who runs the crew, a list of feedback several people left about one task a coding worker built. Before it goes, you tidy the list into clear points for the worker.',
	'Each item is one person’s comment, with any replies folded in, and where on the page it points. Turn the list into points: one change per point, in plain words, saying where on the page it is. Merge items that ask for the same change, and keep who asked when it matters. Leave out chat that asks for nothing (thanks, agreement with no new ask), unless it settles a question in another item. Keep every distinct ask: do not drop, soften or invent one.',
	'For each point, give `from`: the numbers of the items it came from, and `points`: where on the page it is, briefly (or an empty string when it is about nothing in particular).',
	'Never say you will change, send or fix anything: the captain edits and picks the points and sends them.',
	'Write for someone who is not a programmer: no code, file names or jargon.'
].join('\n\n');

/** The JSON shape the helper tidies a list in (claude --json-schema). */
export const SUMMARY_SCHEMA = {
	type: 'object',
	properties: {
		points: {
			type: 'array',
			items: {
				type: 'object',
				properties: {
					text: { type: 'string', description: 'One change for the worker, in plain words.' },
					points: { type: 'string', description: 'Where on the page it is; empty for nowhere.' },
					from: {
						type: 'array',
						items: { type: 'integer' },
						description: 'The numbers of the items it came from.'
					}
				},
				required: ['text', 'points', 'from'],
				additionalProperties: false
			}
		}
	},
	required: ['points'],
	additionalProperties: false
} as const;

/** What the helper is given to read when it tidies a list: the task, what the list is about, the items. */
export function summaryPrompt(req: SummaryRequest): string {
	return [
		`# The task\n${tidy(req.task.title)} (${req.task.id}).`,
		`# What the list is about\n${req.subject ? tidy(req.subject) : 'Feedback on the task.'}`,
		`# The items\n${req.items
			.map(
				(it, i) =>
					`${i + 1}. ${tidy(it.text)}${it.points && tidy(it.points) ? `\n   Points at: ${tidy(it.points)}` : ''}`
			)
			.join('\n')}`,
		'Tidy these items into clear points for the worker.'
	].join('\n\n');
}

/**
 * The tidied points, from claude's JSON result: bounded to the feedback
 * list's limits, each naming only items that exist; null when there are none
 * or they cannot be read.
 */
export function readSummary(stdout: string, count: number): SummaryPoint[] | null {
	const out = structured(stdout, () => null);
	if (!out || !Array.isArray(out.points)) return null;
	const points: SummaryPoint[] = [];
	for (const p of out.points as unknown[]) {
		const r = (typeof p === 'object' && p !== null ? p : {}) as Record<string, unknown>;
		const text = typeof r.text === 'string' ? cut(tidy(r.text), MAX_LINE_CHARS) : '';
		if (!text) continue;
		const at = typeof r.points === 'string' ? tidy(r.points) : '';
		const from = Array.isArray(r.from)
			? [
					...new Set(
						(r.from as unknown[]).filter(
							(n): n is number =>
								Number.isInteger(n) && (n as number) >= 1 && (n as number) <= count
						)
					)
				].sort((a, b) => a - b)
			: [];
		points.push({ text, points: at ? cut(at, MAX_SUMMARY_POINTS_CHARS) : null, from });
		if (points.length === MAX_LIST) break;
	}
	return points.length ? points : null;
}

/** A page's visible text from its HTML: without scripts, styles and tags, bounded. */
export function pageText(html: string, max = PAGE_TEXT_MAX): string {
	const t = html
		.replace(/<(script|style|noscript|template|svg)\b[\s\S]*?<\/\1>/gi, ' ')
		.replace(/<!--[\s\S]*?-->/g, ' ')
		.replace(/<(?:br|\/p|\/div|\/li|\/h[1-6]|\/tr|\/section|\/header|\/footer)\b[^>]*>/gi, '\n')
		.replace(/<[^>]+>/g, ' ')
		.replace(/&nbsp;/g, ' ')
		.replace(/&amp;/g, '&')
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&quot;/g, '"')
		.replace(/&#39;/g, "'")
		.split('\n')
		.map((l) => l.replace(/[ \t\f\r]+/g, ' ').trim())
		.filter(Boolean)
		.join('\n');
	return cut(t, max);
}

/** The words for a place in the frame: "the top left", "the middle", "the bottom right". */
function placeOf(at: { x: number; y: number }): string {
	const v = at.y < 1 / 3 ? 'top' : at.y < 2 / 3 ? 'middle' : 'bottom';
	const h = at.x < 1 / 3 ? 'left' : at.x < 2 / 3 ? '' : 'right';
	return v === 'middle' && !h ? 'the middle' : `the ${v}${h ? ` ${h}` : ''}`;
}

const NOUN: Record<string, string> = {
	button: 'button',
	a: 'link',
	input: 'box',
	textarea: 'box',
	select: 'menu',
	img: 'picture',
	h1: 'heading',
	h2: 'heading',
	h3: 'heading',
	h4: 'heading',
	label: 'label',
	li: 'item'
};

/**
 * What a click on the preview points at: the element under it when Wheelhouse
 * can look inside the page (a preview on its own origin), named the way the
 * captain would say it, else the spot, by where it is in the frame.
 */
/** The parts of a DOM element pointAt reads (structural, so the server's build needs no DOM types). */
interface PointedElement {
	tagName: string;
	textContent: string | null;
	value?: string;
	closest(selector: string): PointedElement | null;
	getAttribute(name: string): string | null;
}

export function pointAt(
	el: PointedElement | null,
	at: { x: number; y: number },
	frame: { w: number; h: number }
): Pointer {
	const near =
		el?.closest(
			'button, a, input, textarea, select, img, h1, h2, h3, h4, label, li, [role="button"]'
		) ?? el;
	if (near && near.tagName !== 'HTML' && near.tagName !== 'BODY') {
		const tag = near.tagName.toLowerCase();
		const noun =
			near.getAttribute('role') === 'button' ? 'button' : (NOUN[tag] ?? 'part of the page');
		const words = cut(
			tidy(
				near.value ||
					near.getAttribute('aria-label') ||
					near.getAttribute('alt') ||
					near.textContent ||
					''
			),
			60
		);
		return {
			kind: 'element',
			label: words ? `the “${words}” ${noun}` : `a ${noun} near ${placeOf(at)}`,
			detail: `<${tag}>${words ? ` “${words}”` : ''}, near ${placeOf(at)} of the page`
		};
	}
	return {
		kind: 'spot',
		label: `a spot near ${placeOf(at)} of the page`,
		detail: `${Math.round(at.x * 100)}% across and ${Math.round(at.y * 100)}% down the part of the page in view (${frame.w}×${frame.h})`
	};
}

/* --------------------------------------------------------------- the batch */

const BATCH_HEAD =
	/^Preview feedback for (\S+) \((.+)\), sent together from the Preview tab \(([^)\n]*)\):$/;
const PLUGIN_HEAD =
	/^Feedback for (\S+) \((.+)\), sent together from the “([^“”\n]+)” plugin \(([a-z][a-z0-9-]*)\)(?:, about (.+))?:$/;
const BATCH_TAIL =
	'Firstmate: pass these to this task’s worker, the same task (start no new one). You may add notes of your own, marked as yours.';

export interface Batch {
	taskId: string;
	title: string;
	/** The preview's address, for a list sent from the Preview tab; null for a plugin's. */
	url: string | null;
	/** The plugin that sent it, with what the list is about (its `subject`); null for the Preview tab's. */
	plugin: { id: string; name: string; subject: string | null } | null;
	items: { text: string; points: string | null }[];
}

const itemLines = (items: { text: string; points?: string | null }[]) =>
	items.flatMap((it, i) => [
		`${i + 1}. ${tidy(it.text)}`,
		...(it.points && tidy(it.points) ? [`   Points at: ${tidy(it.points)}`] : [])
	]);

/** The one message the captain's list goes to Firstmate as, for the same task. */
export function batchText(
	task: { id: string; title: string },
	url: string,
	items: { text: string; points?: Pointer | null }[]
): string {
	return [
		`Preview feedback for ${task.id} (${tidy(task.title)}), sent together from the Preview tab (${url}):`,
		...itemLines(items.map((it) => ({ text: it.text, points: it.points?.label ?? null }))),
		'',
		BATCH_TAIL
	].join('\n');
}

/**
 * A plugin's feedback list (see server/plugins/feedback.ts) as the one message
 * it goes to Firstmate as, in the preview list's shape: about one task,
 * attributed to the plugin that sent it, with what it is about.
 */
export function pluginBatchText(
	task: { id: string; title: string },
	plugin: { id: string; name: string },
	subject: string | null,
	items: { text: string; points?: string | null }[]
): string {
	const name = tidy(plugin.name.replace(/[“”]/g, '')) || plugin.id;
	const about = subject && tidy(subject) ? `, about ${tidy(subject)}` : '';
	return [
		`Feedback for ${task.id} (${tidy(task.title)}), sent together from the “${name}” plugin (${plugin.id})${about}:`,
		...itemLines(items),
		'',
		BATCH_TAIL
	].join('\n');
}

/** A message back as the batch it carries; null when it is not one. */
export function parseBatch(text: string): Batch | null {
	const lines = text.replace(/\r\n?/g, '\n').split('\n');
	const preview = BATCH_HEAD.exec(lines[0] ?? '');
	const plugin = preview ? null : PLUGIN_HEAD.exec(lines[0] ?? '');
	const head = preview ?? plugin;
	if (!head) return null;
	const items: Batch['items'] = [];
	for (const line of lines.slice(1)) {
		const item = /^\d+\. (.+)$/.exec(line);
		if (item) {
			items.push({ text: item[1], points: null });
			continue;
		}
		const at = /^ {3}Points at: (.+)$/.exec(line);
		if (at && items.length) items[items.length - 1].points = at[1];
	}
	if (!items.length) return null;
	return {
		taskId: head[1],
		title: head[2],
		url: preview ? preview[3] : null,
		plugin: plugin ? { id: plugin[4], name: plugin[3], subject: plugin[5] ?? null } : null,
		items
	};
}
