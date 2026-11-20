/**
 * Asking about a decision on the Decisions page. Two kinds of run,
 * each one headless Claude run (server/inbox/talk.ts): `brief`, started in the
 * background as the decision opens, which sums it up in a line or two and
 * reads the options the question itself names; and `ask`, a short answer to
 * the captain's question. Each run is
 * (server/inbox/talk.ts) given the decision and what it rests on: the
 * question as Firstmate recorded it, its task's brief and latest status
 * lines, the report it names, its recommendation and its options. The crew
 * explains and answers; it never decides. It says what the talk came to only
 * when the captain clearly picked an option or agreed a conclusion, never on
 * a question. Submitting that outcome is the captain's, through the decision
 * inbox. Pure, so it is unit-tested.
 */

/** One option of the decision as the quick picks number it. */
export interface TalkOption {
	n: number;
	label: string;
	detail: string | null;
	recommended: boolean;
}

export interface TalkMessage {
	who: 'captain' | 'crew';
	text: string;
}

/** What the browser sends for one turn: the decision, its options, and the talk so far. */
export interface TalkRequest {
	cardId: string;
	/** brief: the summary and named options, in the background; ask: answer the captain. */
	mode: 'brief' | 'ask';
	options: TalkOption[];
	messages: TalkMessage[];
}

/** What the talk came to: an option picked, or a conclusion the captain agreed to. */
export type TalkOutcome = { option: number } | { conclusion: string };

export interface TalkReply {
	reply: string;
	outcome: TalkOutcome | null;
	/**
	 * On the first turn, the options the question itself names (A, B, C…), when
	 * the decision's own form only offers plain answers: they become the quick picks.
	 */
	options: TalkOption[];
}

/** The context the crew is given about one decision. */
export interface TalkContext {
	kind: string;
	title: string;
	question: string;
	recommendation: string | null;
	task: { id: string; title: string; project: string | null; status: string | null };
	brief: string | null;
	history: string[];
	report: { path: string; text: string } | null;
	evidence: string | null;
	findings: string[];
	origin: string | null;
}

export const MAX_MESSAGES = 40;
export const MAX_MESSAGE_CHARS = 2000;
const MAX_OPTIONS = 6;

export const TALK_SYSTEM = [
	'You are the discussion crew in Wheelhouse, talking one decision through with the captain (the human who runs the fleet of AI coding workers).',
	'Firstmate, the supervisor, asked the captain to decide something. Your job is to make the decision easy to understand and to answer the captain’s questions about it, using only the context you are given.',
	'Write plainly, as a colleague would: short paragraphs, no jargon the captain did not use, no headings. Use **bold** for option names and a short list when comparing options. Say when the context does not tell you something rather than guessing.',
	'You never decide for the captain and never send anything; the captain submits the outcome themselves.',
	'outcome: set it only when the captain’s latest message clearly chooses one of the numbered options ({"option": n}) or explicitly agrees to a conclusion you or they stated ({"conclusion": "<the decision in one sentence>"}). A question, a doubt or a request for information is never an outcome: use null.'
].join('\n');

export const TALK_SCHEMA = {
	type: 'object',
	properties: {
		reply: { type: 'string' },
		outcome: {
			anyOf: [
				{ type: 'null' },
				{
					type: 'object',
					properties: { option: { type: 'integer' } },
					required: ['option'],
					additionalProperties: false
				},
				{
					type: 'object',
					properties: { conclusion: { type: 'string' } },
					required: ['conclusion'],
					additionalProperties: false
				}
			]
		},
		options: {
			type: 'array',
			items: {
				type: 'object',
				properties: {
					label: { type: 'string' },
					detail: { type: 'string' },
					recommended: { type: 'boolean' }
				},
				required: ['label', 'recommended'],
				additionalProperties: false
			}
		}
	},
	required: ['reply', 'outcome'],
	additionalProperties: false
};

/** Whether the options are only the plain answers a decision's kind offers, not the question's own. */
export const plainOptions = (options: TalkOption[]) =>
	options.length <= 3 &&
	options.every((o) =>
		/^(go ahead|not like this|change course|approve|fix|skip|merge|not yet|sign it off|request changes|try another way|leave it to firstmate|not now)$/i.test(
			o.label.trim()
		)
	);

/** The prompt for one turn: the context, the options, the talk so far and what to do now. */
export function talkPrompt(ctx: TalkContext, req: TalkRequest): string {
	const lines: string[] = [];
	lines.push('# The decision');
	lines.push(`Type: ${ctx.kind}`);
	lines.push(`Heading: ${ctx.title}`);
	lines.push(`As Firstmate recorded it:\n${ctx.question}`);
	if (ctx.recommendation) lines.push(`Firstmate recommends: ${ctx.recommendation}`);
	lines.push('', '# Its task');
	lines.push(
		`${ctx.task.id}: ${ctx.task.title}${ctx.task.project ? ` (project ${ctx.task.project})` : ''}${ctx.task.status ? `, now ${ctx.task.status}` : ''}`
	);
	if (ctx.origin) lines.push(`It came from the task ${ctx.origin}.`);
	if (ctx.brief) lines.push(`The task's brief:\n${ctx.brief}`);
	if (ctx.history.length) lines.push(`Its latest status lines:\n${ctx.history.join('\n')}`);
	if (ctx.evidence) lines.push(`What the worker wrote about it:\n${ctx.evidence}`);
	if (ctx.findings.length) lines.push(`The review's findings:\n- ${ctx.findings.join('\n- ')}`);
	if (ctx.report) lines.push('', `# The report it names (${ctx.report.path})`, ctx.report.text);
	lines.push('', '# The options, as the captain sees them numbered');
	if (req.options.length)
		for (const o of req.options)
			lines.push(
				`${o.n}. ${o.label}${o.detail ? ` (${o.detail})` : ''}${o.recommended ? ' (recommended)' : ''}`
			);
	else lines.push('None: the captain answers in their own words.');
	lines.push('');
	if (req.mode === 'brief' || !req.messages.length) {
		lines.push(
			'# Now',
			'In `reply`, sum the decision up for the captain in one or two plain sentences (at most 45 words): what is being decided and why it matters now. No preamble, no options list. Set outcome to null.',
			plainOptions(req.options)
				? 'The numbered options above are only plain answers (yes or no to what is proposed). If the decision weighs real alternatives anywhere in its context (lettered or numbered options such as "(B) … or (C) …", "A) … B) …", or plainly "X or Y"), return those alternatives in `options` instead, in order, each with a short label (e.g. "B: shared open-source core") and a one-line detail, marking the one Firstmate recommends; explain them as the options in your reply. Return an empty list only when the decision really is a yes or no.'
				: 'Return an empty `options` list.'
		);
	} else {
		lines.push('# The talk so far');
		for (const m of req.messages)
			lines.push(`${m.who === 'captain' ? 'Captain' : 'You'}: ${m.text}`);
		lines.push(
			'',
			'# Now',
			'Answer the captain’s latest message using the context, briefly: a few sentences (under 120 words) unless they ask for more. Return an empty `options` list. Set outcome only if that message clearly picks an option or agrees a conclusion; otherwise null.'
		);
	}
	return lines.join('\n');
}

const tidy = (s: string) => s.replace(/\s+/g, ' ').trim();

/** Read a turn's answer from the run's structured output; null when it cannot be read. */
export function readTalk(out: Record<string, unknown> | null, req: TalkRequest): TalkReply | null {
	if (!out || typeof out.reply !== 'string' || !out.reply.trim()) return null;
	let outcome: TalkOutcome | null = null;
	const o = out.outcome as Record<string, unknown> | null | undefined;
	const options = Array.isArray(out.options)
		? out.options
				.filter(
					(x): x is { label: string; detail?: unknown; recommended?: unknown } =>
						typeof x === 'object' &&
						x !== null &&
						typeof (x as { label?: unknown }).label === 'string'
				)
				.filter((x) => tidy(x.label))
				.slice(0, MAX_OPTIONS)
				.map((x, i) => ({
					n: i + 1,
					label: tidy(x.label).slice(0, 120),
					detail:
						typeof x.detail === 'string' && tidy(x.detail) ? tidy(x.detail).slice(0, 200) : null,
					recommended: x.recommended === true
				}))
		: [];
	// A question never becomes the outcome, whatever the run says.
	const last = req.messages.at(-1);
	const asking = !last || last.who !== 'captain' || /\?\s*$/.test(last.text.trim());
	if (o && typeof o === 'object' && !asking) {
		const picks = options.length >= 2 ? options : req.options;
		if (typeof o.option === 'number' && picks.some((p) => p.n === o.option))
			outcome = { option: o.option };
		else if (typeof o.conclusion === 'string' && tidy(o.conclusion))
			outcome = { conclusion: tidy(o.conclusion).slice(0, 300) };
	}
	return { reply: out.reply.trim(), outcome, options: options.length >= 2 ? options : [] };
}

/** A request as sent, checked and trimmed; null when it is not one. */
export function talkRequest(body: unknown): TalkRequest | null {
	const b = (typeof body === 'object' && body !== null ? body : {}) as Record<string, unknown>;
	if (typeof b.cardId !== 'string' || !b.cardId) return null;
	const mode = b.mode === 'brief' ? 'brief' : 'ask';
	const options = (Array.isArray(b.options) ? b.options : [])
		.filter((o): o is Record<string, unknown> => typeof o === 'object' && o !== null)
		.filter((o) => typeof o.n === 'number' && typeof o.label === 'string')
		.slice(0, MAX_OPTIONS)
		.map((o) => ({
			n: o.n as number,
			label: tidy(o.label as string).slice(0, 200),
			detail: typeof o.detail === 'string' ? tidy(o.detail).slice(0, 300) : null,
			recommended: o.recommended === true
		}));
	const messages = (Array.isArray(b.messages) ? b.messages : [])
		.filter(
			(m): m is { who: 'captain' | 'crew'; text: string } =>
				typeof m === 'object' &&
				m !== null &&
				((m as { who?: unknown }).who === 'captain' || (m as { who?: unknown }).who === 'crew') &&
				typeof (m as { text?: unknown }).text === 'string'
		)
		.slice(-MAX_MESSAGES)
		.map((m) => ({ who: m.who, text: m.text.slice(0, MAX_MESSAGE_CHARS) }));
	if (mode === 'ask' && messages.at(-1)?.who !== 'captain') return null;
	return { cardId: b.cardId, mode, options, messages };
}
