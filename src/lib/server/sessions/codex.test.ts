import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fold } from '../../chat/fold';
import { codexRecords, locateCodexTranscript } from './codex';

const SESSION = '11111111-1111-7111-8111-111111111111';
const AT = '2026-11-12T10:00:00.000Z';
const event = (payload: Record<string, unknown>) => ({ timestamp: AT, type: 'event_msg', payload });
const item = (value: Record<string, unknown>, type = 'item_completed') =>
	event({ type, item: value });
const command = {
	type: 'CommandExecution',
	id: 'command-1',
	command: ['git', 'status'],
	status: 'completed',
	aggregated_output: 'clean',
	exit_code: 0
};
// The production feed deduplicates these stable IDs when started and completed events overlap.
const decoded = (events: unknown[]) => [
	...new Map(events.flatMap(codexRecords).map((r) => [r.uuid, r])).values()
];

let root: string;
let opts: {
	firstmateDir: string;
	hookFile: string;
	codexHome: string;
	sessionNonce: string | null;
};
let rollout: string;
let meta: Record<string, unknown>;
let receipt: Record<string, unknown>;
const save = () => {
	writeFileSync(rollout, JSON.stringify({ type: 'session_meta', payload: meta }) + '\n');
	writeFileSync(opts.hookFile, JSON.stringify(receipt));
};

beforeEach(() => {
	root = realpathSync(mkdtempSync(path.join(tmpdir(), 'wh-codex-')));
	opts = {
		firstmateDir: path.join(root, 'firstmate'),
		hookFile: path.join(root, 'hook.json'),
		codexHome: path.join(root, 'codex'),
		sessionNonce: 'current-primary-nonce'
	};
	mkdirSync(opts.firstmateDir);
	mkdirSync(path.join(opts.codexHome, 'sessions', '2026'), { recursive: true });
	rollout = path.join(opts.codexHome, 'sessions', '2026', 'rollout.jsonl');
	meta = { id: SESSION, cwd: opts.firstmateDir, originator: 'codex-tui', source: 'vscode' };
	receipt = {
		session_id: SESSION,
		cwd: opts.firstmateDir,
		transcript_path: rollout,
		wheelhouse_nonce: opts.sessionNonce
	};
	save();
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe('locateCodexTranscript', () => {
	it.each([null, '', ' '])(
		'requires a nonce from the owned tmux session: %j',
		async (sessionNonce) => {
			opts.sessionNonce = sessionNonce;
			expect(await locateCodexTranscript(opts, 'ours')).toBeNull();
		}
	);
	it.each([undefined, null, '', 'previous-primary-nonce'])(
		'rejects a missing or stale receipt nonce: %j',
		async (nonce) => {
			receipt.wheelhouse_nonce = nonce;
			save();
			expect(await locateCodexTranscript(opts, 'ours')).toBeNull();
		}
	);
	it.each(['cli', 'vscode'])(
		'binds the owned %s TUI from its receipt and first metadata record',
		async (source) => {
			meta.source = source;
			save();
			expect(await locateCodexTranscript(opts, 'ours')).toEqual({ how: 'hook', file: rollout });
		}
	);
	it.each(['external', 'starting', 'none', 'unavailable'] as const)(
		'never guesses a transcript for %s sessions',
		async (state) => {
			expect(await locateCodexTranscript(opts, state)).toBeNull();
		}
	);
	it('does not choose another file when the recorded UUID does not match', async () => {
		meta.id = '22222222-2222-7222-8222-222222222222';
		save();
		expect(await locateCodexTranscript(opts, 'ours')).toBeNull();
	});
	it.each(['receipt', 'metadata'])('rejects another working directory in the %s', async (where) => {
		const other = path.join(root, 'other');
		mkdirSync(other);
		if (where === 'receipt') receipt.cwd = other;
		else meta.cwd = other;
		save();
		expect(await locateCodexTranscript(opts, 'ours')).toBeNull();
	});
	it('accepts a symlinked checkout only when both paths resolve to the same directory', async () => {
		const alias = path.join(root, 'alias');
		symlinkSync(opts.firstmateDir, alias);
		receipt.cwd = alias;
		save();
		expect(await locateCodexTranscript(opts, 'ours')).not.toBeNull();
	});
	it('rejects a symlink to a transcript outside the allowed sessions directory', async () => {
		const outside = path.join(root, 'outside.jsonl');
		writeFileSync(outside, JSON.stringify({ type: 'session_meta', payload: meta }) + '\n');
		const link = path.join(opts.codexHome, 'sessions', 'escape.jsonl');
		symlinkSync(outside, link);
		receipt.transcript_path = link;
		writeFileSync(opts.hookFile, JSON.stringify(receipt));
		expect(await locateCodexTranscript(opts, 'ours')).toBeNull();
	});
	it.each(['exec', { subagent: { thread_spawn: { parent_thread_id: SESSION } } }])(
		'rejects non-root TUI source %j',
		async (source) => {
			meta.source = source;
			save();
			expect(await locateCodexTranscript(opts, 'ours')).toBeNull();
		}
	);
	it('rejects another originator', async () => {
		meta.originator = 'codex_work_desktop';
		save();
		expect(await locateCodexTranscript(opts, 'ours')).toBeNull();
	});
	it.each([null, {}, { cwd: '.', session_id: SESSION, transcript_path: '/tmp/x' }])(
		'rejects malformed receipts %j',
		async (bad) => {
			writeFileSync(opts.hookFile, JSON.stringify(bad));
			expect(await locateCodexTranscript(opts, 'ours')).toBeNull();
		}
	);
	it('bounds receipt and first-line reads and rejects incomplete metadata', async () => {
		writeFileSync(opts.hookFile, ' '.repeat(64 * 1024 + 1));
		expect(await locateCodexTranscript(opts, 'ours')).toBeNull();
		save();
		writeFileSync(
			rollout,
			JSON.stringify({
				type: 'session_meta',
				payload: { ...meta, padding: 'x'.repeat(1024 * 1024) }
			}) + '\n'
		);
		expect(await locateCodexTranscript(opts, 'ours')).toBeNull();
		writeFileSync(rollout, JSON.stringify({ type: 'session_meta', payload: meta }));
		expect(await locateCodexTranscript(opts, 'ours')).toBeNull();
	});
});

describe('codexRecords', () => {
	it('renders canonical user, tool activity and reply through the existing chat fold', () => {
		const records = decoded([
			item({ type: 'UserMessage', id: 'u1', content: [{ type: 'text', text: 'Check the tree' }] }),
			item(command),
			item({
				type: 'AgentMessage',
				id: 'a1',
				content: [{ type: 'Text', text: 'All **clean**.' }],
				phase: 'final_answer'
			}),
			event({ type: 'task_complete', turn_id: 'turn-1', duration_ms: 900 })
		]);
		const chat = fold(records);
		expect(chat.items[0]).toMatchObject({ kind: 'user', text: 'Check the tree' });
		expect(chat.items[1]).toMatchObject({
			kind: 'turn',
			done: true,
			durationMs: 900,
			parts: [
				{
					kind: 'activity',
					steps: [{ kind: 'tool', name: 'Bash', result: 'clean', isError: false }]
				},
				{ kind: 'text', text: 'All **clean**.' }
			]
		});
	});
	it('uses stable IDs for live tool starts and completed-only replay', () => {
		const started = item({ ...command, status: 'inProgress' }, 'item_started');
		const completed = item(command);
		expect(codexRecords(started)[0].uuid).toBe(codexRecords(completed)[0].uuid);
		const chat = fold(decoded([started, completed]));
		expect(chat.items).toHaveLength(1);
		expect(chat.items[0]).toMatchObject({
			parts: [{ kind: 'activity', steps: [{ name: 'Bash', result: 'clean' }] }]
		});
	});
	it('ignores duplicated wire records and injected instructions', () => {
		for (const raw of [
			{
				timestamp: AT,
				type: 'response_item',
				payload: {
					type: 'message',
					role: 'user',
					content: [{ type: 'input_text', text: 'injected AGENTS instructions' }]
				}
			},
			{
				timestamp: AT,
				type: 'response_item',
				payload: {
					type: 'message',
					role: 'assistant',
					content: [{ type: 'output_text', text: 'duplicate reply' }]
				}
			},
			event({ type: 'agent_message', message: 'duplicate reply' })
		])
			expect(codexRecords(raw)).toEqual([]);
	});
	it('pairs MCP calls and results using the existing plugin app tool names', () => {
		const records = codexRecords(
			item({
				type: 'McpToolCall',
				id: 'm1',
				server: 'preview',
				tool: 'open',
				arguments: { url: 'http://localhost' },
				status: 'completed',
				result: {
					content: [
						{ type: 'text', text: 'ready' },
						{ type: 'image', data: 'not forwarded' }
					],
					isError: false
				}
			})
		);
		expect(records[0].message.content[0]).toMatchObject({
			type: 'tool_use',
			name: 'mcp__preview__open',
			input: { url: 'http://localhost' }
		});
		expect(records[1].message.content[0]).toMatchObject({
			type: 'tool_result',
			tool_use_id: records[0].message.content[0].id,
			content: [{ type: 'text', text: 'ready' }],
			is_error: false
		});
	});
	it('preserves command failures and MCP errors', () => {
		expect(codexRecords(item({ ...command, exit_code: 1 }))[1].message.content[0].is_error).toBe(
			true
		);
		expect(
			codexRecords(
				item({
					type: 'McpToolCall',
					id: 'm1',
					server: 's',
					tool: 't',
					arguments: {},
					status: 'failed',
					error: { message: 'disconnected' }
				})
			)[1].message.content[0]
		).toMatchObject({ is_error: true, content: 'disconnected' });
	});
	it('represents file patches and reasoning as existing activity steps', () => {
		const chat = fold(
			decoded([
				item({ type: 'Reasoning', id: 'r1', summary_text: ['Plan the change'] }),
				item({
					type: 'FileChange',
					id: 'f1',
					status: 'completed',
					changes: { '/repo/main.ts': { type: 'update', unified_diff: '+fixed' } },
					stdout: 'applied',
					stderr: ''
				})
			])
		);
		expect(chat.items[0]).toMatchObject({
			parts: [
				{
					kind: 'activity',
					steps: [
						{ kind: 'thinking' },
						{
							kind: 'tool',
							name: 'Edit',
							input: { file_path: '/repo/main.ts' },
							result: 'applied\n'
						}
					]
				}
			]
		});
	});
	it('marks interrupted turns without showing a fake user bubble', () => {
		const chat = fold(
			decoded([
				item({ type: 'AgentMessage', id: 'a1', content: [{ type: 'Text', text: 'Working' }] }),
				event({ type: 'turn_aborted', turn_id: 'turn-1' })
			])
		);
		expect(chat.items).toHaveLength(1);
		expect(chat.items[0]).toMatchObject({ kind: 'turn', interrupted: true });
	});
	it.each([
		null,
		[],
		{},
		{ type: 'event_msg', timestamp: 'invalid', payload: {} },
		event({ type: 'item_completed', item: { type: 'UserMessage', content: [] } }),
		item({ type: 'CommandExecution', id: 'bad', command: 10 }),
		item({ type: 'unknown', id: 'u' })
	])('ignores malformed or unsupported data %j', (raw) => {
		expect(codexRecords(raw)).toEqual([]);
	});
});
