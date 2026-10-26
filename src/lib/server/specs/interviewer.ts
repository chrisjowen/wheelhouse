import { stat } from 'node:fs/promises';
import type { SpecDraft } from '../../spec';
import {
	CLAUDE_EFFORTS,
	runClaude,
	type ClaudeEffort,
	type ClaudeRunConfig
} from '../claude/headless';
import {
	findInterviewSkill,
	MessageStream,
	openComments,
	parseReply,
	skillDirs,
	systemPrompt,
	turnPrompt
} from './interview';
import type { SpecStore } from './store';

/**
 * Runs the spec interview, one agent turn at a time: records what the
 * captain said, asks the local claude CLI (headless, read-only) for the next
 * question and the spec's changes, streams the message as it is written, and
 * saves the result. One turn per draft at a time.
 */

export interface InterviewerSettings {
	bin: string;
	model: string;
	effort: ClaudeEffort;
}

/**
 * The claude CLI and the model the interviewer uses: WHEELHOUSE_CLAUDE_BIN,
 * WHEELHOUSE_SPEC_MODEL (default `sonnet`) and WHEELHOUSE_SPEC_EFFORT
 * (default `low`), which the CLI's --spec-model and --spec-effort set.
 */
export function interviewerSettings(env: NodeJS.ProcessEnv = process.env): InterviewerSettings {
	const effort = env.WHEELHOUSE_SPEC_EFFORT as ClaudeEffort;
	return {
		bin: env.WHEELHOUSE_CLAUDE_BIN || 'claude',
		model: env.WHEELHOUSE_SPEC_MODEL || 'sonnet',
		effort: CLAUDE_EFFORTS.includes(effort) ? effort : 'low'
	};
}

/** What a turn streams to the page. */
export type TurnEvent =
	| { type: 'text'; text: string }
	/** The agent started its message over (after reading the project). */
	| { type: 'reset' }
	| { type: 'tool'; name: string; detail: string };

export type TurnResult =
	| { ok: true; draft: SpecDraft }
	| { ok: false; status: number; message: string; draft: SpecDraft | null };

export interface InterviewerOptions {
	settings: InterviewerSettings;
	/** Where the captain's skills are looked for (the grilling skill). */
	skillDirs?: string[];
	/** A project's checkout, which the agent may read; null when unknown. */
	projectPath?: (project: string) => Promise<string | null>;
	env?: NodeJS.ProcessEnv;
	timeoutMs?: number;
}

const TURN_TIMEOUT_MS = 5 * 60_000;

export class Interviewer {
	private busy = new Set<string>();

	constructor(
		readonly store: SpecStore,
		private opts: InterviewerOptions
	) {}

	get settings(): InterviewerSettings {
		return this.opts.settings;
	}

	isBusy(id: string): boolean {
		return this.busy.has(id);
	}

	/**
	 * One turn: `answer` is what the captain just said (null to have the agent
	 * address new comments, or try again after a failed turn).
	 */
	async turn(
		id: string,
		answer: string | null,
		onEvent: (e: TurnEvent) => void = () => {},
		signal?: AbortSignal
	): Promise<TurnResult> {
		if (this.busy.has(id)) {
			return {
				ok: false,
				status: 409,
				message: 'The interviewer is already working on this spec.',
				draft: null
			};
		}
		this.busy.add(id);
		try {
			let draft = await this.store.get(id);
			if (!draft) return { ok: false, status: 404, message: 'That spec no longer exists.', draft };
			const said = answer?.trim() ?? '';
			if (said) draft = await this.store.addAnswer(id, said);
			if (!draft) return { ok: false, status: 404, message: 'That spec no longer exists.', draft };
			if (!said && !draft.interview.turns.length && !openComments(draft).length) {
				return {
					ok: false,
					status: 400,
					message: 'Say what you want built first.',
					draft
				};
			}

			const project = draft.project.trim();
			const cwd = (project && (await this.opts.projectPath?.(project))) || null;
			const readable = !!cwd && (await isDir(cwd));
			const config: ClaudeRunConfig = {
				...this.opts.settings,
				systemPrompt: systemPrompt(await findInterviewSkill(this.opts.skillDirs ?? skillDirs())),
				tools: readable ? ['Read', 'Grep', 'Glob'] : [],
				cwd: readable ? cwd : this.store.dir
			};
			const stream = new MessageStream();
			const result = await runClaude(config, {
				prompt: turnPrompt(draft, said || null),
				env: this.opts.env,
				timeoutMs: this.opts.timeoutMs ?? TURN_TIMEOUT_MS,
				signal,
				onEvent: (e) => {
					if (e.type === 'message') {
						stream.reset();
						onEvent({ type: 'reset' });
					} else if (e.type === 'text') {
						const text = stream.push(e.text);
						if (text) onEvent({ type: 'text', text });
					} else onEvent(e);
				}
			});
			if (!result.ok) {
				const after = await this.store.addUsage(id, result.usage);
				return { ok: false, status: 502, message: result.message, draft: after ?? draft };
			}
			const saved = await this.store.applyAgent(id, parseReply(result.text), result.usage);
			if (!saved) return { ok: false, status: 404, message: 'That spec no longer exists.', draft };
			return { ok: true, draft: saved };
		} finally {
			this.busy.delete(id);
		}
	}
}

async function isDir(p: string): Promise<boolean> {
	try {
		return (await stat(p)).isDirectory();
	} catch {
		return false;
	}
}
