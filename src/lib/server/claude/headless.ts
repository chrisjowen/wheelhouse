import { spawn, type ChildProcess } from 'node:child_process';
import { trackChild } from '../firstmate/exec';

/**
 * Runs the local `claude` CLI headless (`claude -p`) and reads its
 * stream-json output as it arrives: the text the model writes, the tools it
 * reaches for, and the final result with its usage. The prompt goes on stdin
 * so its size never meets an argument limit. Arguments are an array (no
 * shell), the run has a hard timeout, and it can be stopped with a signal.
 */

export type ClaudeEffort = 'low' | 'medium' | 'high';
export const CLAUDE_EFFORTS: readonly ClaudeEffort[] = ['low', 'medium', 'high'];

export interface ClaudeRunConfig {
	/** The claude executable (WHEELHOUSE_CLAUDE_BIN, else `claude` on the PATH). */
	bin: string;
	model: string;
	effort: ClaudeEffort;
	systemPrompt: string;
	/**
	 * Read-only tools the model may use (e.g. Read, Grep, Glob); none when
	 * empty. Nothing that edits or runs commands is ever offered, and no
	 * permission is granted beyond Claude Code's own default, which lets them
	 * read only inside `cwd`.
	 */
	tools: string[];
	cwd: string;
}

/** Tools a headless run may be given: they only read. */
const READ_ONLY_TOOLS = new Set(['Read', 'Grep', 'Glob']);

export function claudeArgs(c: ClaudeRunConfig): string[] {
	const tools = c.tools.filter((t) => READ_ONLY_TOOLS.has(t));
	return [
		'-p',
		'--output-format',
		'stream-json',
		'--verbose',
		'--include-partial-messages',
		'--model',
		c.model,
		'--effort',
		c.effort,
		'--system-prompt',
		c.systemPrompt,
		'--tools',
		tools.join(','),
		// The captain's hooks, plugins and MCP servers are for their own sessions, not this one.
		'--setting-sources',
		'',
		'--strict-mcp-config',
		'--no-session-persistence'
	];
}

export type ClaudeEvent =
	/** Text the model wrote, as it streams. */
	| { type: 'text'; text: string }
	/** The model started a new message (after using a tool). */
	| { type: 'message' }
	/** The model used a tool; `detail` is what it looked at. */
	| { type: 'tool'; name: string; detail: string };

export interface ClaudeUsage {
	inputTokens: number;
	outputTokens: number;
	costUsd: number;
}

export type ClaudeResult =
	| { ok: true; text: string; usage: ClaudeUsage }
	| { ok: false; message: string; usage: ClaudeUsage };

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

function usageOf(o: Record<string, unknown>): ClaudeUsage {
	const u = (o.usage && typeof o.usage === 'object' ? o.usage : {}) as Record<string, unknown>;
	return {
		inputTokens:
			num(u.input_tokens) + num(u.cache_read_input_tokens) + num(u.cache_creation_input_tokens),
		outputTokens: num(u.output_tokens),
		costUsd: num(o.total_cost_usd)
	};
}

function toolDetail(input: unknown): string {
	if (!input || typeof input !== 'object') return '';
	const i = input as Record<string, unknown>;
	const v = i.file_path ?? i.pattern ?? i.path ?? '';
	return typeof v === 'string' ? v.slice(0, 200) : '';
}

/**
 * One stream-json line, as the events it carries. Returns the final result
 * when the line is the `result` record.
 */
export function readLine(
	line: string,
	emit: (e: ClaudeEvent) => void
): { result: ClaudeResult } | null {
	let o: Record<string, unknown>;
	try {
		const v: unknown = JSON.parse(line);
		if (!v || typeof v !== 'object') return null;
		o = v as Record<string, unknown>;
	} catch {
		return null;
	}
	if (o.type === 'stream_event' && o.event && typeof o.event === 'object') {
		const ev = o.event as Record<string, unknown>;
		const delta = ev.delta as Record<string, unknown> | undefined;
		if (ev.type === 'message_start') emit({ type: 'message' });
		else if (ev.type === 'content_block_delta' && delta?.type === 'text_delta') {
			if (typeof delta.text === 'string' && delta.text) emit({ type: 'text', text: delta.text });
		}
		return null;
	}
	if (o.type === 'assistant' && o.message && typeof o.message === 'object') {
		const content = (o.message as { content?: unknown }).content;
		for (const c of Array.isArray(content) ? content : []) {
			if (c && typeof c === 'object' && (c as { type?: unknown }).type === 'tool_use') {
				const t = c as { name?: unknown; input?: unknown };
				emit({ type: 'tool', name: String(t.name ?? 'tool'), detail: toolDetail(t.input) });
			}
		}
		return null;
	}
	if (o.type === 'result') {
		const usage = usageOf(o);
		const text = typeof o.result === 'string' ? o.result : '';
		if (o.is_error === true || o.subtype !== 'success') {
			return {
				result: { ok: false, message: text || `claude stopped (${String(o.subtype)}).`, usage }
			};
		}
		return { result: { ok: true, text, usage } };
	}
	return null;
}

/** Keys that make the claude CLI bill an API key instead of the claude.ai login. */
const API_KEY_VARS = ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN'];

/**
 * The environment a headless claude run gets: Wheelhouse's own, signed in the
 * way the captain's interactive Claude Code is. The CLI prefers an API key in
 * the environment over the claude.ai login, and a stale key set for every app
 * (launchctl, a shell profile) then fails every run, so the key is dropped
 * unless WHEELHOUSE_CLAUDE_USE_API_KEY=1 asks for key-based billing. A
 * surrounding Claude Code session's variables are dropped too, so the run
 * never attaches to it; CLAUDE_CODE_OAUTH_TOKEN stays, as it is a claude.ai
 * login (`claude setup-token`), not a session variable.
 */
export function claudeEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
	const keepKey = env.WHEELHOUSE_CLAUDE_USE_API_KEY === '1';
	const out: NodeJS.ProcessEnv = {};
	for (const [k, v] of Object.entries(env)) {
		if (k === 'CLAUDECODE' || (/^CLAUDE_CODE_/.test(k) && k !== 'CLAUDE_CODE_OAUTH_TOKEN'))
			continue;
		if (!keepKey && API_KEY_VARS.includes(k)) continue;
		out[k] = v;
	}
	return out;
}

/**
 * A failure message with a plain explanation added when it is the CLI
 * refusing to sign in, so the fix is named rather than only the raw text.
 */
export function withAuthHint(message: string, env: NodeJS.ProcessEnv): string {
	if (
		!/invalid api key|not logged in|please run \/login|authentication_error|oauth token/i.test(
			message
		)
	)
		return message;
	const hint =
		env.WHEELHOUSE_CLAUDE_USE_API_KEY === '1'
			? 'Claude could not sign in with the API key (WHEELHOUSE_CLAUDE_USE_API_KEY=1). Check ANTHROPIC_API_KEY, or unset WHEELHOUSE_CLAUDE_USE_API_KEY to use your claude.ai login.'
			: 'Claude could not sign in. Wheelhouse uses your claude.ai login: run `claude` in a terminal and sign in with /login, then try again.';
	return `${hint} (${message})`;
}

export interface RunOptions {
	prompt: string;
	env?: NodeJS.ProcessEnv;
	timeoutMs: number;
	signal?: AbortSignal;
	onEvent?: (e: ClaudeEvent) => void;
}

const NO_USAGE: ClaudeUsage = { inputTokens: 0, outputTokens: 0, costUsd: 0 };

export function runClaude(config: ClaudeRunConfig, opts: RunOptions): Promise<ClaudeResult> {
	const env = opts.env ?? process.env;
	return new Promise<ClaudeResult>((resolve) => {
		let child: ChildProcess;
		try {
			child = spawn(config.bin, claudeArgs(config), {
				cwd: config.cwd,
				env: claudeEnv(env),
				shell: false,
				detached: true,
				stdio: ['pipe', 'pipe', 'pipe']
			});
		} catch (err) {
			resolve({ ok: false, message: spawnMessage(config.bin, err), usage: NO_USAGE });
			return;
		}
		const kill = trackChild(child);
		let result: ClaudeResult | null = null;
		let failure: string | null = null;
		let settled = false;
		let pending = '';
		let stderr = '';

		const finish = (fallback: string) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			opts.signal?.removeEventListener('abort', abort);
			if (pending.trim()) handle(pending);
			resolve(
				failure
					? { ok: false, message: failure, usage: result?.usage ?? NO_USAGE }
					: (result ?? { ok: false, message: fallback, usage: NO_USAGE })
			);
		};
		const stop = (why: string) => {
			failure ??= why;
			kill();
		};
		const timer = setTimeout(
			() => stop(`The interviewer took longer than ${Math.round(opts.timeoutMs / 1000)} s.`),
			opts.timeoutMs
		);
		const abort = () => stop('Stopped.');
		if (opts.signal?.aborted) abort();
		opts.signal?.addEventListener('abort', abort);

		const handle = (line: string) => {
			const r = readLine(line, (e) => opts.onEvent?.(e));
			if (r) result = r.result;
		};
		child.stdout?.setEncoding('utf8');
		child.stdout?.on('data', (chunk: string) => {
			pending += chunk;
			let nl: number;
			while ((nl = pending.indexOf('\n')) >= 0) {
				const line = pending.slice(0, nl);
				pending = pending.slice(nl + 1);
				if (line.trim()) handle(line);
			}
			if (pending.length > 4 * 1024 * 1024) stop('The interviewer wrote more than expected.');
		});
		child.stderr?.setEncoding('utf8');
		child.stderr?.on('data', (chunk: string) => {
			if (stderr.length < 8192) stderr += chunk;
		});
		child.stdin?.on('error', () => {
			// claude may exit before reading its prompt; the exit says why.
		});
		child.stdin?.end(opts.prompt);
		child.on('error', (err) => {
			failure ??= spawnMessage(config.bin, err);
			finish(failure);
		});
		child.on('close', (code) => {
			const why = stderr.trim().split('\n').filter(Boolean).pop();
			finish(
				code === 0
					? 'claude finished without an answer.'
					: `claude exited with code ${code}${why ? `: ${why.slice(0, 300)}` : ''}.`
			);
		});
	}).then((r) => (r.ok ? r : { ...r, message: withAuthHint(r.message, env) }));
}

function spawnMessage(bin: string, err: unknown): string {
	const code = (err as NodeJS.ErrnoException | null)?.code;
	if (code === 'ENOENT') {
		return `Could not find the claude CLI (${bin}). Install Claude Code, or point WHEELHOUSE_CLAUDE_BIN at it.`;
	}
	return `Could not start claude: ${err instanceof Error ? err.message : String(err)}`;
}
