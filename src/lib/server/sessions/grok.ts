import { open, readdir, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import type { FirstmateSessionView, TranscriptSource } from '../../types';
import type { CodexScreen } from './codex-screen';
import type { TranscriptRecord } from './transcript';

/**
 * Grok (xAI's `grok` TUI) as the Firstmate primary: how it is started, which
 * conversation the chat follows, how its records read as the shared chat
 * format, and what its screen says. Checked against Grok 1.0.77.
 *
 * Grok's interactive TUI takes no hook or extension for one launch, so there is
 * no recorder as for Codex and Pi. Wheelhouse chooses the conversation's id
 * itself (`--session-id`) and keeps it in the session's environment, which names
 * the conversation exactly. Grok appends every conversation to
 * `<grok home>/sessions/<working directory>/<id>/updates.jsonl`, one session
 * update on a line, each with an event id that never changes.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const REGISTRY_BYTES = 1024 * 1024;
const SUMMARY_BYTES = 1024 * 1024;

/** The session variable that keeps the conversation id Grok was started with. */
export const GROK_SESSION_VARIABLE = 'WH_GROK_SESSION';

export const isGrokSessionId = (value: string | null | undefined): value is string =>
	typeof value === 'string' && UUID.test(value);

/**
 * argv for the Firstmate session's `grok`: Firstmate's own launch (`grok --trust`,
 * which loads its project hooks) with the conversation id Wheelhouse chose.
 */
export const grokArgv = (binary: string, sessionId: string): string[] => [
	binary,
	'--trust',
	'--session-id',
	sessionId
];

function object(value: unknown): Record<string, unknown> | null {
	return value !== null && typeof value === 'object' && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: null;
}

async function readJson(file: string, limit: number): Promise<unknown> {
	const handle = await open(file, 'r');
	try {
		const size = (await handle.stat()).size;
		if (size > limit) return null;
		const buffer = Buffer.alloc(size);
		const { bytesRead } = await handle.read(buffer, 0, size, 0);
		return JSON.parse(buffer.subarray(0, bytesRead).toString('utf8'));
	} finally {
		await handle.close();
	}
}

export interface GrokLocateOptions {
	firstmateDir: string;
	/** Grok's own folder (`$GROK_HOME`, else `~/.grok`). */
	grokHome: string;
	/** The conversation id the session was started with. */
	sessionId: string | null;
}

interface OpenSession {
	id: string;
	openedAt: number;
}

/**
 * The conversations open in the Grok process Wheelhouse started: `/new` and
 * `/clear` open another in the same process, and Grok lists each beside the
 * process that holds it. Only the launch conversation when Grok does not list it.
 */
async function processSessions(grokHome: string, launchId: string): Promise<OpenSession[]> {
	const launch = [{ id: launchId, openedAt: 0 }];
	let listed: unknown;
	try {
		listed = await readJson(path.join(grokHome, 'active_sessions.json'), REGISTRY_BYTES);
	} catch {
		return launch;
	}
	if (!Array.isArray(listed)) return launch;
	const rows = listed.flatMap((value) => {
		const row = object(value);
		return row &&
			isGrokSessionId(row.session_id as string) &&
			typeof row.pid === 'number' &&
			typeof row.pid_start === 'number'
			? [row]
			: [];
	});
	const own = rows.find((row) => row.session_id === launchId);
	if (!own) return launch;
	return rows
		.filter((row) => row.pid === own.pid && row.pid_start === own.pid_start)
		.map((row) => ({
			id: row.session_id as string,
			openedAt: (typeof row.opened_at === 'string' && Date.parse(row.opened_at)) || 0
		}));
}

/** Where each conversation's folder was found: Grok never moves one. */
const folders = new Map<string, string>();

/**
 * A conversation's folder, when its own summary names this id and Firstmate's
 * checkout. Grok names the folder above it after the working directory; that
 * name is read from the disk, never rebuilt here.
 */
async function sessionFolder(grokHome: string, id: string, cwd: string): Promise<string | null> {
	const root = path.join(grokHome, 'sessions');
	const key = `${root}\0${id}`;
	let folder = folders.get(key) ?? null;
	if (!folder) {
		for (const group of await readdir(root)) {
			const candidate = path.join(root, group, id);
			const found = await stat(path.join(candidate, 'summary.json')).then(
				(s) => s.isFile(),
				() => false
			);
			if (found) {
				folder = candidate;
				break;
			}
		}
	}
	if (!folder) return null;
	const summary = object(await readJson(path.join(folder, 'summary.json'), SUMMARY_BYTES));
	const info = object(summary?.info);
	if (
		info?.id !== id ||
		typeof info.cwd !== 'string' ||
		!path.isAbsolute(info.cwd) ||
		(await realpath(info.cwd)) !== cwd
	)
		return null;
	folders.set(key, folder);
	return folder;
}

/**
 * The conversation the chat follows: the one Wheelhouse started Grok with, or
 * another the same Grok process opened since, whichever was opened or written
 * last. Never a conversation of any other process.
 */
export async function locateGrokTranscript(
	opts: GrokLocateOptions,
	state: FirstmateSessionView['state']
): Promise<Omit<TranscriptSource, 'truncated'> | null> {
	const launchId = opts.sessionId;
	if (state !== 'ours' || !isGrokSessionId(launchId)) return null;
	try {
		const cwd = await realpath(opts.firstmateDir);
		let best: { file: string; at: number } | null = null;
		for (const session of await processSessions(opts.grokHome, launchId)) {
			const folder = await sessionFolder(opts.grokHome, session.id, cwd).catch(() => null);
			if (!folder) continue;
			const file = path.join(folder, 'updates.jsonl');
			const written = await stat(file).then(
				(s) => s.mtimeMs,
				() => 0
			);
			const at = Math.max(session.openedAt, written);
			if (!best || at > best.at) best = { file, at };
		}
		return best ? { how: 'launch', file: best.file } : null;
	} catch {
		return null;
	}
}

/** Grok's tools under the names the chat already describes; the rest keep their own. */
const TOOL_NAMES: Record<string, string> = {
	run_terminal_command: 'Bash',
	read_file: 'Read',
	search_replace: 'Edit',
	write: 'Write',
	grep: 'Grep',
	list_dir: 'Glob',
	web_fetch: 'WebFetch',
	search_tool: 'ToolSearch',
	spawn_subagent: 'Task',
	todo_write: 'TodoWrite'
};

function toolUse(update: Record<string, unknown>): {
	name: string;
	input: Record<string, unknown>;
} {
	const raw = object(update.rawInput) ?? {};
	const tool = object(object(update._meta)?.['x.ai/tool']);
	const native = typeof tool?.name === 'string' ? tool.name : String(update.title ?? '');
	if (native === 'use_tool' && typeof raw.tool_name === 'string') {
		// Grok names an MCP tool `<server>__<tool>`.
		const at = raw.tool_name.indexOf('__');
		if (at > 0)
			return {
				name: `mcp__${raw.tool_name.slice(0, at)}__${raw.tool_name.slice(at + 2)}`,
				input: object(raw.tool_input) ?? {}
			};
	}
	if (raw.variant === 'WebSearch') return { name: 'WebSearch', input: raw };
	const input = { ...raw };
	if (typeof raw.target_file === 'string') input.file_path = raw.target_file;
	if (typeof raw.target_directory === 'string') input.pattern = raw.target_directory;
	return { name: TOOL_NAMES[native] ?? native, input };
}

/** Where a tool's output says what happened, most readable first. */
const OUTPUT_TEXT = ['tool_output_for_prompt', 'output_for_prompt', 'message', 'text', 'Error'];

function outputText(value: unknown, depth = 0): string {
	if (typeof value === 'string') return value;
	const output = object(value);
	if (!output || depth > 2) return '';
	for (const key of OUTPUT_TEXT) if (typeof output[key] === 'string') return output[key];
	// An MCP tool's own answer sits under `output`.
	const nested = outputText(output.output, depth + 1);
	if (nested) return nested;
	// A failure is one named reason beside the type: { type: "ListDir", NotFound: "…" }.
	const rest = Object.entries(output).filter(([key]) => key !== 'type');
	return rest.length === 1 ? outputText(rest[0][1], depth + 1) : '';
}

function resultText(update: Record<string, unknown>): string {
	const shown = (Array.isArray(update.content) ? update.content : []).flatMap((part) => {
		const content = object(object(part)?.content);
		if (content?.type === 'text' && typeof content.text === 'string') return [content.text];
		return content?.type === 'image' ? ['[image]'] : [];
	});
	return shown.length ? shown.join('\n') : outputText(update.rawOutput);
}

/**
 * One line of `updates.jsonl` as chat records. Grok keeps a whole message,
 * thought or tool update on a line, so nothing is joined across lines. Its own
 * bookkeeping (hooks, plans, background tasks, compaction) and the prompts it
 * hides from its own scrollback are not conversation.
 */
export function grokRecords(raw: unknown): TranscriptRecord[] {
	const line = object(raw);
	const params = object(line?.params);
	const update = object(params?.update);
	const meta = object(params?._meta);
	if (!line || !update || typeof meta?.eventId !== 'string' || !meta.eventId) return [];
	const ms =
		typeof meta.agentTimestampMs === 'number'
			? meta.agentTimestampMs
			: typeof line.timestamp === 'number'
				? line.timestamp * 1000
				: NaN;
	if (!Number.isFinite(ms) || Math.abs(ms) > 8.64e15) return [];
	const timestamp = new Date(ms).toISOString();
	const uuid = `grok:${meta.eventId}`;
	const text = () => {
		const content = object(update.content);
		return content?.type === 'text' && typeof content.text === 'string' ? content.text : '';
	};
	const assistant = (content: unknown[]): TranscriptRecord => ({
		type: 'assistant',
		uuid,
		timestamp,
		message: { id: uuid, role: 'assistant', content }
	});
	switch (update.sessionUpdate) {
		case 'user_message_chunk': {
			const hidden = object(update._meta);
			if (hidden?.hideFromScrollback === true || hidden?.syntheticPrompt === true) return [];
			const content = text();
			return content.trim()
				? [{ type: 'user', uuid, timestamp, message: { role: 'user', content } }]
				: [];
		}
		case 'agent_message_chunk': {
			const content = text();
			return content.trim() ? [assistant([{ type: 'text', text: content }])] : [];
		}
		case 'agent_thought_chunk':
			return [assistant([{ type: 'thinking', thinking: '', signature: '' }])];
		case 'tool_call': {
			if (typeof update.toolCallId !== 'string' || !update.toolCallId) return [];
			return [
				assistant([{ type: 'tool_use', id: `grok:${update.toolCallId}`, ...toolUse(update) }])
			];
		}
		case 'tool_call_update': {
			// An update without a final status only adds detail to the call already shown.
			if (
				typeof update.toolCallId !== 'string' ||
				(update.status !== 'completed' && update.status !== 'failed')
			)
				return [];
			const output = object(update.rawOutput);
			return [
				{
					type: 'user',
					uuid,
					timestamp,
					message: {
						role: 'user',
						content: [
							{
								type: 'tool_result',
								tool_use_id: `grok:${update.toolCallId}`,
								content: resultText(update),
								is_error:
									update.status === 'failed' ||
									output?.is_error === true ||
									(typeof output?.exit_code === 'number' && output.exit_code !== 0)
							}
						]
					}
				}
			];
		}
		case 'turn_completed': {
			const records: TranscriptRecord[] = [];
			if (update.stop_reason === 'error' && typeof update.agent_result === 'string')
				records.push(assistant([{ type: 'text', text: update.agent_result }]));
			if (update.stop_reason === 'cancelled' || update.stop_reason === 'interrupted')
				records.push({
					type: 'user',
					uuid: `${uuid}:interrupted`,
					timestamp,
					message: { role: 'user', content: '[Request interrupted by user]' }
				});
			records.push({
				type: 'system',
				subtype: 'turn_duration',
				uuid: `${uuid}:done`,
				timestamp,
				durationMs:
					typeof update.elapsed_ms === 'number' && Number.isFinite(update.elapsed_ms)
						? Math.max(0, update.elapsed_ms)
						: null
			});
			return records;
		}
		default:
			return [];
	}
}

const TOP = /^\s*╭─{12,}.*─╮\s*$/;
const BOTTOM = /^\s*╰─{12,}.*─╯\s*$/;
const ROW = /^\s*│\s(.*)│\s*$/;
/** What Grok draws in an empty composer, as Firstmate's own composer check lists it. */
const PLACEHOLDER = /^Type a message\.\.\.$/;
/** The tallest composer read; a longer draft is left to the terminal like any unknown screen. */
const COMPOSER_ROWS = 12;

/**
 * Only Grok's own conversation composer may receive input: the box that ends the
 * screen, with the mode and shortcut hints under it. Its dashboard draws the same
 * box to start another agent, and a typed line would start one, so anything that
 * offers Enter (a command list, the dashboard) is left to the terminal, as is
 * text already typed there.
 */
export function grokScreen(text: string | null): CodexScreen {
	const blocked = { kind: 'blocked', title: 'Grok needs attention in its terminal.' } as const;
	if (text === null) return blocked;
	const lines = text.replace(/\r/g, '').trimEnd().split('\n');
	const bottom = lines.findLastIndex((line) => BOTTOM.test(line));
	if (bottom < 2 || bottom < lines.length - 4 || bottom >= lines.length - 1) return blocked;
	const hints = lines
		.slice(bottom + 1)
		.join('\n')
		.split(/[│\n]/)
		.map((hint) => hint.trim())
		.filter(Boolean);
	if (!hints.includes('Shift+Tab:mode') || !hints.includes('Ctrl+x:shortcuts')) return blocked;
	let top = bottom - 1;
	while (top >= Math.max(0, bottom - COMPOSER_ROWS) && ROW.test(lines[top])) top--;
	const rows = lines.slice(top + 1, bottom).map((line) => ROW.exec(line)![1].trim());
	if (top < 0 || !TOP.test(lines[top]) || !rows.length || !rows[0].startsWith('❯')) return blocked;
	const typed = [rows[0].slice(1).trim(), ...rows.slice(1)].join('\n').trim();
	if (typed && !PLACEHOLDER.test(typed))
		return {
			kind: 'blocked',
			title: 'Grok has unsent input. Send or clear it in the terminal first.'
		};
	if (hints.some((hint) => /^(?:Enter|Tab|Esc):/i.test(hint))) return blocked;
	return { kind: 'prompt', busy: hints.includes('Ctrl+c:cancel') };
}
