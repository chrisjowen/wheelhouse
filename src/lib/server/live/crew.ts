import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { BRIEFING_PROMPT, crewSystemPrompt } from './prompt';
import { LOCKED_TOOLS, type CrewLaunch } from './tools';

/**
 * The discussion crew: one Claude Code process for one Live mode discussion,
 * kept running between turns so each answer starts in about a second. The
 * captain's words go in, and the reply streams out, over Claude Code's
 * stream-json input and output; talking over a reply sends Claude Code's own
 * interrupt, so the newest thing the captain said is answered next.
 *
 * It runs with no saved session, in a scratch folder of its own so it never
 * picks up Firstmate's instructions, skills or hooks, with exactly the tools,
 * MCP servers and skills chosen in Settings → Discussion (see tools.ts). It
 * never has a shell or a way to write: anything for Firstmate goes into the
 * briefing.
 *
 * `WHEELHOUSE_LIVE_CLAUDE` names the binary (default: `claude` on PATH) and
 * `WHEELHOUSE_LIVE_MODEL` the model (default: sonnet).
 */

export type CrewEvent =
	| { type: 'delta'; turn: string; text: string }
	| { type: 'tool'; turn: string; name: string }
	| { type: 'done'; turn: string; ok: boolean; error?: string }
	| { type: 'gone'; code: number | null };

/** One line of Claude Code's stream-json output, as what it means here. Pure. */
export function readCrewLine(
	line: string
):
	| { kind: 'text'; text: string }
	| { kind: 'tool'; name: string }
	| { kind: 'result'; ok: boolean; error: string | null }
	| null {
	let m: Record<string, unknown>;
	try {
		m = JSON.parse(line);
	} catch {
		return null;
	}
	if (m.type === 'stream_event') {
		const e = m.event as
			| {
					type?: string;
					delta?: { type?: string; text?: string };
					content_block?: { type?: string; name?: string };
			  }
			| undefined;
		if (e?.type === 'content_block_delta' && e.delta?.type === 'text_delta' && e.delta.text)
			return { kind: 'text', text: e.delta.text };
		if (e?.type === 'content_block_start' && e.content_block?.type === 'tool_use')
			return { kind: 'tool', name: e.content_block.name ?? 'tool' };
		return null;
	}
	if (m.type === 'result') {
		// Claude Code marks a turn it could not run (signed out, out of credit) with is_error.
		const error = m.is_error === true ? String(m.result ?? 'Claude Code could not answer.') : null;
		return { kind: 'result', ok: m.subtype === 'success' && !error, error };
	}
	return null;
}

export interface CrewOptions {
	context: string;
	claude: string;
	model: string;
	/** Exactly what it launches with. */
	launch: CrewLaunch;
	/** For tests: start the process. */
	start?: (file: string, args: string[], cwd: string) => ChildProcessWithoutNullStreams;
}

interface Turn {
	id: string;
	kind: 'talk' | 'brief';
	text: string;
	done: boolean;
	ok: boolean;
	/** A tool call came after the last words. */
	paused?: boolean;
	resolve: (t: Turn) => void;
}

export class Crew {
	readonly transcript: { who: 'captain' | 'crew'; text: string; interrupted?: boolean }[] = [];
	private proc: ChildProcessWithoutNullStreams | null = null;
	/** Turns in the order Claude Code will answer them. */
	private queue: string[] = [];
	private turns = new Map<string, Turn>();
	private listeners = new Set<(e: CrewEvent) => void>();
	private closed = false;
	private dir: string | null = null;

	constructor(private readonly o: CrewOptions) {}

	async start(): Promise<void> {
		const { launch } = this.o;
		const cwd = path.join(tmpdir(), `wheelhouse-live-${randomUUID()}`);
		this.dir = cwd;
		await mkdir(cwd, { recursive: true });
		// Chosen skills come as a one-session plugin of their own. Settings stay off, so nothing
		// else loads: not the captain's other skills, nor Firstmate's in the home it may read.
		const plugin = path.join(cwd, 'skills-plugin');
		if (launch.skills.length) {
			await mkdir(path.join(plugin, '.claude-plugin'), { recursive: true });
			await mkdir(path.join(plugin, 'skills'), { recursive: true });
			await writeFile(
				path.join(plugin, '.claude-plugin', 'plugin.json'),
				JSON.stringify({
					name: 'discussion-skills',
					version: '1.0.0',
					description: 'Skills chosen for the discussion crew'
				})
			);
			for (const skill of launch.skills)
				await symlink(skill.dir, path.join(plugin, 'skills', skill.name)).catch(() => {});
		}
		const mcp = path.join(cwd, 'mcp.json');
		if (launch.mcpConfig) await writeFile(mcp, JSON.stringify(launch.mcpConfig), { mode: 0o600 });
		const args = [
			'-p',
			'--input-format',
			'stream-json',
			'--output-format',
			'stream-json',
			'--include-partial-messages',
			'--verbose',
			'--model',
			this.o.model,
			'--setting-sources',
			'',
			...(launch.skills.length ? ['--plugin-dir', plugin] : []),
			'--strict-mcp-config',
			...(launch.mcpConfig ? ['--mcp-config', mcp] : []),
			'--no-session-persistence',
			'--tools',
			launch.tools.join(','),
			...(launch.allowed.length ? ['--allowedTools', ...launch.allowed] : []),
			'--disallowedTools',
			...LOCKED_TOOLS,
			...launch.readable.flatMap((d) => ['--add-dir', d]),
			'--system-prompt',
			crewSystemPrompt(this.o.context)
		];
		const start =
			this.o.start ??
			((file: string, a: string[], dir: string) =>
				spawn(file, a, {
					cwd: dir,
					env: { ...process.env, MAX_THINKING_TOKENS: '0' },
					stdio: ['pipe', 'pipe', 'pipe']
				}));
		const proc = start(this.o.claude, args, cwd);
		this.proc = proc;
		let buf = '';
		proc.stdout.setEncoding('utf8').on('data', (d: string) => {
			buf += d;
			let i;
			while ((i = buf.indexOf('\n')) >= 0) {
				const line = buf.slice(0, i);
				buf = buf.slice(i + 1);
				if (line.trim()) this.onLine(line);
			}
		});
		proc.stderr.on('data', () => {});
		proc.stdin.on('error', () => {});
		proc.on('error', () => this.end(null));
		proc.on('exit', (code) => this.end(code));
	}

	private end(code: number | null) {
		if (this.closed) return;
		this.closed = true;
		for (const id of this.queue) this.finish(id, false);
		this.queue = [];
		this.emit({ type: 'gone', code });
	}

	get alive(): boolean {
		return !this.closed;
	}

	on(listener: (e: CrewEvent) => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	private emit(e: CrewEvent) {
		for (const l of this.listeners) l(e);
	}

	private onLine(line: string) {
		const read = readCrewLine(line);
		const turn = this.queue[0];
		if (!read || !turn) return;
		if (read.kind === 'text') {
			const t = this.turns.get(turn);
			// Words before and after a tool call are separate blocks: keep them apart.
			const text = t?.paused && t.text && !/\s$/.test(t.text) ? ` ${read.text}` : read.text;
			if (t) {
				t.text += text;
				t.paused = false;
			}
			if (t?.kind === 'talk') this.emit({ type: 'delta', turn, text });
		} else if (read.kind === 'tool') {
			const t = this.turns.get(turn);
			if (t) t.paused = true;
			if (t?.kind === 'talk') this.emit({ type: 'tool', turn, name: read.name });
		} else {
			this.queue.shift();
			this.finish(turn, read.ok, read.error);
		}
	}

	private finish(id: string, ok: boolean, error: string | null = null) {
		const t = this.turns.get(id);
		if (!t || t.done) return;
		t.done = true;
		t.ok = ok;
		if (t.kind === 'talk' && t.text.trim())
			this.transcript.push({ who: 'crew', text: t.text.trim(), interrupted: !ok || undefined });
		if (t.kind === 'talk') this.emit({ type: 'done', turn: id, ok, ...(error ? { error } : {}) });
		t.resolve(t);
		this.turns.delete(id);
	}

	private write(message: object) {
		if (!this.closed) this.proc?.stdin.write(`${JSON.stringify(message)}\n`);
	}

	/** Stop the answer in progress, if there is one. */
	interrupt() {
		if (this.queue.length)
			this.write({
				type: 'control_request',
				request_id: randomUUID(),
				request: { subtype: 'interrupt' }
			});
	}

	private ask(kind: Turn['kind'], text: string): { turn: string; done: Promise<Turn> } {
		const id = randomUUID();
		let resolve!: (t: Turn) => void;
		const done = new Promise<Turn>((r) => (resolve = r));
		this.turns.set(id, { id, kind, text: '', done: false, ok: false, resolve });
		this.queue.push(id);
		this.write({ type: 'user', message: { role: 'user', content: text } });
		if (this.closed) this.finish(id, false);
		return { turn: id, done };
	}

	/** The captain said something: the newest words win over an answer in progress. */
	say(text: string): string {
		this.interrupt();
		this.transcript.push({ who: 'captain', text });
		return this.ask('talk', text).turn;
	}

	/** The Captain's briefing from the conversation, or null when nothing was said or it took too long. */
	async brief(timeoutMs = 90_000): Promise<string | null> {
		if (!this.transcript.some((t) => t.who === 'captain') || this.closed) return null;
		this.interrupt();
		const { done } = this.ask('brief', BRIEFING_PROMPT);
		const t = await Promise.race([
			done,
			new Promise<null>((r) => setTimeout(() => r(null), timeoutMs))
		]);
		return t?.ok && t.text.trim() ? t.text.trim() : null;
	}

	stop() {
		const dir = this.dir;
		this.dir = null;
		if (dir)
			setTimeout(
				() => void rm(dir, { recursive: true, force: true }).catch(() => {}),
				2000
			).unref?.();
		try {
			this.proc?.stdin.end();
		} catch {
			// already closed
		}
		const proc = this.proc;
		setTimeout(() => proc?.kill('SIGTERM'), 500).unref?.();
	}
}
