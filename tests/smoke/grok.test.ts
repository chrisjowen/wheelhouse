import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { fold } from '../../src/lib/chat/fold';
import { createFakeFirstmate, READY_ON_WATCH, type FakeFirstmate } from '../helpers/fake-firstmate';

let fm: FakeFirstmate;
let state: string;
let child: ChildProcess;
let base = '';
let output = '';
let env: NodeJS.ProcessEnv;
// Short: macOS caps a tmux socket's whole path at 104 bytes.
const socket = `wh-gk-${process.pid}`;

beforeAll(async () => {
	fm = createFakeFirstmate();
	fm.set('ready.json', {
		...READY_ON_WATCH,
		lock: { state: 'free', pid: null, live_harness: false }
	});
	state = mkdtempSync(path.join(tmpdir(), 'wh-gk-'));
	const bin = path.join(state, 'bin');
	mkdirSync(bin);
	writeFileSync(
		path.join(bin, 'grok'),
		`#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const session = process.argv[process.argv.indexOf('--session-id')+1];
const home = process.env.GROK_HOME;
const folder = path.join(home, 'sessions', encodeURIComponent(process.cwd()), session);
fs.mkdirSync(folder, {recursive:true});
fs.writeFileSync(path.join(folder, 'summary.json'), JSON.stringify({info:{id:session,cwd:process.cwd()}}));
fs.writeFileSync(path.join(home, 'active_sessions.json'), JSON.stringify([
 {session_id:session,pid:process.pid,pid_start:1,cwd:process.cwd(),opened_at:'2026-11-14T08:55:16.981Z'}
]));
let n = 0;
const line = (update, method='session/update') => ({timestamp:1794646531,method,params:{sessionId:session,update,
 _meta:{eventId:session+'-'+(++n),agentTimestampMs:1794646531000+n}}});
const text = (kind, text) => line({sessionUpdate:kind,content:{type:'text',text}});
fs.writeFileSync(path.join(folder, 'updates.jsonl'), [
 line({sessionUpdate:'hook_execution',event_name:'session_start',runs:[]}, '_x.ai/session/update'),
 text('user_message_chunk','Check the native chat.'),
 line({sessionUpdate:'tool_call',toolCallId:'call-1',title:'run_terminal_command',rawInput:{command:'printf native-ok'},
  _meta:{'x.ai/tool':{version:1,name:'run_terminal_command'}}}),
 line({sessionUpdate:'tool_call_update',toolCallId:'call-1',status:'completed',
  content:[{type:'content',content:{type:'text',text:'native-ok'}}],rawOutput:{type:'Bash',exit_code:0}}),
 text('agent_message_chunk','Native chat works.'),
 line({sessionUpdate:'turn_completed',prompt_id:'p1',stop_reason:'end_turn',elapsed_ms:900}, '_x.ai/session/update')
].map(JSON.stringify).join('\\n')+'\\n');
const rule = '─'.repeat(40);
process.stdout.write('  ╭'+rule+'╮\\n  │ ❯'+' '.repeat(38)+'│\\n  ╰'+rule+'╯\\n\\n  Shift+Tab:mode  │  Ctrl+x:shortcuts\\n');
process.stdin.resume();
setInterval(()=>{},1000);
`,
		{ mode: 0o755 }
	);
	env = {
		...process.env,
		PATH: `${bin}${path.delimiter}${process.env.PATH}`,
		GROK_HOME: path.join(state, 'grok'),
		// Any tmux call stays on a throwaway server, never the captain's or the crew's.
		TMUX: '',
		TMUX_TMPDIR: state,
		// Never the machine's own run logs or evidence.
		WHEELHOUSE_NM_EVIDENCE_DIR: path.join(fm.root, 'none'),
		WHEELHOUSE_NM_LOGS_DIR: path.join(fm.root, 'none'),
		WHEELHOUSE_MANAGE_SKILL: '0',
		WHEELHOUSE_NO_GH: '1',
		WHEELHOUSE_NO_USAGE: '1',
		WHEELHOUSE_PLUGINS_DIR: path.join(state, 'plugins'),
		CLAUDE_CONFIG_DIR: path.join(state, 'claude')
	};
	await start();
});

async function start(): Promise<void> {
	output = '';
	child = spawn(
		process.execPath,
		[
			'dist/cli.js',
			'open',
			'--firstmate',
			fm.root,
			// Never the captain's own home from FM_HOME.
			'--home',
			fm.root,
			'--harness',
			'grok',
			'--state-dir',
			state,
			'--config-dir',
			state,
			'--tmux-socket',
			socket,
			'--port',
			'0',
			'--no-browser'
		],
		{ env, stdio: ['ignore', 'pipe', 'pipe'] }
	);
	child.stdout?.on('data', (chunk) => (output += chunk));
	child.stderr?.on('data', (chunk) => (output += chunk));
	await waitFor(() => /listening on (http:\/\/127\.0\.0\.1:\d+)\//.test(output));
	base = /listening on (http:\/\/127\.0\.0\.1:\d+)\//.exec(output)?.[1] ?? '';
	await waitFor(() => output.includes('running in tmux'));
}

async function waitFor(ready: () => boolean): Promise<void> {
	const deadline = Date.now() + 20_000;
	while (!ready()) {
		if (Date.now() > deadline || child.exitCode !== null || child.signalCode !== null)
			throw new Error(`Grok smoke server did not become ready: ${output}`);
		await new Promise((resolve) => setTimeout(resolve, 100));
	}
}

async function stop(): Promise<void> {
	if (!child || child.exitCode !== null || child.signalCode !== null) return;
	const ended = new Promise<void>((resolve) => child.once('exit', () => resolve()));
	child.kill('SIGTERM');
	await ended;
}

afterAll(async () => {
	await stop();
	try {
		execFileSync('tmux', ['-L', socket, 'kill-server'], { env, stdio: 'ignore' });
	} catch {
		/* already stopped */
	}
	fm?.cleanup();
	if (state) rmSync(state, { recursive: true, force: true });
});

async function chat() {
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), 10_000);
	try {
		const response = await fetch(`${base}/api/firstmate/chat`, { signal: controller.signal });
		const reader = response.body?.getReader();
		if (!reader) throw new Error('missing chat stream');
		let text = '';
		while (!text.includes('event: synced')) {
			const { value, done } = await reader.read();
			if (done) break;
			text += new TextDecoder().decode(value);
		}
		return text.split('\n\n').flatMap((block) => {
			const type = /event: (.+)/.exec(block)?.[1];
			const data = /data: (.+)/.exec(block)?.[1];
			return type && data ? [{ type, data: JSON.parse(data) }] : [];
		});
	} finally {
		clearTimeout(timeout);
		controller.abort();
	}
}

it('delivers native Grok messages, command activity and completion through the normal chat, then reconnects to the same primary', async () => {
	for (let pass = 0; pass < 2; pass++) {
		// The native tool writes its conversation a moment after tmux starts it.
		let events = await chat();
		const deadline = Date.now() + 15_000;
		while (!events.some((event) => event.type === 'records') && Date.now() < deadline) {
			await new Promise((resolve) => setTimeout(resolve, 250));
			events = await chat();
		}
		expect(events.find((event) => event.type === 'session')?.data).toMatchObject({
			state: 'ours',
			harness: 'grok',
			canSend: true
		});
		const conversation = fold(
			events.filter((event) => event.type === 'records').flatMap((event) => event.data)
		);
		expect(conversation.items).toHaveLength(2);
		expect(conversation.items[0]).toMatchObject({ kind: 'user', text: 'Check the native chat.' });
		expect(conversation.items[1]).toMatchObject({
			kind: 'turn',
			done: true,
			durationMs: 900,
			parts: [
				{ kind: 'activity', steps: [{ kind: 'tool', result: 'native-ok', isError: false }] },
				{ kind: 'text', text: 'Native chat works.' }
			]
		});
		if (pass === 0) {
			await stop();
			await start();
		}
	}
});
