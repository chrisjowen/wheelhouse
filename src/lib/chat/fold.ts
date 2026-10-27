/**
 * How the home page's chat reads Firstmate's Claude Code transcript: records
 * (one JSON object per transcript line, already slimmed by the server) folded
 * into a calm conversation - the captain's messages, Firstmate's turns made of
 * Markdown replies and collapsed "activity" (thinking, tool calls, injected
 * context), question cards for Claude Code's question picker, and a few quiet
 * notices. Pure, so it is unit-tested with synthetic records.
 *
 * Record shapes this relies on (Claude Code 2.1.x):
 *   - assistant: one record per content block (thinking, text, tool_use), in order;
 *     several records share one message.id.
 *   - user: the captain's typed message (`origin.kind` "human", string content);
 *     tool results (tool_result blocks); injected skill bodies and context
 *     (`isMeta`, often with `sourceToolUseID`); supervision wakes
 *     (`origin.kind` "task-notification", string starting `<task-notification>`).
 *   - attachment `queued_command`: a message the captain typed while Firstmate
 *     was busy (there is no user record for it); `hook_additional_context`.
 *   - a meta reminder "The user sent a new message while you were working:": the
 *     same, handed over mid-turn.
 *   - system: `turn_duration` ends a turn; `away_summary`; `local_command` holds a
 *     slash command's echo (`<command-name>`) and its output (`<local-command-stdout>`).
 *   - `isSidechain` records belong to helpers and are not shown.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
type Rec = Record<string, any>;

export type Step =
	| { kind: 'thinking'; id: string; ms: number | null }
	| {
			kind: 'tool';
			id: string;
			name: string;
			verb: string;
			summary: string;
			noun: [string, string];
			input: unknown;
			result: string | null;
			isError: boolean;
	  }
	| { kind: 'context'; id: string; label: string; detail: string };

export interface QuestionOption {
	label: string;
	description: string;
}

export interface Question {
	header: string;
	question: string;
	multiSelect: boolean;
	options: QuestionOption[];
}

export type Part =
	| { kind: 'text'; id: string; text: string }
	| { kind: 'activity'; id: string; steps: Step[] }
	| {
			kind: 'question';
			/** The AskUserQuestion tool call's id, which the answer endpoint needs. */
			id: string;
			questions: Question[];
			/** The captain's answers once given (question text to answer), else null. */
			answers: Record<string, string> | null;
	  };

export type Item =
	| { kind: 'user'; id: string; text: string; at: string; queued: boolean; command: boolean }
	| { kind: 'notice'; id: string; title: string; detail: string; at: string }
	| { kind: 'output'; id: string; text: string; at: string }
	| {
			kind: 'turn';
			id: string;
			parts: Part[];
			at: string;
			durationMs: number | null;
			done: boolean;
			interrupted: boolean;
			/** captain: started by the captain; background: by a supervision wake. */
			trigger: 'captain' | 'background';
	  };

export type Turn = Extract<Item, { kind: 'turn' }>;

/** One background supervision turn (a task-notification wake), for the health indicator. */
export interface Check {
	id: string;
	at: string;
	durationMs: number | null;
	done: boolean;
	/** quiet: kept out of the chat (no reply, or only an all-clear); reported: shown. */
	outcome: 'quiet' | 'reported';
}

export interface Chat {
	items: Item[];
	title: string | null;
	/** Background supervision turns, oldest first. */
	checks: Check[];
}

/** A reply that carries nothing for the captain: the supervision all-clear. */
export const QUIET_REPLY =
	/^(captain[,.!]?\s*)?(shipshape|all (is )?well|all quiet|nothing (new )?to report)[.!]?$/i;

const INTERRUPTED = /^\[Request interrupted by user/;
// eslint-disable-next-line no-control-regex
const ANSI = /\u001b\[[0-9;?]*[A-Za-z]/g;

const base = (p: unknown) =>
	String(p ?? '')
		.split('/')
		.filter(Boolean)
		.pop() ?? '';
const firstLine = (s: unknown) =>
	String(s ?? '')
		.split('\n')[0]
		.trim();
const host = (u: unknown) => {
	try {
		return new URL(String(u)).host;
	} catch {
		return String(u ?? '');
	}
};

/** Plain-language verb, one-line summary and a countable noun for a tool call. */
export function describeTool(
	name: string,
	input: Rec
): { verb: string; summary: string; noun: [string, string] } {
	switch (name) {
		case 'Bash':
			return {
				verb: 'Ran',
				summary: input.description || firstLine(input.command),
				noun: ['command', 'commands']
			};
		case 'Read':
			return { verb: 'Read', summary: base(input.file_path), noun: ['file read', 'files read'] };
		case 'Edit':
		case 'MultiEdit':
			return { verb: 'Edited', summary: base(input.file_path), noun: ['edit', 'edits'] };
		case 'Write':
			return {
				verb: 'Wrote',
				summary: base(input.file_path),
				noun: ['file written', 'files written']
			};
		case 'Grep':
			return {
				verb: 'Searched code for',
				summary: String(input.pattern ?? ''),
				noun: ['code search', 'code searches']
			};
		case 'Glob':
			return {
				verb: 'Listed files',
				summary: String(input.pattern ?? ''),
				noun: ['file listing', 'file listings']
			};
		case 'WebSearch':
			return {
				verb: 'Searched the web for',
				summary: String(input.query ?? ''),
				noun: ['web search', 'web searches']
			};
		case 'WebFetch':
			return { verb: 'Read page', summary: host(input.url), noun: ['page read', 'pages read'] };
		case 'Skill':
			return { verb: 'Used skill', summary: String(input.skill ?? ''), noun: ['skill', 'skills'] };
		case 'ToolSearch':
			return {
				verb: 'Loaded tools',
				summary: firstLine(input.query),
				noun: ['tool lookup', 'tool lookups']
			};
		case 'Agent':
		case 'Task':
			return {
				verb: 'Asked a helper',
				summary: input.description || firstLine(input.prompt),
				noun: ['helper', 'helpers']
			};
		case 'TodoWrite':
			return { verb: 'Updated the plan', summary: '', noun: ['plan update', 'plan updates'] };
		case 'SendMessage':
			return { verb: 'Messaged', summary: String(input.to ?? ''), noun: ['message', 'messages'] };
		default: {
			const m = name.match(/^mcp__(.+?)__(.+)$/);
			if (m) {
				return {
					verb: 'Used',
					summary: `${m[2].replace(/_/g, ' ')} (${m[1]})`,
					noun: ['tool call', 'tool calls']
				};
			}
			return { verb: 'Used', summary: name, noun: ['tool call', 'tool calls'] };
		}
	}
}

function resultText(content: unknown): string {
	if (typeof content === 'string') return content;
	if (Array.isArray(content)) {
		return content
			.map((c: Rec) =>
				c?.type === 'text'
					? String(c.text ?? '')
					: c?.type === 'image'
						? '[image]'
						: c?.type === 'tool_reference'
							? `[tool: ${c.tool_name ?? ''}]`
							: `[${c?.type ?? 'item'}]`
			)
			.join('\n');
	}
	return '';
}

/** What the captain wrote: injected reminders dropped, and the <pasted_content id="…"> tags Claude Code wraps a large paste in. */
const captainText = (s: string) =>
	s
		.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '')
		.replace(/<\/?pasted_content(?:\s+id="[^"]*")?\s*>\n?/g, '')
		.trim();

const MID_TURN =
	/<system-reminder>\s*The user sent a new message while you were working:\n([\s\S]*?)(?:\n\nThis is how Claude Code (?:(?!\n\n)[\s\S])*)?\s*<\/system-reminder>/;

/** The captain's message in a mid-turn delivery reminder, or null. */
const midTurn = (s: string) => {
	const m = s.match(MID_TURN);
	return m ? captainText(m[1]) || null : null;
};

function tag(s: string, name: string): string | null {
	const m = s.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`));
	return m ? m[1].trim() : null;
}

/** A slash command's visible form (`/context all`) from its `<command-name>` wrapper, or null. */
function commandText(s: string): string | null {
	const name = tag(s, 'command-name');
	if (!name) return null;
	const args = tag(s, 'command-args');
	return args ? `${name} ${args}` : name;
}

function questions(input: Rec): Question[] {
	const qs = Array.isArray(input?.questions) ? input.questions : [];
	return qs.map((q: Rec) => ({
		header: String(q?.header ?? ''),
		question: String(q?.question ?? ''),
		multiSelect: q?.multiSelect === true,
		options: (Array.isArray(q?.options) ? q.options : []).map((o: Rec) => ({
			label: String(o?.label ?? ''),
			description: String(o?.description ?? '')
		}))
	}));
}

/** The answers in an AskUserQuestion result, from its structured form or its text. */
function answersOf(r: Rec, text: string): Record<string, string> {
	const structured = r.toolUseResult?.answers;
	if (structured && typeof structured === 'object') {
		return Object.fromEntries(Object.entries(structured).map(([k, v]) => [k, String(v)]));
	}
	const out: Record<string, string> = {};
	for (const m of text.matchAll(/"([^"]+)"="([^"]*)"/g)) out[m[1]] = m[2];
	return out;
}

export function fold(records: Rec[]): Chat {
	const items: Item[] = [];
	const tools = new Map<string, Extract<Step, { kind: 'tool' }>>();
	const asks = new Map<string, Extract<Part, { kind: 'question' }>>();
	let title: string | null = null;
	// Assigned inside the helpers below, so typed by assertion rather than narrowed to null.
	let turn = null as Turn | null;
	let lastTurn = null as Turn | null;
	let prevAt: string | null = null;
	let wake = false;

	const closeTurn = () => {
		turn = null;
	};
	const ensureTurn = (r: Rec): Turn => {
		if (!turn) {
			turn = {
				kind: 'turn',
				id: r.uuid,
				parts: [],
				at: r.timestamp,
				durationMs: null,
				done: false,
				interrupted: false,
				trigger: wake ? 'background' : 'captain'
			};
			wake = false;
			items.push(turn);
			lastTurn = turn;
		}
		return turn;
	};
	const activity = (r: Rec) => {
		const t = ensureTurn(r);
		const last = t.parts[t.parts.length - 1];
		if (last?.kind === 'activity') return last;
		const a: Part = { kind: 'activity', id: `${r.uuid}-a`, steps: [] };
		t.parts.push(a);
		return a;
	};
	const user = (r: Rec, text: string, opts: { queued?: boolean; command?: boolean } = {}) => {
		closeTurn();
		wake = false;
		items.push({
			kind: 'user',
			id: r.uuid,
			text,
			at: r.timestamp,
			queued: !!opts.queued,
			command: !!opts.command
		});
	};
	/** Injected context: a step inside the current turn, or nothing between turns. */
	const context = (r: Rec, label: string, detail: string, id = r.uuid) => {
		if (turn) activity(r).steps.push({ kind: 'context', id, label, detail });
	};

	for (const r of records) {
		if (!r || typeof r !== 'object' || r.isSidechain) continue;
		const at: string | null = r.timestamp ?? null;
		switch (r.type) {
			case 'ai-title':
				title = r.aiTitle ?? title;
				break;
			case 'user': {
				const c = r.message?.content;
				if (typeof c === 'string') {
					if (
						r.origin?.kind === 'task-notification' ||
						c.trimStart().startsWith('<task-notification>')
					) {
						// A supervision wake: the turn it starts is judged after the fold.
						closeTurn();
						wake = true;
					} else if (r.isMeta) {
						const mid = midTurn(c);
						if (mid) user(r, mid, { queued: true });
						else context(r, 'Context added', c);
					} else if (INTERRUPTED.test(c.trim())) {
						if (lastTurn) lastTurn.interrupted = true;
					} else {
						const cmd = commandText(c);
						if (cmd) user(r, cmd, { command: true });
						else if (!c.includes('<local-command-stdout>')) {
							const t = captainText(c);
							if (t) user(r, t);
						}
					}
				} else if (Array.isArray(c)) {
					for (const b of c) {
						if (b?.type === 'tool_result') {
							const text = resultText(b.content);
							const step = tools.get(b.tool_use_id);
							if (step) {
								step.result = text;
								step.isError = !!b.is_error;
							}
							const ask = asks.get(b.tool_use_id);
							if (ask) ask.answers = b.is_error ? {} : answersOf(r, text);
						} else if (b?.type === 'text') {
							const text = String(b.text ?? '');
							const mid = midTurn(text);
							if (INTERRUPTED.test(text.trim())) {
								if (lastTurn) lastTurn.interrupted = true;
							} else if (mid) {
								user(r, mid, { queued: true });
							} else if (r.isMeta || r.sourceToolUseID) {
								const label = text.startsWith('Base directory for this skill')
									? 'Skill instructions loaded'
									: 'Context added';
								context(r, label, text, `${r.uuid}-${label}`);
							} else {
								const t = captainText(text);
								if (t) user(r, t);
							}
						} else if (b?.type === 'image') {
							user(r, '[image]');
						}
					}
				}
				break;
			}
			case 'assistant': {
				for (const b of r.message?.content ?? []) {
					if (b?.type === 'thinking' || b?.type === 'redacted_thinking') {
						const ms = prevAt && at ? Date.parse(at) - Date.parse(prevAt) : null;
						activity(r).steps.push({ kind: 'thinking', id: `${r.uuid}-th`, ms });
					} else if (b?.type === 'tool_use' && b.name === 'AskUserQuestion') {
						const part: Extract<Part, { kind: 'question' }> = {
							kind: 'question',
							id: b.id,
							questions: questions(b.input),
							answers: null
						};
						asks.set(b.id, part);
						ensureTurn(r).parts.push(part);
					} else if (b?.type === 'tool_use') {
						const d = describeTool(String(b.name), b.input ?? {});
						const step: Extract<Step, { kind: 'tool' }> = {
							kind: 'tool',
							id: b.id,
							name: String(b.name),
							...d,
							input: b.input,
							result: null,
							isError: false
						};
						tools.set(b.id, step);
						activity(r).steps.push(step);
					} else if (b?.type === 'text') {
						if (!String(b.text ?? '').trim()) continue;
						ensureTurn(r).parts.push({ kind: 'text', id: `${r.uuid}-t`, text: b.text });
					}
				}
				break;
			}
			case 'attachment': {
				const a = r.attachment ?? {};
				if (
					a.type === 'queued_command' &&
					typeof a.prompt === 'string' &&
					(a.commandMode ?? 'prompt') === 'prompt'
				) {
					const t = captainText(a.prompt);
					if (t) user(r, t, { queued: true });
				} else if (a.type === 'hook_additional_context') {
					const detail = Array.isArray(a.content) ? a.content.join('\n') : String(a.content ?? '');
					context(r, `Hook added context${a.hookEvent ? ` (${a.hookEvent})` : ''}`, detail);
				}
				break;
			}
			case 'system': {
				if (r.subtype === 'turn_duration') {
					if (lastTurn) {
						lastTurn.durationMs = r.durationMs ?? null;
						lastTurn.done = true;
					}
					closeTurn();
				} else if (r.subtype === 'away_summary') {
					closeTurn();
					items.push({
						kind: 'notice',
						id: r.uuid,
						title: 'While you were away',
						detail: String(r.content ?? ''),
						at: r.timestamp
					});
				} else if (r.subtype === 'local_command') {
					const c = String(r.content ?? '');
					const out = tag(c, 'local-command-stdout') ?? tag(c, 'local-command-stderr');
					const cmd = commandText(c);
					if (cmd) user(r, cmd, { command: true });
					else if (out !== null) {
						const text = out.replace(ANSI, '').trim();
						if (text) items.push({ kind: 'output', id: r.uuid, text, at: r.timestamp });
					}
				}
				break;
			}
		}
		if (at) prevAt = at;
	}

	// Quiet background turns stay out of the chat; substantive ones read as ordinary messages.
	const checks: Check[] = [];
	const visible = items.filter((it, i) => {
		if (it.kind !== 'turn' || it.trigger !== 'background') return true;
		const reply = it.parts
			.filter((p) => p.kind === 'text')
			.map((p) => (p as { text: string }).text)
			.join('\n')
			.trim();
		const asks = it.parts.some((p) => p.kind === 'question');
		const quiet = !asks && (!reply || QUIET_REPLY.test(reply));
		checks.push({
			id: it.id,
			at: it.at,
			durationMs: it.durationMs,
			// A later item means the turn ended even without a turn_duration record.
			done: it.done || i < items.length - 1,
			outcome: quiet ? 'quiet' : 'reported'
		});
		return !quiet;
	});
	return { items: visible, title, checks };
}

/** "5 commands, 2 web searches" (or "Thought for 7s") for a collapsed activity group. */
export function activitySummary(steps: Step[]): string {
	const counts = new Map<string, { n: number; noun: [string, string] }>();
	let thought = false;
	let thinkMs = 0;
	for (const s of steps) {
		if (s.kind === 'thinking') {
			thought = true;
			thinkMs += s.ms ?? 0;
		}
		if (s.kind !== 'tool') continue;
		const c = counts.get(s.noun[0]) ?? { n: 0, noun: s.noun };
		c.n++;
		counts.set(s.noun[0], c);
	}
	const parts = [...counts.values()].map((c) => `${c.n} ${c.n === 1 ? c.noun[0] : c.noun[1]}`);
	if (!parts.length) {
		if (!thought) return 'Read some context';
		return thinkMs >= 1000 ? `Thought for ${duration(thinkMs)}` : 'Thought briefly';
	}
	return parts.join(', ');
}

/** A short duration: 7s, 2m 5s, 1h 3m. */
export function duration(ms: number | null): string {
	if (ms == null || ms < 0) return '';
	const s = Math.round(ms / 1000);
	if (s < 60) return `${s}s`;
	const m = Math.floor(s / 60);
	if (m < 60) return `${m}m ${s % 60}s`;
	return `${Math.floor(m / 60)}h ${m % 60}m`;
}
