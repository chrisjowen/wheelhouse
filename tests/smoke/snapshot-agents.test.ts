import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { fold } from '../../src/lib/chat/fold';
import { createFakeFirstmate, READY_ON_WATCH, type FakeFirstmate } from '../helpers/fake-firstmate';

/**
 * Pi and OpenCode, the primary agents whose chat is read as a whole snapshot
 * (Pi's session file through its extension's receipt, OpenCode's API) rather
 * than followed as a transcript, through the real server: each fake writes
 * what the native tool would, and the normal chat must show it, before and
 * after a Wheelhouse restart.
 */

const PI = `#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const session = '11111111-1111-7111-8111-111111111111';
const at = '2026-11-12T12:00:00.000Z';
const file = path.join(process.env.PI_CODING_AGENT_DIR, 'sessions', 'project', 'session.jsonl');
fs.mkdirSync(path.dirname(file), {recursive:true});
const message = (id, parentId, message) => ({type:'message',id,parentId,timestamp:at,message});
fs.writeFileSync(file, [
 {type:'session',version:3,id:session,timestamp:at,cwd:process.cwd()},
 message('u1', null, {role:'user',content:'Check the native chat.'}),
 message('a1', 'u1', {role:'assistant',content:[{type:'text',text:'Native chat works.'}],stopReason:'stop'})
].map(JSON.stringify).join('\\n')+'\\n');
const record = process.env.WH_SESSION_RECORD;
fs.writeFileSync(record + '.tmp', JSON.stringify({wheelhouse_nonce:process.env.WH_SESSION_NONCE,
 session_id:session,transcript_path:file,cwd:process.cwd(),leaf_id:'a1',busy:false}));
fs.renameSync(record + '.tmp', record);
const rule = '─'.repeat(80);
process.stdout.write([rule, '', rule, process.cwd(), '0.0%/1.0M (auto) gpt-4.1'].join('\\n') + '\\n');
process.stdin.resume();
setInterval(()=>{},1000);
`;

const OPENCODE = `#!/usr/bin/env node
const http = require('node:http');
const port = Number(process.argv[process.argv.indexOf('--port')+1]);
const auth = 'Basic ' + Buffer.from(process.env.OPENCODE_SERVER_USERNAME + ':' + process.env.OPENCODE_SERVER_PASSWORD).toString('base64');
const created = 1794495900000;
// Each session keeps the directory it was created for, as OpenCode does.
const sessions = new Map();
http.createServer(async (req, res) => {
 let body = '';
 for await (const chunk of req) body += chunk;
 const send = (value, code = 200) => res.writeHead(code, {'content-type':'application/json'}).end(JSON.stringify(value));
 if (req.headers.authorization !== auth) return res.writeHead(401).end();
 const url = new URL(req.url, 'http://localhost');
 const meta = id => ({data:{id,location:{directory:sessions.get(id)}}});
 if (url.pathname === '/api/session' && req.method === 'POST') { const {id, location} = JSON.parse(body); sessions.set(id, location.directory); return send(meta(id)); }
 if (url.pathname === '/tui/select-session') return send(true);
 if (url.pathname === '/api/session/active') return send({data:{}});
 const m = /^\\/api\\/session\\/([^/]+)(\\/[a-z]+)?$/.exec(url.pathname);
 if (!m || !sessions.has(m[1])) return send({}, 404);
 if (!m[2]) return send(meta(m[1]));
 if (m[2] === '/permission' || m[2] === '/question') return send({data:[]});
 if (m[2] === '/history') return send({data:[],hasMore:false});
 if (m[2] === '/message') return send({cursor:{next:null,previous:null},data:[
  {id:'msg_reply',type:'assistant',time:{created:created+1,completed:created+900},finish:'stop',content:[
   {id:'tool',type:'tool',name:'bash',state:{status:'completed',input:{command:'printf native-ok'},content:[{type:'text',text:'native-ok'}]}},
   {id:'reply',type:'text',text:'Native chat works.'}]},
  {id:'msg_user',type:'user',time:{created},text:'Check the native chat.'}
 ]});
 send({}, 404);
}).listen(port, '127.0.0.1', () => process.stdout.write('┃ Ask OpenCode anything\\n'));
`;

let fm: FakeFirstmate | undefined;
let state = '';
let socket = '';
let child: ChildProcess | undefined;
let base = '';
let output = '';
let env: NodeJS.ProcessEnv;

afterEach(async () => {
	await stop();
	try {
		execFileSync('tmux', ['-L', socket, 'kill-server'], { env, stdio: 'ignore' });
	} catch {
		/* already stopped */
	}
	fm?.cleanup();
	if (state) rmSync(state, { recursive: true, force: true });
});

/** A fake Firstmate home, a throwaway tmux server, and `harness` as the only native binary on PATH. */
function prepare(harness: 'pi' | 'opencode', script: string): void {
	fm = createFakeFirstmate();
	fm.set('ready.json', {
		...READY_ON_WATCH,
		lock: { state: 'free', pid: null, live_harness: false }
	});
	state = mkdtempSync(path.join(tmpdir(), `wh-${harness.slice(0, 2)}-`));
	// Short: macOS caps a tmux socket's whole path at 104 bytes.
	socket = `wh-${harness.slice(0, 2)}-${process.pid}`;
	const bin = path.join(state, 'bin');
	mkdirSync(bin);
	writeFileSync(path.join(bin, harness), script, { mode: 0o755 });
	env = {
		...process.env,
		PATH: `${bin}${path.delimiter}${process.env.PATH}`,
		PI_CODING_AGENT_DIR: path.join(state, 'pi'),
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
}

async function start(harness: 'pi' | 'opencode'): Promise<void> {
	output = '';
	const server = spawn(
		process.execPath,
		[
			'dist/cli.js',
			'open',
			'--firstmate',
			fm!.root,
			// Never the captain's own home from FM_HOME.
			'--home',
			fm!.root,
			'--harness',
			harness,
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
	child = server;
	server.stdout?.on('data', (chunk) => (output += chunk));
	server.stderr?.on('data', (chunk) => (output += chunk));
	await waitFor(() => /listening on (http:\/\/127\.0\.0\.1:\d+)\//.test(output));
	base = /listening on (http:\/\/127\.0\.0\.1:\d+)\//.exec(output)?.[1] ?? '';
	await waitFor(() => output.includes('running in tmux'));
}

async function waitFor(ready: () => boolean): Promise<void> {
	const deadline = Date.now() + 20_000;
	while (!ready()) {
		if (Date.now() > deadline || child?.exitCode !== null || child?.signalCode !== null)
			throw new Error(`Smoke server did not become ready: ${output}`);
		await new Promise((resolve) => setTimeout(resolve, 100));
	}
}

async function stop(): Promise<void> {
	const server = child;
	if (!server || server.exitCode !== null || server.signalCode !== null) return;
	const ended = new Promise<void>((resolve) => server.once('exit', () => resolve()));
	server.kill('SIGTERM');
	await ended;
}

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

/** The chat once the native tool has written its conversation, which it does a moment after tmux starts it. */
async function conversation(harness: 'pi' | 'opencode') {
	let events = await chat();
	const deadline = Date.now() + 15_000;
	while (!events.some((event) => event.type === 'records') && Date.now() < deadline) {
		await new Promise((resolve) => setTimeout(resolve, 250));
		events = await chat();
	}
	// A later session event supersedes the one the feed held before this page connected.
	expect(events.findLast((event) => event.type === 'session')?.data).toMatchObject({
		state: 'ours',
		harness,
		canSend: true
	});
	return fold(events.filter((event) => event.type === 'records').flatMap((event) => event.data));
}

it('delivers native Pi messages through the normal chat, then reconnects to the same primary', async () => {
	prepare('pi', PI);
	await start('pi');
	for (let pass = 0; pass < 2; pass++) {
		const { items } = await conversation('pi');
		expect(items).toHaveLength(2);
		expect(items[0]).toMatchObject({ kind: 'user', text: 'Check the native chat.' });
		expect(items[1]).toMatchObject({
			kind: 'turn',
			done: true,
			parts: [{ kind: 'text', text: 'Native chat works.' }]
		});
		if (pass === 0) {
			await stop();
			await start('pi');
		}
	}
});

it('delivers native OpenCode messages and command activity through the normal chat, then reconnects to the same primary', async () => {
	prepare('opencode', OPENCODE);
	await start('opencode');
	for (let pass = 0; pass < 2; pass++) {
		const { items } = await conversation('opencode');
		expect(items).toHaveLength(2);
		expect(items[0]).toMatchObject({ kind: 'user', text: 'Check the native chat.' });
		expect(items[1]).toMatchObject({
			kind: 'turn',
			done: true,
			durationMs: 899,
			parts: [
				{ kind: 'activity', steps: [{ kind: 'tool', result: 'native-ok', isError: false }] },
				{ kind: 'text', text: 'Native chat works.' }
			]
		});
		if (pass === 0) {
			await stop();
			await start('opencode');
		}
	}
});
