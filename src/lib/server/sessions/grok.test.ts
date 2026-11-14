import {
	mkdirSync,
	mkdtempSync,
	realpathSync,
	rmSync,
	symlinkSync,
	utimesSync,
	writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fold } from '../../chat/fold';
import { grokArgv, grokRecords, grokScreen, locateGrokTranscript } from './grok';

const SESSION = '18e0d58a-fbfa-447a-9c44-24883f59af2b';
const NEXT = '01a1d946-4d4a-7332-a443-c02a7ac4e909';
const OTHER = '22222222-2222-7222-8222-222222222222';
const PROMPT = 'e7787950-b8b7-4aa2-b32d-dde3b08e4ffb';
const AT = 1794646531471;

// The shapes below are Grok 1.0.77's own lines, with their unused fields left out.
let event = 0;
const line = (update: Record<string, unknown>, method = 'session/update') => ({
	timestamp: Math.floor(AT / 1000),
	method,
	params: {
		sessionId: SESSION,
		update,
		_meta: { eventId: `${SESSION}-${++event}`, agentTimestampMs: AT + event, promptId: PROMPT }
	}
});
const said = (kind: string, text: string, meta?: Record<string, unknown>) =>
	line({ sessionUpdate: kind, content: { type: 'text', text }, ...(meta ? { _meta: meta } : {}) });
const user = (text: string, meta: Record<string, unknown> = {}) =>
	said('user_message_chunk', text, { modelId: 'grok-4.7', promptIndex: 0, ...meta });
const call = (id: string, name: string, rawInput: Record<string, unknown>) =>
	line({
		sessionUpdate: 'tool_call',
		toolCallId: id,
		title: name,
		rawInput,
		_meta: { 'x.ai/tool': { version: 1, name, namespace: 'grok_build' } }
	});
const detail = (id: string, rawInput: Record<string, unknown>) =>
	line({ sessionUpdate: 'tool_call_update', toolCallId: id, kind: 'execute', rawInput });
const result = (id: string, status: string, rest: Record<string, unknown>) =>
	line({ sessionUpdate: 'tool_call_update', toolCallId: id, status, ...rest });
const shown = (text: string) => [{ type: 'content', content: { type: 'text', text } }];
const done = (stop_reason = 'end_turn', rest: Record<string, unknown> = {}) =>
	line(
		{ sessionUpdate: 'turn_completed', prompt_id: PROMPT, stop_reason, elapsed_ms: 5278, ...rest },
		'_x.ai/session/update'
	);
const decoded = (lines: unknown[]) => lines.flatMap(grokRecords);

let root: string;
let opts: { firstmateDir: string; grokHome: string; sessionId: string | null };

/** A conversation as Grok keeps it; `group` stands in for the folder Grok names after the working directory. */
function conversation(id: string, cwd = opts.firstmateDir, group = 'firstmate-checkout') {
	const folder = path.join(opts.grokHome, 'sessions', group, id);
	mkdirSync(folder, { recursive: true });
	writeFileSync(path.join(folder, 'summary.json'), JSON.stringify({ info: { id, cwd } }));
	const file = path.join(folder, 'updates.jsonl');
	writeFileSync(file, '');
	return file;
}
const listed = (rows: Record<string, unknown>[]) =>
	writeFileSync(path.join(opts.grokHome, 'active_sessions.json'), JSON.stringify(rows));
const row = (session_id: string, opened_at: string, pid = 4242) => ({
	session_id,
	pid,
	pid_start: 2778267,
	cwd: opts.firstmateDir,
	opened_at
});
const writtenAt = (file: string, iso: string) => utimesSync(file, new Date(iso), new Date(iso));

beforeEach(() => {
	root = realpathSync(mkdtempSync(path.join(tmpdir(), 'wh-grok-')));
	opts = {
		firstmateDir: path.join(root, 'firstmate'),
		grokHome: path.join(root, 'grok'),
		sessionId: SESSION
	};
	mkdirSync(opts.firstmateDir);
	mkdirSync(path.join(opts.grokHome, 'sessions'), { recursive: true });
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe('grokArgv', () => {
	it('starts Grok as Firstmate does, with the conversation id Wheelhouse chose', () => {
		expect(grokArgv('/bin/grok', SESSION)).toEqual([
			'/bin/grok',
			'--trust',
			'--session-id',
			SESSION
		]);
	});
});

describe('locateGrokTranscript', () => {
	it('binds the conversation Wheelhouse started, wherever Grok filed it', async () => {
		const file = conversation(SESSION);
		expect(await locateGrokTranscript(opts, 'ours')).toEqual({ how: 'launch', file });
	});
	it.each([null, '', ' ', 'latest', '../18e0d58a-fbfa-447a-9c44-24883f59af2b'])(
		'requires the conversation id of the owned session: %j',
		async (sessionId) => {
			conversation(SESSION);
			expect(await locateGrokTranscript({ ...opts, sessionId }, 'ours')).toBeNull();
		}
	);
	it.each(['external', 'starting', 'none', 'unavailable'] as const)(
		'never guesses a conversation for %s sessions',
		async (state) => {
			conversation(SESSION);
			expect(await locateGrokTranscript(opts, state)).toBeNull();
		}
	);
	it('does not choose a newer conversation in the same folder that it did not start', async () => {
		writtenAt(conversation(OTHER), '2026-11-14T09:30:00Z');
		expect(await locateGrokTranscript(opts, 'ours')).toBeNull();
		const file = conversation(SESSION);
		writtenAt(file, '2026-11-14T09:00:00Z');
		expect(await locateGrokTranscript(opts, 'ours')).toEqual({ how: 'launch', file });
	});
	it('rejects a summary that names another conversation or another working directory', async () => {
		const other = path.join(root, 'other');
		mkdirSync(other);
		conversation(SESSION, other);
		expect(await locateGrokTranscript(opts, 'ours')).toBeNull();
		const folder = path.join(opts.grokHome, 'sessions', 'firstmate-checkout', SESSION);
		writeFileSync(
			path.join(folder, 'summary.json'),
			JSON.stringify({ info: { id: OTHER, cwd: opts.firstmateDir } })
		);
		expect(await locateGrokTranscript(opts, 'ours')).toBeNull();
	});
	it('accepts a symlinked checkout only when both paths resolve to the same directory', async () => {
		const alias = path.join(root, 'alias');
		symlinkSync(opts.firstmateDir, alias);
		const file = conversation(SESSION, alias);
		expect(await locateGrokTranscript(opts, 'ours')).toEqual({ how: 'launch', file });
	});
	it('waits for a conversation Grok has not written yet, and for an unreadable summary', async () => {
		expect(await locateGrokTranscript(opts, 'ours')).toBeNull();
		const folder = path.join(opts.grokHome, 'sessions', 'firstmate-checkout', SESSION);
		mkdirSync(folder, { recursive: true });
		writeFileSync(path.join(folder, 'summary.json'), '{"info":');
		expect(await locateGrokTranscript(opts, 'ours')).toBeNull();
	});
	it('follows the conversation /new opened in the same Grok process', async () => {
		writtenAt(conversation(SESSION), '2026-11-14T08:56:50Z');
		const next = conversation(NEXT);
		rmSync(next); // Grok writes nothing to a new conversation until its first prompt.
		listed([row(SESSION, '2026-11-14T08:55:16.981Z'), row(NEXT, '2026-11-14T08:57:05.746Z')]);
		expect(await locateGrokTranscript(opts, 'ours')).toEqual({ how: 'launch', file: next });
	});
	it('returns to the earlier conversation once it is written again', async () => {
		const first = conversation(SESSION);
		writtenAt(conversation(NEXT), '2026-11-14T08:57:07Z');
		listed([row(SESSION, '2026-11-14T08:55:16.981Z'), row(NEXT, '2026-11-14T08:57:05.746Z')]);
		writtenAt(first, '2026-11-14T09:10:00Z');
		expect(await locateGrokTranscript(opts, 'ours')).toEqual({ how: 'launch', file: first });
	});
	it('ignores conversations of other Grok processes and of other folders', async () => {
		const file = conversation(SESSION);
		writtenAt(file, '2026-11-14T08:56:50Z');
		writtenAt(conversation(NEXT), '2026-11-14T09:30:00Z');
		const elsewhere = path.join(root, 'elsewhere');
		mkdirSync(elsewhere);
		writtenAt(conversation(OTHER, elsewhere, 'elsewhere'), '2026-11-14T09:40:00Z');
		listed([
			row(SESSION, '2026-11-14T08:55:16.981Z'),
			row(NEXT, '2026-11-14T09:20:00Z', 999),
			row(OTHER, '2026-11-14T09:35:00Z')
		]);
		expect(await locateGrokTranscript(opts, 'ours')).toEqual({ how: 'launch', file });
	});
	it.each(['not json', '{"sessions":[]}', '[{"session_id":7}]', '[]'])(
		'keeps the conversation it started when Grok’s list of open ones is %j',
		async (text) => {
			const file = conversation(SESSION);
			writtenAt(conversation(NEXT), '2026-11-14T09:30:00Z');
			writeFileSync(path.join(opts.grokHome, 'active_sessions.json'), text);
			expect(await locateGrokTranscript(opts, 'ours')).toEqual({ how: 'launch', file });
		}
	);
});

describe('grokRecords', () => {
	it('renders a prompt, thinking, tool activity and reply through the existing chat fold', () => {
		const chat = fold(
			decoded([
				line(
					{ sessionUpdate: 'hook_execution', event_name: 'session_start', runs: [] },
					'_x.ai/session/update'
				),
				user('Run the probe and write note.txt.'),
				said('agent_thought_chunk', 'Running the shell command.'),
				said('agent_message_chunk', 'I’ll run the probe command and write `note.txt`.'),
				call('call-1', 'run_terminal_command', {
					command: 'echo wheelhouse-probe',
					description: 'Print wheelhouse-probe marker'
				}),
				detail('call-1', { variant: 'Bash', command: 'echo wheelhouse-probe' }),
				result('call-1', 'completed', {
					content: shown('wheelhouse-probe\n'),
					rawOutput: {
						type: 'Bash',
						output_for_prompt: 'exit: 0\nwheelhouse-probe\n',
						exit_code: 0
					}
				}),
				said('agent_message_chunk', 'The probe printed `wheelhouse-probe`.'),
				done()
			])
		);
		expect(chat.items[0]).toMatchObject({
			kind: 'user',
			text: 'Run the probe and write note.txt.'
		});
		expect(chat.items[1]).toMatchObject({ kind: 'turn', done: true, durationMs: 5278 });
		expect(chat.items).toHaveLength(2);
		const parts = chat.items[1].kind === 'turn' ? chat.items[1].parts : [];
		expect(parts.filter((part) => part.kind === 'text').map((part) => part.text)).toEqual([
			'I’ll run the probe command and write `note.txt`.',
			'The probe printed `wheelhouse-probe`.'
		]);
		const steps = parts.flatMap((part) => (part.kind === 'activity' ? part.steps : []));
		expect(steps.map((step) => step.kind)).toEqual(['thinking', 'tool']);
		expect(steps[1]).toMatchObject({
			name: 'Bash',
			summary: 'Print wheelhouse-probe marker',
			result: 'wheelhouse-probe\n',
			isError: false
		});
	});
	it('keeps one stable id for each line, so a replay adds nothing', () => {
		const one = said('agent_message_chunk', 'Once.');
		expect(grokRecords(one)[0].uuid).toBe(`grok:${one.params._meta.eventId}`);
		expect(grokRecords(one)).toEqual(grokRecords(structuredClone(one)));
	});
	it('translates Grok’s built-in tools to the names the chat describes', () => {
		const names = (name: string, input: Record<string, unknown>) =>
			grokRecords(call('call-2', name, input))[0].message.content[0];
		expect(names('read_file', { target_file: '/repo/a.ts', limit: 20 })).toMatchObject({
			name: 'Read',
			input: { file_path: '/repo/a.ts' }
		});
		expect(
			names('search_replace', { file_path: '/repo/a.ts', old_string: '', new_string: 'x' })
		).toMatchObject({ name: 'Edit', input: { file_path: '/repo/a.ts' } });
		expect(names('write', { file_path: '/repo/b.ts', content: 'x' }).name).toBe('Write');
		expect(names('grep', { pattern: 'needle', glob: '*.ts' })).toMatchObject({
			name: 'Grep',
			input: { pattern: 'needle' }
		});
		expect(names('list_dir', { target_directory: '/repo/src' })).toMatchObject({
			name: 'Glob',
			input: { pattern: '/repo/src' }
		});
		expect(names('web_fetch', { url: 'https://example.com/a' }).name).toBe('WebFetch');
		expect(names('spawn_subagent', { description: 'Trace it', prompt: 'p' }).name).toBe('Task');
		expect(names('todo_write', { merge: true, todos: [] }).name).toBe('TodoWrite');
		expect(names('monitor', { command: 'make ci' }).name).toBe('monitor');
		const search = line({
			sessionUpdate: 'tool_call',
			toolCallId: 'search-1',
			title: 'Web search:',
			kind: 'search',
			status: 'in_progress',
			rawInput: { variant: 'WebSearch', backend: true }
		});
		expect(grokRecords(search)[0].message.content[0].name).toBe('WebSearch');
	});
	it('pairs an edit with what Grok says it did when the result holds only a diff', () => {
		const chat = fold(
			decoded([
				call('call-3', 'search_replace', { file_path: '/repo/note.txt', new_string: 'hello\n' }),
				result('call-3', 'completed', {
					content: [{ type: 'diff', path: '/repo/note.txt', oldText: '', newText: 'hello\n' }],
					rawOutput: {
						type: 'SearchReplace',
						EditsApplied: { tool_output_for_prompt: 'The file /repo/note.txt has been created.' }
					}
				})
			])
		);
		expect(chat.items[0]).toMatchObject({
			parts: [
				{
					steps: [
						{ name: 'Edit', result: 'The file /repo/note.txt has been created.', isError: false }
					]
				}
			]
		});
	});
	it('pairs MCP calls and results using the existing plugin app tool names', () => {
		const records = decoded([
			call('call-4', 'use_tool', {
				tool_name: 'github__issue_read',
				tool_input: { method: 'get', issue_number: 670 }
			}),
			result('call-4', 'failed', {
				rawOutput: {
					type: 'MCP',
					tool_name: 'github__issue_read',
					server_name: 'GitHub',
					output: { Error: 'Not Found' },
					is_error: true
				}
			})
		]);
		expect(records[0].message.content[0]).toMatchObject({
			name: 'mcp__github__issue_read',
			input: { method: 'get', issue_number: 670 }
		});
		expect(records[1].message.content[0]).toMatchObject({
			tool_use_id: records[0].message.content[0].id,
			content: 'Not Found',
			is_error: true
		});
	});
	it.each([
		[
			'a missing folder',
			{ rawOutput: { type: 'ListDir', NotFound: 'No such directory: /repo/x' } },
			'No such directory: /repo/x'
		],
		[
			'an edit that matched nothing',
			{
				content: shown('old_string was not found'),
				rawOutput: {
					type: 'SearchReplace',
					NoMatchesFound: { message: 'old_string was not found' }
				}
			},
			'old_string was not found'
		],
		[
			'a tool that could not run',
			{ rawOutput: { error: 'tool_execution_failed', message: 'The tool timed out.' } },
			'The tool timed out.'
		]
	])('preserves %s as a failed step with its reason', (_what, rest, reason) => {
		const records = decoded([
			call('call-5', 'list_dir', { target_directory: '/repo/x' }),
			result('call-5', 'failed', rest)
		]);
		expect(records[1].message.content[0]).toMatchObject({ content: reason, is_error: true });
	});
	it('marks a command that finished with a failing exit code', () => {
		const [record] = grokRecords(
			result('call-6', 'completed', {
				content: shown('make: *** [ci] Error 2\n'),
				rawOutput: { type: 'Bash', exit_code: 2, output_for_prompt: 'exit: 2\nmake: ***' }
			})
		);
		expect(record.message.content[0]).toMatchObject({ is_error: true });
	});
	it('does not mark a search that finished without a match as failed', () => {
		const [record] = grokRecords(
			result('call-8', 'completed', {
				content: shown('No matches found'),
				rawOutput: {
					type: 'GrepSearch',
					stdout: '',
					stderr: '',
					exit_code: 1,
					match_count: 0,
					file_matches: []
				}
			})
		);
		expect(record.message.content[0]).toMatchObject({ is_error: false });
	});
	it('marks a cancelled turn interrupted and leaves its unfinished tool call without a result', () => {
		const chat = fold(
			decoded([
				user('Sleep, then say done.'),
				said('agent_message_chunk', 'I’ll run `sleep 60`.'),
				call('call-7', 'run_terminal_command', { command: 'sleep 60' }),
				detail('call-7', { variant: 'Bash', command: 'sleep 60' }),
				done('cancelled')
			])
		);
		expect(chat.items).toHaveLength(2);
		expect(chat.items[1]).toMatchObject({ kind: 'turn', interrupted: true, done: true });
		const steps =
			chat.items[1].kind === 'turn'
				? chat.items[1].parts.flatMap((part) => (part.kind === 'activity' ? part.steps : []))
				: [];
		expect(steps).toMatchObject([{ kind: 'tool', name: 'Bash', result: null }]);
		expect(
			fold(decoded([said('agent_message_chunk', 'Working'), done('interrupted')])).items[0]
		).toMatchObject({ kind: 'turn', interrupted: true });
	});
	it('shows the reason Grok gives when a turn ends in an error', () => {
		const chat = fold(
			decoded([
				user('Go'),
				done('error', { agent_result: 'API error (status 402 Payment Required)' })
			])
		);
		expect(chat.items[1]).toMatchObject({
			kind: 'turn',
			done: true,
			parts: [{ kind: 'text', text: 'API error (status 402 Payment Required)' }]
		});
	});
	it('ignores prompts Grok hides from its own scrollback, and its bookkeeping', () => {
		for (const raw of [
			user('<task-notification>wake</task-notification>', { hideFromScrollback: true }),
			user('Continue the plan.', { hideFromScrollback: true, syntheticPrompt: true }),
			line({ sessionUpdate: 'plan', entries: [{ content: 'Step', status: 'in_progress' }] }),
			line({ sessionUpdate: 'session_recap', summary: 'Recap', auto: true }),
			line({ sessionUpdate: 'task_completed', task_snapshot: { command: 'make ci' } }),
			line({ sessionUpdate: 'auto_compact_started', percentage: 81 }),
			line({ sessionUpdate: 'subagent_spawned', child_session_id: OTHER }),
			line({ sessionUpdate: 'retry_state', type: 'retrying', attempt: 1 }),
			detail('call-8', { variant: 'Bash', command: 'true' })
		])
			expect(grokRecords(raw)).toEqual([]);
	});
	it.each([
		null,
		[],
		{},
		{ timestamp: 1, method: 'session/update', params: {} },
		{ method: 'session/update', params: { update: { sessionUpdate: 'turn_completed' } } },
		{
			timestamp: 'now',
			params: { update: { sessionUpdate: 'turn_completed' }, _meta: { eventId: 'e-1' } }
		},
		{
			timestamp: 1,
			params: {
				update: { sessionUpdate: 'turn_completed' },
				_meta: { eventId: 'e-2', agentTimestampMs: 1e20 }
			}
		},
		said('user_message_chunk', '   '),
		line({ sessionUpdate: 'agent_message_chunk', content: { type: 'image' } }),
		line({ sessionUpdate: 'tool_call', title: 'read_file', rawInput: {} }),
		line({ sessionUpdate: 'tool_call_update', status: 'completed' })
	])('ignores malformed or unsupported data %j', (raw) => {
		expect(grokRecords(raw)).toEqual([]);
	});
});

// Grok 1.0.77's composer as tmux captures it; the border carries the model and permission mode.
const box = (input: string, hints: string, above = '') =>
	[
		'  ~/firstmate                                                    1.8K / 256K │ [Dashboard]',
		above,
		'  ╭──────────────────────────────────────────────────────────────────────────────────╮',
		`  │ ❯ ${input.padEnd(78)} │`,
		'  ╰────────────────────────────────────────────── Grok 4.7 (xhigh) · always-approve ─╯',
		'',
		`  ${hints}`,
		''
	].join('\n');
const IDLE = 'Shift+Tab:mode  │  Ctrl+x:shortcuts';

describe('grokScreen', () => {
	it('recognizes the empty composer, idle and while a turn runs', () => {
		expect(grokScreen(box('', IDLE))).toEqual({ kind: 'prompt', busy: false });
		expect(grokScreen(box('Type a message...', IDLE))).toEqual({ kind: 'prompt', busy: false });
		expect(
			grokScreen(
				box(
					'',
					'Shift+Tab:mode  │  Ctrl+c:cancel  │  Ctrl+b:send to bg  │  Ctrl+x:shortcuts',
					'   ⠴ Sleep 60 seconds in the foreground… 2.9s                     6.0s ⇣20.2k [↓][stop]'
				)
			)
		).toEqual({ kind: 'prompt', busy: true });
	});
	it('reports unsent input rather than typing after it', () => {
		const unsent = { kind: 'blocked', title: expect.stringContaining('unsent input') };
		const hints = 'Enter:send  │  Alt+Enter:newline  │  Shift+Tab:mode  │  Ctrl+x:shortcuts';
		expect(grokScreen(box('half a thought', hints))).toMatchObject(unsent);
		expect(grokScreen(box('half a thought', IDLE))).toMatchObject(unsent);
		const twoRows = box('Run the shell command and then write a file named', hints).replace(
			/\n(\s*)╰/,
			`\n  │   ${'note.txt containing the single word hello.'.padEnd(78)} │\n$1╰`
		);
		expect(twoRows.split('\n').filter((row) => row.includes('│ ')).length).toBeGreaterThan(1);
		expect(grokScreen(twoRows)).toMatchObject(unsent);
	});
	it('leaves a command list or any other offer of Enter to the terminal', () => {
		expect(grokScreen(box('', `Enter:select  │  ${IDLE}`)).kind).toBe('blocked');
	});
	it('never takes the dashboard’s box, which starts another agent, for the composer', () => {
		const dashboard = [
			'  + New Agent                                            Open Previous /resume │ Worktree Ctrl+w',
			'  ▾ Idle 1 ─────────────────────────────────────────────────────────────────────────',
			'    ◇ Run echo and write note.txt file · fm                                just now',
			'  ╭───────────────────────────────────────────────────────── ~/firstmate · Ctrl+l ╮',
			'  │ ❯ Dispatch a new agent                                                         │',
			'  ╰───────────────────────────────────────────────────── Grok 4.7 · always-approve ╯',
			'',
			'  Enter:create  │  Tab:input  │  ?:shortcuts'
		].join('\n');
		expect(grokScreen(dashboard).kind).toBe('blocked');
	});
	it.each([
		null,
		'',
		'Welcome to Grok\n\n  Sign in to continue\n  Enter:continue',
		'  Do you trust the files in this folder?\n  ❯ Yes\n    No\n\n  Enter:select  │  Esc:cancel',
		`${IDLE}`,
		box('', IDLE).replace('│ ❯', '│  '),
		`${box('', IDLE)}\n\n\n\n  a dialog drawn under the composer\n`
	])('blocks missing, unknown and unproven screens: %j', (text) => {
		expect(grokScreen(text).kind).toBe('blocked');
	});
});
