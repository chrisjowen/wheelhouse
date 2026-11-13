import { open, realpath } from 'node:fs/promises';
import path from 'node:path';
import type { FirstmateSessionView, TranscriptSource } from '../../types';
import type { TranscriptRecord } from './transcript';
import { shellLine } from './tmux';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RECEIPT_BYTES = 64 * 1024;
const META_BYTES = 1024 * 1024;

function object(value: unknown): Record<string, unknown> | null {
	return value !== null && typeof value === 'object' && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: null;
}

async function readJson(file: string, limit: number, firstLine = false): Promise<unknown> {
	const handle = await open(file, 'r');
	try {
		const size = (await handle.stat()).size;
		if (!firstLine && size > limit) return null;
		const buffer = Buffer.alloc(Math.min(size, limit));
		const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
		const text = buffer.subarray(0, bytesRead).toString('utf8');
		const newline = text.indexOf('\n');
		if (firstLine && newline < 0) return null;
		return JSON.parse(firstLine ? text.slice(0, newline) : text);
	} finally {
		await handle.close();
	}
}

/** Bind only the owned TUI's exact SessionStart receipt, never a newest-session guess. */
export async function locateCodexTranscript(
	opts: {
		firstmateDir: string;
		hookFile: string;
		codexHome: string;
		sessionNonce: string | null;
	},
	state: FirstmateSessionView['state']
): Promise<Omit<TranscriptSource, 'truncated'> | null> {
	if (state !== 'ours' || !opts.sessionNonce?.trim()) return null;
	try {
		const receipt = object(await readJson(opts.hookFile, RECEIPT_BYTES));
		if (
			!receipt ||
			receipt.wheelhouse_nonce !== opts.sessionNonce ||
			typeof receipt.session_id !== 'string' ||
			!UUID.test(receipt.session_id) ||
			typeof receipt.transcript_path !== 'string' ||
			!path.isAbsolute(receipt.transcript_path) ||
			typeof receipt.cwd !== 'string' ||
			!path.isAbsolute(receipt.cwd)
		)
			return null;
		const [cwd, receiptCwd, root, file] = await Promise.all([
			realpath(opts.firstmateDir),
			realpath(receipt.cwd),
			realpath(path.join(opts.codexHome, 'sessions')),
			realpath(receipt.transcript_path)
		]);
		const relative = path.relative(root, file);
		if (cwd !== receiptCwd || !relative || relative.startsWith('..') || path.isAbsolute(relative))
			return null;
		const record = object(await readJson(file, META_BYTES, true));
		const meta = object(record?.payload);
		if (
			record?.type !== 'session_meta' ||
			!meta ||
			meta.id !== receipt.session_id ||
			meta.originator !== 'codex-tui' ||
			(meta.source !== 'cli' && meta.source !== 'vscode') ||
			typeof meta.cwd !== 'string' ||
			!path.isAbsolute(meta.cwd) ||
			(await realpath(meta.cwd)) !== cwd
		)
			return null;
		return { how: 'hook', file };
	} catch {
		return null;
	}
}

/** The canonical UserMessage and AgentMessage variants use different text tag casing. */
function textContent(value: unknown): string {
	if (!Array.isArray(value)) return '';
	return value
		.flatMap((part) => {
			const block = object(part);
			if (!block) return [];
			if ((block.type === 'text' || block.type === 'Text') && typeof block.text === 'string')
				return [block.text];
			if (block.type === 'image' || block.type === 'localImage') return ['[image]'];
			return [];
		})
		.join('\n');
}

function mcpResult(value: unknown): string | { type: 'text'; text: string }[] {
	if (typeof value === 'string') return value;
	const result = object(value);
	if (!result) return '';
	if (Array.isArray(result.content)) {
		return result.content.flatMap((part) => {
			const block = object(part);
			return block?.type === 'text' && typeof block.text === 'string'
				? [{ type: 'text' as const, text: block.text }]
				: [];
		});
	}
	return typeof result.message === 'string' ? result.message : '';
}

/**
 * Translate native completed items, not duplicated wire messages or injected context.
 * shortcut: canonical item events verified on Codex 0.167; older rollouts need a separately deduplicated reader.
 * The feed deduplicates stable UUIDs when a tool appears in both started and completed events.
 */
export function codexRecords(raw: unknown): TranscriptRecord[] {
	const record = object(raw);
	const payload = object(record?.payload);
	if (
		record?.type !== 'event_msg' ||
		!payload ||
		typeof record.timestamp !== 'string' ||
		!Number.isFinite(Date.parse(record.timestamp))
	)
		return [];
	const timestamp = record.timestamp;
	const turnId = typeof payload.turn_id === 'string' ? payload.turn_id : null;
	if (payload.type === 'task_complete' && turnId) {
		return [
			{
				type: 'system',
				uuid: `codex:${turnId}:completed`,
				timestamp,
				subtype: 'turn_duration',
				durationMs:
					typeof payload.duration_ms === 'number' && Number.isFinite(payload.duration_ms)
						? Math.max(0, payload.duration_ms)
						: null
			}
		];
	}
	if (payload.type === 'turn_aborted' && turnId) {
		return [
			{
				type: 'user',
				uuid: `codex:${turnId}:interrupted`,
				timestamp,
				message: { role: 'user', content: '[Request interrupted by user]' }
			}
		];
	}
	if (payload.type !== 'item_started' && payload.type !== 'item_completed') return [];
	const completed = payload.type === 'item_completed';
	const item = object(payload.item);
	if (!item || typeof item.id !== 'string' || !item.id || typeof item.type !== 'string') return [];
	const id = `codex:${item.id}`;
	const assistant = (suffix: string, content: unknown[]): TranscriptRecord => ({
		type: 'assistant',
		uuid: `${id}:${suffix}`,
		timestamp,
		message: { id, role: 'assistant', content }
	});
	if (item.type === 'UserMessage' || item.type === 'AgentMessage') {
		if (!completed) return [];
		const text = textContent(item.content);
		if (!text.trim()) return [];
		return item.type === 'UserMessage'
			? [{ type: 'user', uuid: `${id}:user`, timestamp, message: { role: 'user', content: text } }]
			: [assistant('text', [{ type: 'text', text }])];
	}
	if (item.type === 'Reasoning') {
		return completed
			? [assistant('thinking', [{ type: 'thinking', thinking: '', signature: '' }])]
			: [];
	}
	let name: string;
	let input: Record<string, unknown>;
	let result: string | { type: 'text'; text: string }[] = '';
	let isError = item.status === 'failed' || item.status === 'declined';
	switch (item.type) {
		case 'CommandExecution':
			if (
				typeof item.command !== 'string' &&
				!(Array.isArray(item.command) && item.command.every((part) => typeof part === 'string'))
			)
				return [];
			name = 'Bash';
			input = {
				command: typeof item.command === 'string' ? item.command : shellLine(item.command)
			};
			result = typeof item.aggregated_output === 'string' ? item.aggregated_output : '';
			isError ||= typeof item.exit_code === 'number' && item.exit_code !== 0;
			break;
		case 'McpToolCall': {
			if (typeof item.server !== 'string' || typeof item.tool !== 'string') return [];
			name = `mcp__${item.server}__${item.tool}`;
			input = object(item.arguments) ?? {};
			result = mcpResult(item.result ?? item.error);
			isError ||= object(item.result)?.isError === true || item.error != null;
			break;
		}
		case 'FileChange': {
			const changes = object(item.changes);
			if (!changes || !Object.keys(changes).length) return [];
			name = 'Edit';
			input = { file_path: Object.keys(changes).join(', ') };
			result = [item.stdout, item.stderr]
				.filter((value): value is string => typeof value === 'string')
				.join('\n');
			break;
		}
		default:
			return [];
	}
	const start = assistant('call', [{ type: 'tool_use', id, name, input }]);
	return completed
		? [
				start,
				{
					type: 'user',
					uuid: `${id}:result`,
					timestamp,
					message: {
						role: 'user',
						content: [{ type: 'tool_result', tool_use_id: id, content: result, is_error: isError }]
					}
				}
			]
		: [start];
}
