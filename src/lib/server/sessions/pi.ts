import { open, realpath } from 'node:fs/promises';
import path from 'node:path';
import type { TranscriptSource } from '../../types';
import type { CodexScreen } from './codex-screen';
import type { TranscriptRecord } from './transcript';

const RECEIPT_BYTES = 64 * 1024;
const SESSION_BYTES = 32 * 1024 * 1024;
const MAX_RECORDS = 6000;

/** Native Pi extension; it adds an observer without replacing any project extensions. */
export function piExtensionSource(): string {
	return `import { mkdirSync, writeFileSync, renameSync } from 'node:fs';
import path from 'node:path';
export default function(pi) {
 const file = process.env.WH_SESSION_RECORD;
 const nonce = process.env.WH_SESSION_NONCE;
 if (!file || !nonce) return;
 let context = null, timer = null, previous = '';
 const save = () => {
  if (!context) return;
  try {
   const manager = context.sessionManager;
   const value = JSON.stringify({ wheelhouse_nonce: nonce, session_id: manager.getSessionId(), transcript_path: manager.getSessionFile() ?? null, cwd: context.cwd, leaf_id: manager.getLeafId(), busy: !context.isIdle() });
   if (value === previous || Buffer.byteLength(value) > 65536) return;
   mkdirSync(path.dirname(file), { recursive: true });
   const temp = file + '.tmp.' + process.pid;
   writeFileSync(temp, value, { mode: 0o600 });
   renameSync(temp, file);
   previous = value;
  } catch { /* Observation must not interrupt Pi's session. */ }
 };
 pi.on('session_start', (_event, ctx) => {
  context = ctx;
  save();
  if (timer) clearInterval(timer);
  // message_end fires before persistence; observe the manager after it has appended the entry.
  timer = setInterval(save, 250);
  timer.unref?.();
 });
 for (const event of ['session_tree', 'session_compact', 'agent_end']) {
  pi.on(event, (_event, ctx) => { context = ctx; save(); });
 }
 pi.on('session_shutdown', () => { context = null; if (timer) clearInterval(timer); timer = null; });
}
`;
}

function object(value: unknown): Record<string, unknown> | null {
	return value !== null && typeof value === 'object' && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: null;
}

async function readBounded(file: string, limit: number): Promise<string | null> {
	const handle = await open(file, 'r');
	try {
		const size = (await handle.stat()).size;
		if (size > limit) return null;
		const buffer = Buffer.alloc(size);
		let offset = 0;
		while (offset < size) {
			const { bytesRead } = await handle.read(buffer, offset, size - offset, offset);
			if (!bytesRead) break;
			offset += bytesRead;
		}
		return buffer.subarray(0, offset).toString('utf8');
	} finally {
		await handle.close();
	}
}

function contentText(content: unknown): string {
	if (typeof content === 'string') return content;
	if (!Array.isArray(content)) return '';
	return content
		.flatMap((part) => {
			const block = object(part);
			if (block?.type === 'text' && typeof block.text === 'string') return [block.text];
			return block?.type === 'image' ? ['[image]'] : [];
		})
		.join('\n');
}

function normalize(entry: Record<string, unknown>, sessionId: string): TranscriptRecord[] {
	if (
		entry.type !== 'message' ||
		typeof entry.id !== 'string' ||
		typeof entry.timestamp !== 'string'
	)
		return [];
	const message = object(entry.message);
	if (!message || !Number.isFinite(Date.parse(entry.timestamp))) return [];
	const uuid = `pi:${sessionId}:${entry.id}`;
	const timestamp = entry.timestamp;
	if (message.role === 'user') {
		const content = contentText(message.content);
		return content.trim()
			? [{ type: 'user', uuid, timestamp, message: { role: 'user', content } }]
			: [];
	}
	if (message.role === 'toolResult' && typeof message.toolCallId === 'string') {
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
							tool_use_id: `pi:${sessionId}:${message.toolCallId}`,
							content: contentText(message.content),
							is_error: message.isError === true
						}
					]
				}
			}
		];
	}
	// System prompt checkpoints and extension-injected context are not captain messages.
	if (message.role !== 'assistant' || !Array.isArray(message.content)) return [];
	const names: Record<string, string> = {
		bash: 'Bash',
		read: 'Read',
		edit: 'Edit',
		write: 'Write',
		grep: 'Grep',
		find: 'Glob',
		ls: 'Glob'
	};
	const content = message.content.flatMap<Record<string, unknown>>((part) => {
		const block = object(part);
		if (!block) return [];
		if (block.type === 'text' && typeof block.text === 'string')
			return [{ type: 'text', text: block.text }];
		if (block.type === 'thinking') return [{ type: 'thinking', thinking: '', signature: '' }];
		if (block.type !== 'toolCall' || typeof block.id !== 'string' || typeof block.name !== 'string')
			return [];
		const input = object(block.arguments);
		if (!input) return [];
		return [
			{
				type: 'tool_use',
				id: `pi:${sessionId}:${block.id}`,
				name: names[block.name] ?? block.name,
				input: { ...input, ...(typeof input.path === 'string' ? { file_path: input.path } : {}) }
			}
		];
	});
	if (message.stopReason === 'error' && typeof message.errorMessage === 'string')
		content.push({ type: 'text', text: message.errorMessage });
	const records: TranscriptRecord[] = content.length
		? [{ type: 'assistant', uuid, timestamp, message: { id: uuid, role: 'assistant', content } }]
		: [];
	if (message.stopReason === 'aborted')
		records.push({
			type: 'user',
			uuid: `${uuid}:interrupted`,
			timestamp,
			message: { role: 'user', content: '[Request interrupted by user]' }
		});
	if (['stop', 'length', 'error', 'aborted'].includes(String(message.stopReason)))
		records.push({
			type: 'system',
			subtype: 'turn_duration',
			uuid: `${uuid}:done`,
			timestamp,
			durationMs: null
		});
	return records;
}

/** Follow the exact leaf reported by Pi, including navigation that appends no new entry. */
export async function piSnapshot(opts: {
	firstmateDir: string;
	hookFile: string;
	sessionNonce: string | null;
	agentDir: string;
}): Promise<{ source: TranscriptSource; records: TranscriptRecord[] } | null> {
	if (!opts.sessionNonce?.trim()) return null;
	try {
		const receiptText = await readBounded(opts.hookFile, RECEIPT_BYTES);
		const receipt = receiptText === null ? null : object(JSON.parse(receiptText));
		if (
			!receipt ||
			receipt.wheelhouse_nonce !== opts.sessionNonce ||
			typeof receipt.session_id !== 'string' ||
			!receipt.session_id ||
			typeof receipt.transcript_path !== 'string' ||
			!path.isAbsolute(receipt.transcript_path) ||
			typeof receipt.cwd !== 'string' ||
			!path.isAbsolute(receipt.cwd) ||
			!(receipt.leaf_id === null || typeof receipt.leaf_id === 'string')
		)
			return null;
		const sessionId = receipt.session_id;
		const [cwd, receiptCwd, root, file] = await Promise.all([
			realpath(opts.firstmateDir),
			realpath(receipt.cwd),
			realpath(path.join(opts.agentDir, 'sessions')),
			realpath(receipt.transcript_path)
		]);
		const relative = path.relative(root, file);
		if (cwd !== receiptCwd || !relative || relative.startsWith('..') || path.isAbsolute(relative))
			return null;
		const text = await readBounded(file, SESSION_BYTES);
		if (text === null) return null;
		const lines = text.split('\n');
		lines.pop(); // Pi may still be appending the last line.
		const header = object(JSON.parse(lines.shift() ?? 'null'));
		if (
			!header ||
			header.type !== 'session' ||
			header.version !== 3 ||
			header.id !== receipt.session_id ||
			typeof header.cwd !== 'string' ||
			(await realpath(header.cwd)) !== cwd
		)
			return null;
		const entries = new Map<string, Record<string, unknown>>();
		for (const line of lines) {
			if (!line.trim()) continue;
			const entry = object(JSON.parse(line));
			if (
				!entry ||
				typeof entry.id !== 'string' ||
				!(entry.parentId === null || typeof entry.parentId === 'string') ||
				entries.has(entry.id)
			)
				return null;
			entries.set(entry.id, entry);
		}
		const branch: Record<string, unknown>[] = [];
		const seen = new Set<string>();
		let leaf = receipt.leaf_id;
		while (leaf !== null) {
			if (seen.has(leaf)) return null;
			seen.add(leaf);
			const entry = entries.get(leaf);
			if (!entry) return null;
			branch.push(entry);
			leaf = typeof entry.parentId === 'string' ? entry.parentId : null;
		}
		const records = branch.reverse().flatMap((entry) => normalize(entry, sessionId));
		return {
			source: { how: 'hook', file, truncated: records.length > MAX_RECORDS },
			records: records.slice(-MAX_RECORDS)
		};
	} catch {
		return null;
	}
}

/** Known empty Pi editors are separated by two rules immediately above the path/model footer. */
export function piScreen(text: string | null): CodexScreen {
	const blocked = { kind: 'blocked', title: 'Pi needs attention in its terminal.' } as const;
	if (text === null) return blocked;
	const lines = text.replace(/\r/g, '').trimEnd().split('\n');
	const rule = /^\s*─{12,}\s*$/;
	const bottom = lines.findLastIndex((line) => rule.test(line));
	if (bottom < 2 || bottom < lines.length - 5 || bottom >= lines.length - 1) return blocked;
	const footer = lines.slice(bottom + 1);
	if (
		!/^\s*(?:\/|~(?:\/|$))/.test(footer[0]) ||
		footer.some((line) => /\b(?:select|confirm|cancel)\b/i.test(line))
	)
		return blocked;
	let top = bottom - 1;
	while (
		top >= Math.max(0, bottom - 12) &&
		!rule.test(lines[top]) &&
		!/^── .*\bWorking\b.*─{8,}\s*$/.test(lines[top])
	)
		top--;
	if (top < 0 || top < bottom - 12) return blocked;
	if (lines.slice(top + 1, bottom).some((line) => line.trim()))
		return {
			kind: 'blocked',
			title: 'Pi has unsent input or a dialog. Send or clear it in the terminal first.'
		};
	return { kind: 'prompt', busy: /\bWorking\b/.test(lines[top]) };
}
