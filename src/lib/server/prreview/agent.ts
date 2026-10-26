import { runBounded } from '../firstmate/exec';
import type { Usage } from '../../prreview';

/**
 * The review agent: the local `claude` CLI in headless print mode, read-only.
 * It gets no tools at all (`--tools ""`), no MCP servers, no hooks, plugins,
 * skills or CLAUDE.md (`--safe-mode`), and no saved session, so it can only
 * read what the prompt gives it and write an answer. The prompt goes on stdin;
 * its answer streams back as stream-json, and the closing `result` line gives
 * the cost and token counts.
 */

export interface AgentOptions {
	/** The claude binary (WHEELHOUSE_REVIEW_CLAUDE, else `claude` on PATH). */
	bin: string;
	model: string;
	effort: string;
	/** Passed as --max-budget-usd, so one run can never cost more. */
	maxBudgetUsd: number;
	timeoutMs: number;
	cwd: string;
	env: NodeJS.ProcessEnv;
}

export type AgentResult =
	| { ok: true; text: string; usage: Usage | null }
	| { ok: false; stopped: boolean; error: string; text: string; usage: Usage | null };

export const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'];
/** A model alias or full name; nothing that could read as another flag. */
export const MODEL = /^[A-Za-z0-9][A-Za-z0-9._[\]-]{0,63}$/;

export function agentArgs(o: {
	model: string;
	effort: string;
	maxBudgetUsd: number;
	system: string;
}): string[] {
	return [
		'-p',
		'--output-format',
		'stream-json',
		'--verbose',
		'--include-partial-messages',
		'--model',
		o.model,
		'--effort',
		o.effort,
		'--tools',
		'',
		'--strict-mcp-config',
		'--safe-mode',
		'--disable-slash-commands',
		'--no-session-persistence',
		'--max-budget-usd',
		String(o.maxBudgetUsd),
		'--system-prompt',
		o.system
	];
}

/**
 * The environment the CLI runs in: Wheelhouse's own, without the variables a
 * surrounding Claude Code session sets (so the agent never attaches to it).
 */
export function agentEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
	const out: NodeJS.ProcessEnv = {};
	for (const [k, v] of Object.entries(env)) {
		if (k === 'CLAUDECODE' || /^CLAUDE_CODE_/.test(k)) continue;
		out[k] = v;
	}
	return out;
}

interface ResultLine {
	type: 'result';
	result?: unknown;
	is_error?: boolean;
	total_cost_usd?: unknown;
	duration_ms?: unknown;
	usage?: Record<string, unknown>;
	modelUsage?: Record<string, unknown>;
	api_error_status?: unknown;
}

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

export function usageOf(r: ResultLine, model: string): Usage {
	const u = r.usage ?? {};
	const models = Object.keys(r.modelUsage ?? {});
	return {
		costUsd: typeof r.total_cost_usd === 'number' ? r.total_cost_usd : null,
		inputTokens: num(u.input_tokens),
		outputTokens: num(u.output_tokens),
		cachedTokens: num(u.cache_read_input_tokens) + num(u.cache_creation_input_tokens),
		durationMs: num(r.duration_ms),
		model: models[0] ?? model
	};
}

/**
 * Reads stream-json as it arrives: text deltas go to `onText` (the whole
 * assistant message when partial messages are not sent), and the result line
 * is kept for the end.
 */
export class StreamReader {
	private buf = '';
	private sawDelta = false;
	text = '';
	result: ResultLine | null = null;

	constructor(private onText: (delta: string) => void) {}

	push(chunk: string): void {
		this.buf += chunk;
		let nl: number;
		while ((nl = this.buf.indexOf('\n')) >= 0) {
			const line = this.buf.slice(0, nl).trim();
			this.buf = this.buf.slice(nl + 1);
			if (line) this.line(line);
		}
	}

	end(): void {
		const rest = this.buf.trim();
		this.buf = '';
		if (rest) this.line(rest);
	}

	private emit(delta: string) {
		if (!delta) return;
		this.text += delta;
		this.onText(delta);
	}

	private line(line: string): void {
		let v: Record<string, unknown>;
		try {
			v = JSON.parse(line);
		} catch {
			return;
		}
		if (v.type === 'stream_event') {
			const ev = v.event as { type?: string; delta?: { type?: string; text?: unknown } } | null;
			if (ev?.type === 'content_block_delta' && ev.delta?.type === 'text_delta') {
				this.sawDelta = true;
				this.emit(typeof ev.delta.text === 'string' ? ev.delta.text : '');
			}
		} else if (v.type === 'assistant' && !this.sawDelta) {
			const content = (v.message as { content?: unknown } | null)?.content;
			if (Array.isArray(content))
				for (const c of content)
					if (c?.type === 'text' && typeof c.text === 'string') this.emit(c.text);
		} else if (v.type === 'result') {
			this.result = v as unknown as ResultLine;
		}
	}
}

/** Run the agent once. `onText` gets the answer as it streams. */
export async function runAgent(
	prompt: string,
	system: string,
	o: AgentOptions,
	on: { onText: (delta: string) => void; signal?: AbortSignal }
): Promise<AgentResult> {
	const reader = new StreamReader(on.onText);
	const decoder = new TextDecoder();
	const r = await runBounded(
		o.bin,
		agentArgs({ model: o.model, effort: o.effort, maxBudgetUsd: o.maxBudgetUsd, system }),
		{
			cwd: o.cwd,
			env: agentEnv(o.env),
			input: prompt,
			maxInputBytes: 2 * 1024 * 1024,
			timeoutMs: o.timeoutMs,
			maxOutputBytes: 16 * 1024 * 1024,
			onStdout: (chunk) => reader.push(decoder.decode(chunk, { stream: true })),
			signal: on.signal
		}
	);
	reader.push(decoder.decode());
	reader.end();
	const res = reader.result;
	const usage = res ? usageOf(res, o.model) : null;
	const final = typeof res?.result === 'string' ? res.result : '';
	// A failed run's result line is its error message, not an answer.
	const text = reader.text || (res?.is_error ? '' : final);
	if (!r.ok) {
		const stopped = r.kind === 'aborted';
		const why =
			r.kind === 'spawn-error'
				? `Could not start ${o.bin}: ${r.message}. Is Claude Code installed and on the PATH?`
				: r.kind === 'timeout'
					? `The review agent took longer than ${Math.round(o.timeoutMs / 60000)} minutes and was stopped.`
					: stopped
						? 'Stopped.'
						: res?.is_error && final
							? `The review agent failed: ${final}`
							: `The review agent failed (${r.message}). ${r.stderr.trim().split('\n').slice(-2).join(' ')}`.trim();
		return { ok: false, stopped, error: why, text, usage };
	}
	if (!res)
		return { ok: false, stopped: false, error: 'The review agent gave no answer.', text, usage };
	if (res.is_error)
		return {
			ok: false,
			stopped: false,
			error: `The review agent failed: ${final || 'no reason given'}`,
			text,
			usage
		};
	return { ok: true, text, usage };
}
