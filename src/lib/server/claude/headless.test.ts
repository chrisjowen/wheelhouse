import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
	claudeArgs,
	readLine,
	runClaude,
	type ClaudeEvent,
	type ClaudeRunConfig
} from './headless';

const FAKE = path.resolve('tests/helpers/fake-claude.mjs');

let root: string;
beforeEach(async () => {
	root = await mkdtemp(path.join(tmpdir(), 'wh-claude-'));
});
afterEach(async () => {
	await rm(root, { recursive: true, force: true });
});

const config = (over: Partial<ClaudeRunConfig> = {}): ClaudeRunConfig => ({
	bin: FAKE,
	model: 'sonnet',
	effort: 'low',
	systemPrompt: 'Interview.',
	tools: [],
	cwd: root,
	...over
});

describe('claudeArgs', () => {
	it('runs headless, streaming, without the captain’s settings, and only ever read-only tools', () => {
		const args = claudeArgs(config({ tools: ['Read', 'Bash', 'Edit', 'Grep'] }));
		expect(args.slice(0, 5)).toEqual([
			'-p',
			'--output-format',
			'stream-json',
			'--verbose',
			'--include-partial-messages'
		]);
		expect(args).toContain('--no-session-persistence');
		expect(args[args.indexOf('--model') + 1]).toBe('sonnet');
		expect(args[args.indexOf('--effort') + 1]).toBe('low');
		expect(args[args.indexOf('--tools') + 1]).toBe('Read,Grep');
		expect(args[args.indexOf('--setting-sources') + 1]).toBe('');
		expect(args.join(' ')).not.toMatch(/Bash|Edit|dangerously|allowedTools|permission-mode/);
	});

	it('offers no tools at all when none are given', () => {
		const args = claudeArgs(config());
		expect(args[args.indexOf('--tools') + 1]).toBe('');
	});
});

describe('readLine', () => {
	it('reads streamed text, new messages, tool use and the result', () => {
		const events: ClaudeEvent[] = [];
		const emit = (e: ClaudeEvent) => events.push(e);
		readLine('{"type":"stream_event","event":{"type":"message_start"}}', emit);
		readLine(
			'{"type":"stream_event","event":{"type":"content_block_delta","delta":{"type":"text_delta","text":"Hi"}}}',
			emit
		);
		readLine(
			'{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Read","input":{"file_path":"src/app.ts"}}]}}',
			emit
		);
		expect(readLine('not json', emit)).toBeNull();
		expect(events).toEqual([
			{ type: 'message' },
			{ type: 'text', text: 'Hi' },
			{ type: 'tool', name: 'Read', detail: 'src/app.ts' }
		]);
		expect(
			readLine(
				'{"type":"result","subtype":"success","is_error":false,"result":"Done","total_cost_usd":0.5,"usage":{"input_tokens":10,"cache_read_input_tokens":5,"output_tokens":3}}',
				emit
			)
		).toEqual({
			result: { ok: true, text: 'Done', usage: { inputTokens: 15, outputTokens: 3, costUsd: 0.5 } }
		});
	});

	it('reads an error result as a failure with its message', () => {
		expect(
			readLine(
				'{"type":"result","subtype":"success","is_error":true,"result":"Invalid API key"}',
				() => {}
			)
		).toEqual({
			result: {
				ok: false,
				message: 'Invalid API key',
				usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 }
			}
		});
	});
});

describe('runClaude', () => {
	it('streams the answer and returns it with its usage', async () => {
		const argsFile = path.join(root, 'args.jsonl');
		let streamed = '';
		const r = await runClaude(config(), {
			prompt: 'Captain: Shared albums\n',
			env: { ...process.env, FAKE_CLAUDE_ARGS_FILE: argsFile },
			timeoutMs: 20_000,
			onEvent: (e) => {
				if (e.type === 'text') streamed += e.text;
			}
		});
		expect(r.ok).toBe(true);
		if (!r.ok) return;
		expect(streamed).toBe(r.text);
		expect(r.text).toContain('===SPEC===');
		expect(r.usage).toEqual({ inputTokens: 2000, outputTokens: 150, costUsd: 0.0123 });
		const args = JSON.parse((await readFile(argsFile, 'utf8')).trim()) as string[];
		expect(args).toEqual(claudeArgs(config()));
	});

	it('reports a sign-in failure plainly, with the CLI’s own words', async () => {
		const r = await runClaude(config(), { prompt: 'FAKE_CLAUDE_FAIL', timeoutMs: 20_000 });
		expect(r.ok).toBe(false);
		if (r.ok) return;
		expect(r.message).toMatch(/^Claude could not sign in\. .*\/login/);
		expect(r.message).toContain('Invalid API key · Fix external API key');
	});

	it('uses the claude.ai login, not an API key in the environment', async () => {
		const r = await runClaude(config(), {
			prompt: 'Captain: Shared albums\n',
			env: { ...process.env, ANTHROPIC_API_KEY: 'bad', ANTHROPIC_AUTH_TOKEN: 'bad' },
			timeoutMs: 20_000
		});
		expect(r.ok).toBe(true);
	});

	it('keeps the API key when WHEELHOUSE_CLAUDE_USE_API_KEY=1', async () => {
		const r = await runClaude(config(), {
			prompt: 'Captain: Shared albums\n',
			env: { ...process.env, ANTHROPIC_API_KEY: 'bad', WHEELHOUSE_CLAUDE_USE_API_KEY: '1' },
			timeoutMs: 20_000
		});
		expect(r.ok).toBe(false);
		if (!r.ok) expect(r.message).toMatch(/API key \(WHEELHOUSE_CLAUDE_USE_API_KEY=1\)/);
	});

	it('says how to fix a missing claude CLI', async () => {
		const r = await runClaude(config({ bin: path.join(root, 'no-such-claude') }), {
			prompt: 'x',
			timeoutMs: 5_000
		});
		expect(r.ok).toBe(false);
		if (!r.ok) expect(r.message).toMatch(/Could not find the claude CLI .*WHEELHOUSE_CLAUDE_BIN/);
	});

	it('stops when asked', async () => {
		const ctl = new AbortController();
		const run = runClaude(config(), {
			prompt: 'Captain: x\n',
			env: { ...process.env, FAKE_CLAUDE_DELAY_MS: '200' },
			timeoutMs: 20_000,
			signal: ctl.signal
		});
		setTimeout(() => ctl.abort(), 100);
		expect(await run).toMatchObject({ ok: false, message: 'Stopped.' });
	});
});
