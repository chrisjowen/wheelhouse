import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
	GROK_HELPER_MODEL,
	ask,
	grokArgs,
	helperArgs,
	readPage,
	summariseFeedback,
	type HelperDeps
} from './previewhelper';
import { SUMMARY_SCHEMA, SUMMARY_SYSTEM } from '../previewhelper';
import type { RunOptions, RunResult } from './firstmate/exec';
import type { HelperContext } from '../previewhelper';

const ctx: HelperContext = {
	task: { id: 'lumen-share', title: 'Share links', project: 'Lumen', status: 'needs-review' },
	preview: { url: 'http://127.0.0.1:5240/', text: 'Share' },
	brief: null,
	history: [],
	screenshots: [{ name: 'a.png', file: '/data/lumen-share/shots/a.png' }]
};
const req = {
	turns: [{ who: 'captain' as const, text: '7 days feels short' }],
	list: ['Turn downloads off']
};

const ok = (stdout: string): RunResult => ({ ok: true, stdout, stderr: '', durationMs: 5 });

function deps(
	result: RunResult,
	env: NodeJS.ProcessEnv = {}
): HelperDeps & { calls: [string, string[], RunOptions][] } {
	const calls: [string, string[], RunOptions][] = [];
	return {
		calls,
		env,
		run: async (file, args, opts) => {
			calls.push([file, args, opts]);
			return result;
		},
		fetch: vi.fn() as unknown as typeof fetch,
		find: (name) => (name === 'claude' ? '/bin/claude' : null)
	};
}

describe('the preview helper run', () => {
	it('runs claude with no session, settings or MCP, reading only the screenshots, and answers', async () => {
		const d = deps(
			ok(
				JSON.stringify({
					structured_output: {
						reply: 'The brief says 7 days. I would put it as:',
						suggest: ['Make links last 30 days by default', 'turn downloads off']
					}
				})
			)
		);
		const r = await ask(ctx, req, d);
		// A line already on the list is not suggested again.
		expect(r).toEqual({
			ok: true,
			value: {
				reply: 'The brief says 7 days. I would put it as:',
				suggest: ['Make links last 30 days by default']
			}
		});
		const [file, args, opts] = d.calls[0];
		expect(file).toBe('/bin/claude');
		expect(args).toEqual(helperArgs('sonnet', ['/data/lumen-share/shots']));
		expect(args).toContain('--no-session-persistence');
		expect(args).toContain('--strict-mcp-config');
		expect(args.slice(args.indexOf('--tools'), args.indexOf('--tools') + 2)).toEqual([
			'--tools',
			'Read'
		]);
		expect(opts.input).toContain('Captain: 7 days feels short');
	});

	it('takes the binary and model from the environment, and says plainly when there is none', async () => {
		const d = deps(ok(JSON.stringify({ structured_output: { reply: 'Hi', suggest: [] } })), {
			WHEELHOUSE_PREVIEW_CLAUDE: '/opt/fake-claude',
			WHEELHOUSE_PREVIEW_MODEL: 'haiku'
		});
		await ask(ctx, req, d);
		expect(d.calls[0][0]).toBe('/opt/fake-claude');
		expect(d.calls[0][1][2]).toBe('haiku');
		const none = { ...deps(ok('')), find: () => null };
		expect(await ask(ctx, req, none)).toMatchObject({ ok: false, status: 503 });
	});

	it('reports a run that failed or answered nothing readable', async () => {
		const failed: RunResult = {
			ok: false,
			kind: 'timeout',
			code: null,
			signal: null,
			stdout: '',
			stderr: '',
			message: 'timed out',
			durationMs: 120000
		};
		expect(await ask(ctx, req, deps(failed))).toEqual({
			ok: false,
			status: 502,
			error: 'The preview helper took too long to answer. Try again.'
		});
		expect(await ask(ctx, req, deps(ok('garbage')))).toMatchObject({ ok: false, status: 502 });
	});
});

describe('readPage', () => {
	it('reads only a loopback page that answers with HTML', async () => {
		const html = vi.fn(
			async () => new Response('<h1>Share</h1>', { headers: { 'content-type': 'text/html' } })
		) as unknown as typeof fetch;
		expect(await readPage('http://127.0.0.1:5240/', { fetch: html })).toBe('Share');
		expect(await readPage('https://example.com/', { fetch: html })).toBeNull();
		expect(html).toHaveBeenCalledTimes(1);
		const json = (async () =>
			new Response('{}', {
				headers: { 'content-type': 'application/json' }
			})) as unknown as typeof fetch;
		expect(await readPage('http://127.0.0.1:5240/', { fetch: json })).toBeNull();
	});
});

describe('the preview helper’s summary of a feedback list', () => {
	const list = {
		task: { id: 'lumen-checkout', title: 'Checkout' },
		subject: 'the shared review “Checkout”',
		items: [
			{ text: 'Ana: Bigger button', points: 'the “Pay now” button' },
			{ text: 'Ben: Agreed, bigger', points: null }
		]
	};

	it('runs the same claude with its own instructions and shape, and no tools', async () => {
		const d = deps(
			ok(
				JSON.stringify({
					structured_output: {
						points: [
							{
								text: 'Make the Pay now button bigger',
								points: 'the “Pay now” button',
								from: [1, 2]
							}
						]
					}
				})
			)
		);
		expect(await summariseFeedback(list, d)).toEqual({
			ok: true,
			points: [
				{ text: 'Make the Pay now button bigger', points: 'the “Pay now” button', from: [1, 2] }
			]
		});
		const [file, args, opts] = d.calls[0];
		expect(file).toBe('/bin/claude');
		expect(args).toEqual(
			helperArgs('sonnet', [], { system: SUMMARY_SYSTEM, schema: SUMMARY_SCHEMA, read: false })
		);
		expect(args.slice(args.indexOf('--tools'), args.indexOf('--tools') + 2)).toEqual([
			'--tools',
			''
		]);
		expect(args).not.toContain('--add-dir');
		expect(args).toContain('--no-session-persistence');
		expect(opts.input).toContain('1. Ana: Bigger button');
	});

	it('says why when claude is missing, fails, or answers with no points', async () => {
		const none = { ...deps(ok('')), find: () => null };
		expect(await summariseFeedback(list, none)).toMatchObject({ ok: false, status: 503 });
		const failed = deps({
			ok: false,
			kind: 'timeout',
			stdout: '',
			stderr: ''
		} as unknown as RunResult);
		expect(await summariseFeedback(list, failed)).toMatchObject({
			ok: false,
			status: 502,
			error: 'The preview helper took too long to answer. Try again.'
		});
		const empty = deps(ok(JSON.stringify({ structured_output: { points: [] } })));
		expect(await summariseFeedback(list, empty)).toMatchObject({
			ok: false,
			status: 502,
			error: 'The preview helper’s summary could not be read. Try again.'
		});
	});
});

describe('a Grok helper run', () => {
	const grokReply = JSON.stringify({
		structuredOutput: { reply: 'The brief says 7 days.', suggest: ['Make links last 30 days'] },
		text: '{"reply":"The brief says 7 days.","suggest":["Make links last 30 days"]}'
	});

	function saved(helper: 'same' | 'claude' | 'grok' | null, harness = 'grok'): string {
		const dir = mkdtempSync(path.join(tmpdir(), 'wh-helper-choice-'));
		const body: Record<string, string> = { harness };
		if (helper) body.helper = helper;
		writeFileSync(path.join(dir, 'harness.json'), JSON.stringify(body));
		return dir;
	}

	function grokDeps(result: RunResult, env: NodeJS.ProcessEnv) {
		const calls: [string, string[], RunOptions][] = [];
		let prompt = '';
		let home = '';
		let auth: string | null = null;
		const d: HelperDeps & { calls: [string, string[], RunOptions][] } = {
			calls,
			env,
			run: async (file, args, opts) => {
				calls.push([file, args, opts]);
				const promptFile = args[args.indexOf('--prompt-file') + 1];
				prompt = readFileSync(promptFile, 'utf8');
				home = opts.env?.GROK_HOME ?? '';
				const authFile = path.join(home, 'auth.json');
				auth = existsSync(authFile) ? readFileSync(authFile, 'utf8') : null;
				expect(existsSync(home)).toBe(true);
				expect(existsSync(promptFile)).toBe(true);
				return result;
			},
			fetch: vi.fn() as unknown as typeof fetch,
			find: (name) => (name === 'claude' || name === 'grok' ? `/bin/${name}` : null)
		};
		return { d, calls, prompt: () => prompt, home: () => home, auth: () => auth };
	}

	it('runs Grok when the helper is Grok, even while Firstmate runs in Claude Code', async () => {
		const config = saved('grok', 'claude');
		const { d, calls } = grokDeps(ok(grokReply), {
			WHEELHOUSE_CONFIG_DIR: config,
			WHEELHOUSE_HARNESS: 'claude'
		});
		const r = await ask(ctx, req, d);
		expect(r.ok).toBe(true);
		expect(calls[0][0]).toBe('/bin/grok');
		rmSync(config, { recursive: true, force: true });
	});

	it('runs Grok when the choice follows a Grok agent, and removes the throwaway home', async () => {
		const config = saved('same');
		const shot = path.join(config, 'a.png');
		writeFileSync(shot, 'png');
		const { d, calls, prompt, home, auth } = grokDeps(ok(grokReply), {
			WHEELHOUSE_CONFIG_DIR: config,
			WHEELHOUSE_HARNESS: 'grok',
			WHEELHOUSE_PREVIEW_CLAUDE: '/opt/fake-claude'
		});
		const r = await ask({ ...ctx, screenshots: [{ name: 'a.png', file: shot }] }, req, d);
		expect(r).toEqual({
			ok: true,
			value: { reply: 'The brief says 7 days.', suggest: ['Make links last 30 days'] }
		});
		const [file, args, opts] = calls[0];
		expect(file).toBe('/bin/grok');
		expect(opts.input).toBeUndefined();
		expect(opts.cwd).toBe(path.join(path.dirname(home()), 'work'));
		expect(opts.env?.GROK_HOME).toBe(home());
		expect(opts.env?.GROK_SANDBOX).toBe('read-only');
		expect(opts.env?.GROK_CLAUDE_HOOKS_ENABLED).toBe('0');
		expect(auth()).toBeNull();
		const promptFile = args[args.indexOf('--prompt-file') + 1];
		expect(args).toEqual([
			'--cwd',
			opts.cwd,
			...grokArgs(GROK_HELPER_MODEL, promptFile, path.join(path.dirname(home()), 'leader.sock'))
		]);
		expect(args[args.indexOf('--sandbox') + 1]).toBe('read-only');
		expect(args[args.indexOf('--permission-mode') + 1]).toBe('default');
		expect(args[args.indexOf('--max-turns') + 1]).toBe('6');
		expect(args[args.indexOf('--tools') + 1]).toBe('read_file');
		expect(args.join('\n')).toContain('your file-reading tool');
		expect(args).not.toContain('--add-dir');
		expect(args).not.toContain('--trust');
		expect(args).not.toContain('sonnet');
		expect(prompt()).toContain(path.join(opts.cwd ?? '', 'shots', '0-a.png'));
		expect(prompt()).not.toContain(shot);
		expect(existsSync(shot)).toBe(true);
		expect(existsSync(home())).toBe(false);
		expect(existsSync(promptFile)).toBe(false);
		rmSync(config, { recursive: true, force: true });
	});

	it('copies a sign-in into the throwaway home and does not guess one', async () => {
		const config = saved('same');
		const fakeHome = mkdtempSync(path.join(tmpdir(), 'wh-helper-grok-'));
		mkdirSync(path.join(fakeHome, '.grok'));
		writeFileSync(path.join(fakeHome, '.grok', 'auth.json'), 'token', { mode: 0o600 });
		const copied = grokDeps(ok(grokReply), {
			HOME: fakeHome,
			WHEELHOUSE_CONFIG_DIR: config,
			WHEELHOUSE_HARNESS: 'grok'
		});
		await ask(ctx, req, copied.d);
		expect(copied.auth()).toBe('token');
		expect(existsSync(copied.home())).toBe(false);
		const bare = grokDeps(ok(grokReply), {
			WHEELHOUSE_CONFIG_DIR: config,
			WHEELHOUSE_HARNESS: 'grok'
		});
		await ask(ctx, req, bare.d);
		expect(bare.auth()).toBeNull();
		rmSync(config, { recursive: true, force: true });
		rmSync(fakeHome, { recursive: true, force: true });
	});

	it('stays on Claude Code with no field, with Claude chosen, and for an agent with no helper', async () => {
		for (const [helper, harness] of [
			[null, 'grok'],
			['claude', 'grok'],
			['same', 'codex']
		] as const) {
			const config = saved(helper, harness);
			const d = deps(ok(JSON.stringify({ structured_output: { reply: 'Hi', suggest: [] } })), {
				WHEELHOUSE_CONFIG_DIR: config,
				WHEELHOUSE_HARNESS: harness
			});
			d.find = (name) => (name === 'claude' || name === 'grok' ? `/bin/${name}` : null);
			await ask(ctx, req, d);
			expect(d.calls[0][0]).toBe('/bin/claude');
			expect(d.calls[0][1]).toContain('--no-session-persistence');
			rmSync(config, { recursive: true, force: true });
		}
	});

	it('summarises with no tools, and refuses an answer whose sandbox was not enforced', async () => {
		const config = saved('same');
		const env = { WHEELHOUSE_CONFIG_DIR: config, WHEELHOUSE_HARNESS: 'grok' };
		const summary = grokDeps(
			ok(
				JSON.stringify({
					structuredOutput: { points: [{ text: 'Bigger', points: '', from: [1] }] }
				})
			),
			env
		);
		const list = {
			task: { id: 'lumen-checkout', title: 'Checkout' },
			subject: null,
			items: [{ text: 'Bigger', points: null }]
		};
		expect(await summariseFeedback(list, summary.d)).toMatchObject({ ok: true });
		const args = summary.calls[0][1];
		expect(args[args.indexOf('--max-turns') + 1]).toBe('2');
		expect(args[args.indexOf('--disallowed-tools') + 1]).toContain('read_file');
		expect(args.slice(args.lastIndexOf('--deny'))).toEqual(['--deny', 'Read']);
		const open = grokDeps(
			{
				ok: true,
				stdout: grokReply,
				stderr: 'sandbox continues without enforcement',
				durationMs: 1
			},
			env
		);
		expect(await ask(ctx, req, open.d)).toEqual({
			ok: false,
			status: 502,
			error: 'The preview helper’s sandbox was not enforced, so its answer was not used. Try again.'
		});
		expect(existsSync(open.home())).toBe(false);
		const none = grokDeps(ok(grokReply), env);
		none.d.find = () => null;
		expect(await ask(ctx, req, none.d)).toEqual({
			ok: false,
			status: 503,
			error: 'Grok (`grok`) is not installed or not on PATH, so the preview helper cannot answer.'
		});
		rmSync(config, { recursive: true, force: true });
	});
});
