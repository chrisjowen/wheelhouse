import { readFile } from 'node:fs/promises';
import path from 'node:path';
import {
	changedSections,
	normalizeSpec,
	SPEC_SECTIONS,
	type SpecComment,
	type SpecDraft,
	type SpecSectionId
} from '../../spec';

/**
 * The spec interview's protocol with the agent. Each turn the agent gets the
 * spec so far, the interview so far and the captain's open comments, and
 * answers with a message to the captain, then a marker line, then a JSON
 * object with its changes to the spec. Pure, apart from finding the
 * interviewing skill on disk.
 */

/** The line that ends the agent's message to the captain and starts its changes. */
export const SPEC_MARKER = '===SPEC===';

/** The spec fields the agent may write, and whether each is a list. */
const FIELDS = {
	title: false,
	project: false,
	summary: false,
	problem: false,
	goal: false,
	audience: false,
	journeys: true,
	scope: false,
	nonGoals: false,
	requirements: true,
	uiNotes: false,
	links: true,
	constraints: false,
	risks: false,
	questions: true
} as const satisfies Partial<Record<keyof SpecDraft, boolean>>;
type Field = keyof typeof FIELDS;

/** Used when no grilling skill is installed. */
export const FALLBACK_INTERVIEW_SKILL = `Interview the captain relentlessly about every aspect of this until you reach a shared understanding. Walk down each branch of the decision tree, resolving dependencies between decisions one by one. For each question, give your recommended answer.

Ask the questions one at a time, waiting for an answer to each before continuing. Asking several questions at once is bewildering.

If a fact can be found by exploring the project (its files), look it up rather than asking. The decisions, though, are the captain's: put each one to them and wait for their answer.`;

/**
 * The interviewing skill's own words, from the captain's Claude Code skills:
 * `grilling`, else `grill-me` (followed when it only says to run another
 * skill). Frontmatter is dropped. Null when neither is installed.
 */
export async function findInterviewSkill(dirs: string[]): Promise<string | null> {
	const read = async (name: string): Promise<string | null> => {
		for (const dir of dirs) {
			try {
				const raw = await readFile(path.join(dir, name, 'SKILL.md'), 'utf8');
				const body = raw.replace(/^---\n[\s\S]*?\n---\n?/, '').trim();
				if (body) return body.slice(0, 8000);
			} catch {
				// not here
			}
		}
		return null;
	};
	const grilling = await read('grilling');
	if (grilling) return grilling;
	const grill = await read('grill-me');
	if (!grill) return null;
	const pointer = grill.match(/^Run an? `\/([\w-]+)` session\.?$/);
	return pointer ? await read(pointer[1]) : grill;
}

/** Where the captain's Claude Code skills live. */
export function skillDirs(env: NodeJS.ProcessEnv = process.env): string[] {
	const home = env.HOME ?? '';
	const config = env.CLAUDE_CONFIG_DIR || path.join(home, '.claude');
	return [path.join(config, 'skills'), path.join(home, '.agents', 'skills')];
}

export function systemPrompt(skill: string | null): string {
	const sections = SPEC_SECTIONS.map((s) => `- ${s.title}: ${s.prompt}`).join('\n');
	return `You are the spec interviewer in Wheelhouse, the captain's window onto Firstmate, an AI crew that builds software. The captain has an idea for a piece of work. Your job is to grill them, one question at a time, until the idea is a clear, buildable spec, and to keep the spec up to date after every answer. When the spec is done the captain sends it to Firstmate as a build request. You never build, change or write anything yourself: you only ask, read and update the spec.

# How to interview

${skill ?? FALLBACK_INTERVIEW_SKILL}

In this interview, also:
- Ask exactly one question per turn. Keep each message short: a sentence or two of context at most, then the question.
- Challenge vague answers ("fast", "simple", "users") and ask for the concrete case.
- Offer 2 to 4 short answers the captain can pick from, and say which one you recommend and why, in a few words. The captain may answer in their own words instead.
- Cover the spec's sections in a sensible order, skipping what does not apply:
${sections}
- Turn what the captain says into testable requirements, one check each.
- Know when to stop. When the spec covers the problem, who it is for, how they use it, scope, testable requirements and the main risks, and nothing important is left open, say the spec looks ready to send to build, ask whether anything is missing, and set "done" to true. Do not drag the interview on with minor questions.

# Comments

The captain can comment on parts of the spec. Address every open comment you are given: revise the spec to reflect it, or ask a follow-up question when it needs a decision. Mark each one you addressed as resolved with a one-line reply saying what you did.

# How to answer

Write your message to the captain in plain Markdown. Then, on its own line, write ${SPEC_MARKER} and after it one JSON object, with no code fence:

{"spec": {<only the fields you changed>}, "options": ["...", "..."], "recommended": 0, "resolved": [{"id": "c-...", "reply": "..."}], "done": false}

- "spec" holds the fields you changed, each with its whole new value. Text fields: title, project, summary, problem, goal, audience, scope, nonGoals, uiNotes, constraints, risks. List fields (arrays of strings): journeys, requirements, links, questions. Keep the captain's words where you can; write in plain, short sentences. "questions" holds what is still undecided.
- "options" are the answers you offer for your question (may be empty); "recommended" is the index of the one you recommend, or null.
- "resolved" lists the comments you addressed (may be empty).
- Put the options in "options", not in your message.`;
}

/** The spec's fields as the agent sees them. */
function specFields(d: SpecDraft): Record<Field, string | string[]> {
	const out = {} as Record<Field, string | string[]>;
	for (const f of Object.keys(FIELDS) as Field[]) out[f] = d[f];
	return out;
}

const sectionTitle = (id: SpecSectionId) => SPEC_SECTIONS.find((s) => s.id === id)?.title ?? id;

export function openComments(d: SpecDraft): SpecComment[] {
	return d.comments.filter((c) => !c.resolvedAt);
}

/** The prompt for one turn, from the interview as it stands. */
export function turnPrompt(d: SpecDraft): string {
	const transcript = d.interview.turns
		.map((t) => `${t.role === 'agent' ? 'You' : 'Captain'}: ${t.text}`)
		.join('\n\n');
	const comments = openComments(d)
		.map(
			(c) =>
				`- [${c.id}] on "${sectionTitle(c.section)}"${c.quote ? `, about "${c.quote}"` : ''}: ${c.text}`
		)
		.join('\n');
	const turns = d.interview.turns;
	const next =
		turns.at(-1)?.role === 'captain'
			? turns.length <= 1
				? 'The captain has just described what they want built (the last message above). Start the interview: fill in what you can of the spec from it, then ask your first question.'
				: 'The captain has just answered (the last message above). Update the spec with the answer, then ask your next question, or say the spec is ready.'
			: comments
				? 'The captain has added comments on the spec. Address them, then carry on with the interview.'
				: 'Carry on with the interview: ask your next question, or say the spec is ready.';
	return [
		`# The spec so far\n\n${JSON.stringify(specFields(d), null, 2)}`,
		transcript ? `# The interview so far\n\n${transcript}` : '',
		comments ? `# The captain's open comments on the spec\n\n${comments}` : '',
		`# Your turn\n\n${next}`
	]
		.filter(Boolean)
		.join('\n\n');
}

export interface AgentReply {
	message: string;
	spec: Partial<Record<Field, string | string[]>>;
	options: string[];
	recommended: number | null;
	resolved: { id: string; reply: string }[];
	done: boolean;
}

/** The JSON object after the marker, tolerating a code fence around it. */
function parseTail(tail: string): Record<string, unknown> | null {
	const body = tail
		.trim()
		.replace(/^```(?:json)?\s*/i, '')
		.replace(/\s*```$/, '');
	const start = body.indexOf('{');
	const end = body.lastIndexOf('}');
	if (start < 0 || end < start) return null;
	try {
		const v: unknown = JSON.parse(body.slice(start, end + 1));
		return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
	} catch {
		return null;
	}
}

/**
 * The agent's answer, split into its message and its changes. Anything that
 * does not fit the protocol is dropped; a reply with no marker (or JSON that
 * does not parse) is all message and changes nothing.
 */
export function parseReply(raw: string): AgentReply {
	const at = raw.indexOf(SPEC_MARKER);
	const message = (at < 0 ? raw : raw.slice(0, at)).trim();
	const tail = at < 0 ? null : parseTail(raw.slice(at + SPEC_MARKER.length));
	const reply: AgentReply = {
		message,
		spec: {},
		options: [],
		recommended: null,
		resolved: [],
		done: false
	};
	if (!tail) return reply;
	const spec =
		tail.spec && typeof tail.spec === 'object' ? (tail.spec as Record<string, unknown>) : {};
	for (const f of Object.keys(FIELDS) as Field[]) {
		const v = spec[f];
		if (FIELDS[f] && Array.isArray(v)) {
			reply.spec[f] = v.filter((x): x is string => typeof x === 'string');
		} else if (!FIELDS[f] && typeof v === 'string') {
			reply.spec[f] = v;
		}
	}
	if (Array.isArray(tail.options)) {
		reply.options = tail.options
			.filter((x): x is string => typeof x === 'string' && !!x.trim())
			.map((x) => x.trim().slice(0, 500))
			.slice(0, 6);
	}
	const rec = tail.recommended;
	reply.recommended =
		typeof rec === 'number' && Number.isInteger(rec) && rec >= 0 && rec < reply.options.length
			? rec
			: null;
	if (Array.isArray(tail.resolved)) {
		for (const r of tail.resolved) {
			if (r && typeof r === 'object' && typeof (r as { id?: unknown }).id === 'string') {
				const { id, reply: text } = r as { id: string; reply?: unknown };
				reply.resolved.push({ id, reply: typeof text === 'string' ? text : '' });
			}
		}
	}
	reply.done = tail.done === true;
	return reply;
}

/**
 * The draft after the agent's reply: its changes to the spec (bounded like
 * any saved draft), the comments it resolved, and its message added to the
 * interview with the sections it changed.
 */
export function applyReply(
	d: SpecDraft,
	reply: AgentReply,
	now: Date = new Date()
): { draft: SpecDraft; changed: SpecSectionId[] } {
	const at = now.toISOString();
	const edited = normalizeSpec({ ...d, ...reply.spec }, d.id, now) ?? d;
	const next: SpecDraft = {
		...d,
		...Object.fromEntries((Object.keys(FIELDS) as Field[]).map((f) => [f, edited[f]]))
	};
	const changed = changedSections(d, next);
	const resolved = new Map(reply.resolved.map((r) => [r.id, r.reply]));
	next.comments = d.comments.map((c) =>
		!c.resolvedAt && resolved.has(c.id)
			? { ...c, resolvedAt: at, reply: (resolved.get(c.id) ?? '').slice(0, 2000) }
			: c
	);
	next.interview = {
		...d.interview,
		done: reply.done,
		turns: [
			...d.interview.turns,
			{
				role: 'agent',
				text: reply.message || 'I have updated the spec.',
				at,
				options: reply.options,
				recommended: reply.recommended,
				changed
			}
		]
	};
	next.updatedAt = at;
	return { draft: next, changed };
}

/**
 * Streams the agent's message as it is written, holding back anything from
 * the marker on (the JSON is not for the captain to read). Text that might be
 * the start of the marker waits until the next chunk shows whether it is.
 */
export class MessageStream {
	private text = '';
	private shown = 0;
	private ended = false;

	/** New text to show, if any. */
	push(chunk: string): string {
		if (this.ended) return '';
		this.text += chunk;
		const at = this.text.indexOf(SPEC_MARKER);
		if (at >= 0) {
			this.ended = true;
			return this.take(at);
		}
		let safe = this.text.length;
		for (let k = Math.min(SPEC_MARKER.length - 1, this.text.length); k > 0; k--) {
			if (SPEC_MARKER.startsWith(this.text.slice(-k))) {
				safe = this.text.length - k;
				break;
			}
		}
		return this.take(safe);
	}

	/** Start over (the agent began a new message, e.g. after reading a file). */
	reset(): void {
		this.text = '';
		this.shown = 0;
		this.ended = false;
	}

	private take(upTo: number): string {
		const out = this.text.slice(this.shown, upTo);
		this.shown = Math.max(this.shown, upTo);
		return out;
	}
}
