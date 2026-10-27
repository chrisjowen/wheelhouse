import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { agentArgs, agentEnv, runAgent, StreamReader } from './agent';

const FAKE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'testdata', 'fake-claude.mjs');

const opts = (env: NodeJS.ProcessEnv = {}) => {
	const dir = mkdtempSync(path.join(tmpdir(), 'wh-agent-'));
	return {
		log: path.join(dir, 'calls.jsonl'),
		o: {
			bin: FAKE,
			model: 'sonnet',
			effort: 'low',
			maxBudgetUsd: 0.5,
			timeoutMs: 20_000,
			cwd: dir,
			env: { ...process.env, FAKE_CLAUDE_LOG: path.join(dir, 'calls.jsonl'), ...env }
		}
	};
};

describe('agentArgs', () => {
	it('runs headless and read-only: no tools, no MCP, no customisations, no saved session', () => {
		const a = agentArgs({ model: 'haiku', effort: 'low', maxBudgetUsd: 1, system: 'S' });
		expect(a.slice(0, 1)).toEqual(['-p']);
		expect(a[a.indexOf('--tools') + 1]).toBe('');
		expect(a).toContain('--strict-mcp-config');
		expect(a).toContain('--safe-mode');
		expect(a).toContain('--no-session-persistence');
		expect(a).toContain('--disable-slash-commands');
		expect(a[a.indexOf('--model') + 1]).toBe('haiku');
		expect(a[a.indexOf('--effort') + 1]).toBe('low');
		expect(a[a.indexOf('--max-budget-usd') + 1]).toBe('1');
		expect(a[a.indexOf('--output-format') + 1]).toBe('stream-json');
		expect(a.some((x) => /permission|allowedTools|dangerously/i.test(x))).toBe(false);
	});

	it('drops a surrounding Claude Code session’s variables', () => {
		const e = agentEnv({
			PATH: '/bin',
			CLAUDECODE: '1',
			CLAUDE_CODE_ENTRYPOINT: 'cli',
			ANTHROPIC_API_KEY: 'k'
		});
		expect(e).toEqual({ PATH: '/bin' });
	});

	it('keeps a claude.ai login token from claude setup-token', () => {
		const e = agentEnv({
			PATH: '/bin',
			CLAUDECODE: '1',
			CLAUDE_CODE_ENTRYPOINT: 'cli',
			CLAUDE_CODE_OAUTH_TOKEN: 'oauth',
			ANTHROPIC_API_KEY: 'k'
		});
		expect(e).toEqual({ PATH: '/bin', CLAUDE_CODE_OAUTH_TOKEN: 'oauth' });
	});

	it('drops the API key so the claude.ai login is used, unless asked to keep it', () => {
		const base = { HOME: '/h', USER: 'u', ANTHROPIC_API_KEY: 'k', ANTHROPIC_AUTH_TOKEN: 't' };
		expect(agentEnv(base)).toEqual({ HOME: '/h', USER: 'u' });
		expect(agentEnv({ ...base, WHEELHOUSE_CLAUDE_USE_API_KEY: '1' })).toEqual({
			...base,
			WHEELHOUSE_CLAUDE_USE_API_KEY: '1'
		});
	});
});

describe('StreamReader', () => {
	it('streams text deltas and keeps the result line, across split chunks', () => {
		const got: string[] = [];
		const r = new StreamReader((d) => got.push(d));
		const lines = [
			{
				type: 'stream_event',
				event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Hel' } }
			},
			{
				type: 'stream_event',
				event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'lo' } }
			},
			{ type: 'assistant', message: { content: [{ type: 'text', text: 'Hello' }] } },
			{ type: 'result', result: 'Hello', total_cost_usd: 0.01 }
		]
			.map((l) => JSON.stringify(l))
			.join('\n');
		r.push(lines.slice(0, 40));
		r.push(lines.slice(40));
		r.end();
		expect(got).toEqual(['Hel', 'lo']);
		expect(r.text).toBe('Hello');
		expect(r.result?.total_cost_usd).toBe(0.01);
	});

	it('uses the whole message when no partial messages come', () => {
		const r = new StreamReader(() => {});
		r.push(
			JSON.stringify({
				type: 'assistant',
				message: { content: [{ type: 'text', text: 'Whole' }] }
			}) + '\n'
		);
		expect(r.text).toBe('Whole');
	});
});

describe('runAgent', () => {
	it('passes the prompt on stdin and returns the answer with its usage', async () => {
		const { o, log } = opts();
		const deltas: string[] = [];
		const r = await runAgent("Q?\n## The captain's question\nWhy?", 'SYSTEM', o, {
			onText: (d) => deltas.push(d)
		});
		expect(r).toMatchObject({ ok: true, text: 'You asked: **Why?**. The records say [I1].' });
		expect(deltas.join('')).toBe(r.text);
		expect(deltas.length).toBe(3);
		expect(r.usage).toEqual({
			costUsd: 0.0123,
			inputTokens: 1200,
			outputTokens: 80,
			cachedTokens: 300,
			durationMs: 2100,
			model: 'claude-sonnet-5'
		});
		const call = JSON.parse(readFileSync(log, 'utf8').trim());
		expect(call.input).toContain('Why?');
		expect(call.args[call.args.indexOf('--system-prompt') + 1]).toBe('SYSTEM');
	});

	it('reports the CLI’s own error', async () => {
		const { o } = opts({ FAKE_CLAUDE_MODE: 'error' });
		const r = await runAgent('x', 'S', o, { onText: () => {} });
		expect(r).toMatchObject({
			ok: false,
			stopped: false,
			error: 'The review agent failed: Invalid API key'
		});
	});

	it('says plainly when the CLI is not there', async () => {
		const { o } = opts();
		const r = await runAgent('x', 'S', { ...o, bin: '/nonexistent/claude' }, { onText: () => {} });
		expect(r.ok).toBe(false);
		if (!r.ok) expect(r.error).toMatch(/Could not start \/nonexistent\/claude/);
	});

	it('stops when asked', async () => {
		const { o } = opts({ FAKE_CLAUDE_MODE: 'slow' });
		const c = new AbortController();
		const p = runAgent('x', 'S', o, { onText: () => c.abort(), signal: c.signal });
		const r = await p;
		expect(r).toMatchObject({ ok: false, stopped: true });
	});
});
