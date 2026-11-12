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
const socket = `wh-codex-smoke-${process.pid}`;

beforeAll(async () => {
	fm = createFakeFirstmate();
	fm.set('ready.json', {
		...READY_ON_WATCH,
		lock: { state: 'free', pid: null, live_harness: false }
	});
	state = mkdtempSync(path.join(tmpdir(), 'wh-codex-chat-'));
	const bin = path.join(state, 'bin');
	mkdirSync(bin);
	writeFileSync(
		path.join(bin, 'codex'),
		`#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
const session = '11111111-1111-7111-8111-111111111111';
const file = path.join(process.env.CODEX_HOME, 'sessions', 'native.jsonl');
fs.mkdirSync(path.dirname(file), {recursive:true});
const at = '2026-11-12T12:00:00Z';
const event = payload => ({type:'event_msg',timestamp:at,payload});
const item = item => event({type:'item_completed',item});
fs.writeFileSync(file, [
 {type:'session_meta',payload:{id:session,cwd:process.cwd(),originator:'codex-tui',source:'vscode',cli_version:'0.167.2'}},
 item({type:'UserMessage',id:'u1',content:[{type:'text',text:'Check the native chat.'}]}),
 item({type:'CommandExecution',id:'c1',command:['printf','native-ok'],status:'completed',aggregated_output:'native-ok',exit_code:0}),
 item({type:'AgentMessage',id:'a1',content:[{type:'Text',text:'Native chat works.'}]}),
 event({type:'task_complete',turn_id:'t1'})
].map(JSON.stringify).join('\\n')+'\\n');
const setting = process.argv[process.argv.indexOf('-c')+1];
const command = JSON.parse(/command=(.*),timeout=10/.exec(setting)[1]);
cp.execFileSync('bash',['-c',command],{env:process.env,input:JSON.stringify({session_id:session,transcript_path:file,cwd:process.cwd()})});
process.stdout.write('› Ask Codex to do anything\\n\\n  ? for shortcuts\\n');
process.stdin.resume();
setInterval(()=>{},1000);
`,
		{ mode: 0o755 }
	);
	env = {
		...process.env,
		PATH: `${bin}${path.delimiter}${process.env.PATH}`,
		CODEX_HOME: path.join(state, 'codex'),
		TMUX_TMPDIR: state,
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
			'--harness',
			'codex',
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
			throw new Error(`Codex smoke server did not become ready: ${output}`);
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

it('delivers native Codex messages, command activity and completion through the normal chat, then reconnects to the same primary', async () => {
	for (let pass = 0; pass < 2; pass++) {
		const events = await chat();
		expect(events.find((event) => event.type === 'session')?.data).toMatchObject({
			state: 'ours',
			harness: 'codex',
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
