import { mkdirSync } from 'node:fs';
import type { ClaudeStatus, DepItem } from '../../setup';
import { runBounded } from '../firstmate/exec';
import { which, type Run } from '../sessions/tmux';
import { remedy, type CommandEnv } from './deps';

/**
 * Claude Code, which Wheelhouse runs the Firstmate session in. The wizard
 * installs it when it is missing (the npm package, with one click; Anthropic's
 * own installer for the captain's terminal), checks the version it reports,
 * and then lets the captain sign in and accept its terms themselves, in a
 * terminal on the page running `claude` (see ./terminal.ts). Wheelhouse never
 * writes Claude Code's onboarding or acceptance settings for them.
 *
 * Signed in is decided by a tiny non-interactive test, `claude -p`, run in a
 * folder of Wheelhouse's own (never the Firstmate checkout, whose hooks would
 * start a Firstmate session), and never while the sign-in terminal is open.
 */

export const CLAUDE_NPM_PACKAGE = '@anthropic-ai/claude-code';
export const CLAUDE_INSTALL_COMMAND = `npm install -g ${CLAUDE_NPM_PACKAGE}`;
export const CLAUDE_OFFICIAL_INSTALLER = 'curl -fsSL https://claude.ai/install.sh | bash';
export const CLAUDE_DOCS = 'https://docs.anthropic.com/en/docs/claude-code/setup';
const TEST_PROMPT = 'Reply with exactly the word ok and nothing else.';
const TEST_TIMEOUT_MS = 90_000;

/** What `claude --version` says it is: "2.1.3 (Claude Code)" → "2.1.3". */
export function parseClaudeVersion(out: string): string | null {
	const m = out.match(/(\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?)/);
	return m ? m[1] : null;
}

/** Anything that looks like a credential, replaced, before a line is shown. */
export function redact(line: string): string {
	return line
		.replace(/sk-ant-[A-Za-z0-9_-]+/g, '[redacted]')
		.replace(/\b[A-Za-z0-9_-]{40,}\b/g, '[redacted]');
}

/** Whether the test's answer says Claude Code answered. */
export function answeredOk(stdout: string): boolean {
	return /^\W*ok\W*$/i.test(stdout.trim());
}

export function installItem(
	env: CommandEnv,
	found: string | null,
	version: string | null
): DepItem {
	const fix = found ? null : remedy('claude', CLAUDE_INSTALL_COMMAND, env);
	return {
		tool: 'claude',
		what: 'Claude Code: Firstmate runs in it',
		status: found ? 'ok' : 'missing',
		detail: found ? (version ?? 'Installed') : 'Not installed',
		required: true,
		oneClick: fix?.oneClick ?? null,
		terminal: found ? [] : [...(fix?.terminal ?? []), CLAUDE_OFFICIAL_INSTALLER],
		link: CLAUDE_DOCS,
		note: found
			? null
			: (fix?.note ??
				'The one-click install uses npm; Anthropic’s own installer runs in your terminal instead.')
	};
}

export interface ClaudeOptions {
	env: NodeJS.ProcessEnv;
	/** A folder of Wheelhouse's own to run the test in. */
	workDir: string;
	commandEnv: CommandEnv;
	run?: Run;
	find?: (name: string) => string | null;
}

/** Whether Claude Code is installed, and which version, without running a test. */
export async function claudeStatus(opts: ClaudeOptions): Promise<ClaudeStatus> {
	const run = opts.run ?? runBounded;
	const find = opts.find ?? ((n: string) => which(n, opts.env.PATH));
	const file = find('claude');
	let version: string | null = null;
	if (file) {
		const r = await run(file, ['--version'], {
			env: opts.env,
			timeoutMs: 15_000,
			maxOutputBytes: 4096
		});
		version = r.ok ? parseClaudeVersion(r.stdout) : null;
	}
	const installed = Boolean(file && version);
	return {
		installed,
		path: file,
		version,
		signedIn: null,
		detail: file && !version ? `${file} did not report a Claude Code version; reinstall it.` : null,
		install: installItem(opts.commandEnv, installed ? file : null, version)
	};
}

/** Ask Claude Code for one word, without a terminal, to see that it is signed in and answering. */
export async function testClaude(opts: ClaudeOptions): Promise<ClaudeStatus> {
	const status = await claudeStatus(opts);
	if (!status.installed || !status.path) return { ...status, signedIn: false };
	const run = opts.run ?? runBounded;
	try {
		mkdirSync(opts.workDir, { recursive: true });
	} catch (e) {
		return {
			...status,
			signedIn: null,
			detail: `Could not make ${opts.workDir}: ${(e as Error).message}`
		};
	}
	const r = await run(status.path, ['-p', TEST_PROMPT, '--output-format', 'text'], {
		cwd: opts.workDir,
		env: opts.env,
		timeoutMs: TEST_TIMEOUT_MS,
		maxOutputBytes: 64 * 1024
	});
	if (r.ok && answeredOk(r.stdout)) {
		return { ...status, signedIn: true, detail: 'Claude Code answered.' };
	}
	const said = `${r.stdout}\n${r.stderr}`
		.split('\n')
		.map((l) => l.trim())
		.find(Boolean);
	const why = r.ok
		? `It answered something else: ${said ?? '(nothing)'}`
		: r.kind === 'timeout'
			? 'It did not answer in time.'
			: (said ?? r.message);
	return { ...status, signedIn: false, detail: redact(why).slice(0, 300) };
}
