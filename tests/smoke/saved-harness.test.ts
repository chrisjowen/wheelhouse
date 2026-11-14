import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

/**
 * A server started the way a launcher from before 0.18.0 restarts one: the
 * agent variable is the old choice, nothing marks it fixed, and harness.json
 * holds the choice the setup screen saved. The server reads that file itself.
 * A flag or WHEELHOUSE_HARNESS that fixed the agent (WHEELHOUSE_HARNESS_FIXED=1)
 * still wins. Never the captain's Wheelhouse, config, or tmux server.
 */

const CLI = path.resolve('dist/cli.js');
const roots: string[] = [];
const children: ChildProcess[] = [];

afterEach(async () => {
	await Promise.all(children.splice(0).map((child) => stop(child)));
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function stop(child: ChildProcess): Promise<void> {
	if (child.exitCode !== null || child.signalCode) return Promise.resolve();
	return new Promise((resolve) => {
		const kill = setTimeout(() => child.kill('SIGKILL'), 3000);
		child.once('exit', () => {
			clearTimeout(kill);
			resolve();
		});
		child.kill('SIGTERM');
	});
}

async function server(fixed: string | undefined): Promise<{ port: number; file: string }> {
	if (!existsSync(CLI) || !existsSync(path.resolve('build/handler.js'))) {
		throw new Error('Run `npm run build` before this smoke test (or use `npm run test:smoke`).');
	}
	const root = mkdtempSync(path.join(tmpdir(), 'wh-saved-harness-'));
	roots.push(root);
	const config = path.join(root, 'config');
	const state = path.join(root, 'state');
	const plugins = path.join(root, 'plugins');
	mkdirSync(config);
	mkdirSync(state);
	mkdirSync(plugins);
	const file = path.join(config, 'harness.json');
	writeFileSync(
		file,
		`${JSON.stringify({ harness: 'grok', auth: 'subscription', provider: 'grok' })}\n`
	);
	const env: NodeJS.ProcessEnv = {
		HOME: root,
		PATH: '/usr/bin:/bin',
		LANG: 'C',
		TERM: 'xterm-256color',
		TMPDIR: root,
		WHEELHOUSE_CONFIG_DIR: config,
		WHEELHOUSE_STATE_DIR: state,
		WHEELHOUSE_PLUGINS_DIR: plugins,
		WHEELHOUSE_HARNESS: 'claude',
		WHEELHOUSE_RESTARTED: '1',
		WHEELHOUSE_NO_GH: '1',
		WHEELHOUSE_NO_USAGE: '1',
		WHEELHOUSE_NM_EVIDENCE_DIR: path.join(root, 'none'),
		WHEELHOUSE_NM_LOGS_DIR: path.join(root, 'none'),
		TMUX: '',
		TMUX_TMPDIR: root,
		WHEELHOUSE_TMUX_SOCKET: `wh-saved-${process.pid}-${roots.length}`
	};
	if (fixed !== undefined) env.WHEELHOUSE_HARNESS_FIXED = fixed;
	let output = '';
	const child = spawn(process.execPath, [CLI, '__server', '--port', '0'], {
		cwd: root,
		stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
		env
	});
	children.push(child);
	child.stdout?.on('data', (d) => (output += d));
	child.stderr?.on('data', (d) => (output += d));
	const port = await new Promise<number>((resolve, reject) => {
		const timer = setTimeout(
			() => reject(new Error(`server did not listen; output:\n${output}`)),
			30_000
		);
		child.once('exit', (code) => {
			clearTimeout(timer);
			reject(new Error(`server exited ${code} before it was ready; output:\n${output}`));
		});
		child.on('message', (msg: unknown) => {
			if (
				typeof msg === 'object' &&
				msg !== null &&
				(msg as { type?: unknown }).type === 'ready' &&
				typeof (msg as { port?: unknown }).port === 'number'
			) {
				clearTimeout(timer);
				resolve((msg as { port: number }).port);
			}
		});
	});
	expect(port).not.toBe(4310);
	return { port, file };
}

async function setup(port: number): Promise<{ harness: string; agent: string }> {
	const res = await fetch(`http://127.0.0.1:${port}/api/setup`);
	expect(res.status).toBe(200);
	const body = (await res.json()) as {
		tool?: { harness?: string };
		agent?: { choice?: { agent?: string } | null };
	};
	return { harness: body.tool?.harness ?? '', agent: body.agent?.choice?.agent ?? '' };
}

describe('a restarted server and the saved agent', () => {
	it('uses the saved choice when an old launcher passed a stale agent and did not fix it', async () => {
		const started = await server(undefined);
		expect(await setup(started.port)).toEqual({ harness: 'grok', agent: 'grok' });
		expect(readFileSync(started.file, 'utf8')).toContain('"harness":"grok"');
	});

	it('uses the saved choice when the launcher says the agent is not fixed', async () => {
		const started = await server('0');
		expect(await setup(started.port)).toEqual({ harness: 'grok', agent: 'grok' });
	});

	it('keeps an agent fixed by flag or variable ahead of the saved choice', async () => {
		const started = await server('1');
		expect(await setup(started.port)).toEqual({ harness: 'claude', agent: 'claude' });
		expect(readFileSync(started.file, 'utf8')).toContain('"harness":"grok"');
	});
});
