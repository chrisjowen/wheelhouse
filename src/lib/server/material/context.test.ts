import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sessionSettings } from '../sessions/agents/claude';
import { codexArgv } from '../sessions/agents/codex';
import { piExtensionSource } from '../sessions/pi';
import { sessionContext } from './bundle';
import { CONTEXT_MAX_BYTES, contextFileFor, contextHarness, hookOutput } from './context';

let root: string;
let hook: string;
let context: string;
beforeEach(() => {
	root = mkdtempSync(path.join(tmpdir(), 'wh-context-test-'));
	hook = path.join(root, 'session-start.json');
	context = contextFileFor(hook);
});
afterEach(() => {
	vi.unstubAllEnvs();
	rmSync(root, { recursive: true, force: true });
});

const longest = sessionContext({
	reviewSurface: { id: 'a-review-plugin', name: 'R'.repeat(200), repository: 'org/repo' },
	version: '10.20.30',
	url: 'http://127.0.0.1:65535/'
});

describe('the session context', () => {
	it('is SessionStart hook output with the context under 2 KB, whatever the review surface', () => {
		for (const text of [
			longest,
			sessionContext({ reviewSurface: null, version: '1.0.0', url: null })
		]) {
			const out = JSON.parse(hookOutput(text));
			expect(out).toEqual({
				hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: text }
			});
			expect(Buffer.byteLength(text)).toBeLessThan(CONTEXT_MAX_BYTES);
		}
	});

	it('names the Wheelhouse, the review surface and the formats it renders', () => {
		const built = sessionContext({
			reviewSurface: null,
			version: '1.2.3',
			url: 'http://127.0.0.1:4310/'
		});
		expect(built).toContain('Wheelhouse 1.2.3 at http://127.0.0.1:4310/');
		expect(built).toContain('built-in');
		for (const format of ['<!-- project:', 'decision-form', 'vault-request', 'fm-inbox.sh reply'])
			expect(built).toContain(format);
		const plugin = sessionContext({
			reviewSurface: { id: 'human-review', name: 'Human Review' },
			version: '1.2.3',
			url: null
		});
		expect(plugin).toContain('Human Review (the `human-review` plugin)');
		expect(plugin).not.toContain(' at ');
	});

	it('goes to Claude Code always, and to Codex and Pi only when the flag names them', () => {
		expect(contextHarness('claude', {})).toBe(true);
		expect(contextHarness('codex', {})).toBe(false);
		expect(contextHarness('pi', { WHEELHOUSE_SESSION_CONTEXT: 'codex' })).toBe(false);
		expect(contextHarness('codex', { WHEELHOUSE_SESSION_CONTEXT: 'codex,pi' })).toBe(true);
		expect(contextHarness('pi', { WHEELHOUSE_SESSION_CONTEXT: 'codex pi' })).toBe(true);
		expect(contextHarness('opencode', { WHEELHOUSE_SESSION_CONTEXT: 'opencode' })).toBe(false);
	});
});

describe('the start hooks that carry it', () => {
	const record = JSON.stringify({ session_id: 's1', transcript_path: '/t.jsonl' });

	it('Claude Code’s hook records its input and prints the context file, or nothing without one', () => {
		const command = JSON.parse(sessionSettings(hook, true)).hooks.SessionStart[0].hooks[0].command;
		const run = () => execFileSync('bash', ['-c', command], { input: record, encoding: 'utf8' });
		expect(run()).toBe('');
		expect(JSON.parse(readFileSync(hook, 'utf8'))).toEqual(JSON.parse(record));
		writeFileSync(context, hookOutput(longest));
		const out = JSON.parse(run());
		expect(out.hookSpecificOutput.additionalContext).toBe(longest);
		expect(JSON.parse(readFileSync(hook, 'utf8'))).toEqual(JSON.parse(record));
	});

	it('Codex’s hook prints it only when its launch names the file', () => {
		const command = JSON.parse(/command=(.*),timeout=10/.exec(codexArgv('/bin/codex')[4])![1]);
		writeFileSync(context, hookOutput(longest));
		const env = { ...process.env, WH_SESSION_RECORD: hook, WH_SESSION_NONCE: 'n1' };
		const run = (more: Record<string, string>) =>
			execFileSync('bash', ['-c', command], {
				input: record,
				env: { ...env, ...more },
				encoding: 'utf8'
			});
		expect(run({})).toBe('');
		expect(
			JSON.parse(run({ WH_SESSION_CONTEXT: context })).hookSpecificOutput.additionalContext
		).toBe(longest);
		expect(JSON.parse(readFileSync(hook, 'utf8')).wheelhouse_nonce).toBe('n1');
	});

	it('Pi’s extension gives each run the context as a system prompt section', async () => {
		const extension = path.join(root, 'extension.mjs');
		writeFileSync(extension, piExtensionSource());
		writeFileSync(context, hookOutput(longest));
		vi.stubEnv('WH_SESSION_CONTEXT', context);
		const handlers = new Map<string, (event: unknown) => void>();
		const loaded = await import(/* @vite-ignore */ pathToFileURL(extension).href);
		loaded.default({ on: (name: string, h: (event: unknown) => void) => handlers.set(name, h) });
		const event = { systemPromptOptions: { sections: {} as Record<string, string> } };
		handlers.get('before_agent_start')!(event);
		expect(event.systemPromptOptions.sections.wheelhouse).toBe(longest);
		rmSync(context);
		const later = { systemPromptOptions: { sections: {} as Record<string, string> } };
		handlers.get('before_agent_start')!(later);
		expect(later.systemPromptOptions.sections).toEqual({});
	});
});
