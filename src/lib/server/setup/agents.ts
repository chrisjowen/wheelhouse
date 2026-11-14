import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { agentName, type AgentChoice, type KeyProvider } from '../../agent';
import type { ClaudeStatus, DepItem } from '../../setup';
import { runBounded } from '../firstmate/exec';
import { which, type Run } from '../sessions/tmux';
import { answeredOk, CLAUDE_INSTALL_COMMAND, parseClaudeVersion, redact } from './claude';
import { parseHarness } from '../../harness';
import { defaultConfigDir } from '../plugins/config';
import { madeChoice } from './agentchoice';
import { remedy, type CommandEnv } from './deps';

/**
 * Codex and Pi in the setup wizard, beside Claude Code (claude.ts): each is
 * installed with npm when it is missing, signed in by the captain in the
 * wizard's terminal (or with an API key the wizard keeps in the vault), and
 * tested with one word, non-interactively, in a folder of Wheelhouse's own.
 *
 *   Codex  ChatGPT: `codex login` in the terminal (`--device-auth` on a cloud
 *          machine, which has no browser of its own).
 *          API key: `codex login --with-api-key`, the key on its standard input.
 *          Test: `codex exec`.
 *   Pi     ChatGPT: `pi` in the terminal; the captain types /login there.
 *          API key: an `api_key` entry in Pi's own auth.json (0600), as its
 *          /login would write it.
 *          Test: `pi -p`, with the provider chosen.
 *
 * Wheelhouse never answers an agent's prompts: it only starts the sign-in
 * command, and the captain types into it.
 */

const TEST_PROMPT = 'Reply with exactly the word ok and nothing else.';
const TEST_TIMEOUT_MS = 120_000;
const LOGIN_TIMEOUT_MS = 30_000;

export type OtherAgent = 'codex' | 'pi';

interface AgentSpec {
	bin: OtherAgent;
	npm: string;
	docs: string;
	what: string;
}

export const AGENT_SPECS: Record<OtherAgent, AgentSpec> = {
	codex: {
		bin: 'codex',
		npm: '@openai/codex',
		docs: 'https://developers.openai.com/codex/cli',
		what: 'Codex: Firstmate runs in it'
	},
	pi: {
		bin: 'pi',
		npm: '@earendil-works/pi-coding-agent',
		docs: 'https://github.com/earendil-works/pi-mono',
		what: 'Pi: Firstmate runs in it'
	}
};

export const installCommand = (agent: OtherAgent | 'claude') =>
	agent === 'claude' ? CLAUDE_INSTALL_COMMAND : `npm install -g ${AGENT_SPECS[agent].npm}`;

/** Pi's provider for a choice: its ChatGPT subscription is `openai-codex`. */
export function piProvider(c: AgentChoice): string | null {
	if (c.agent !== 'pi') return null;
	switch (c.provider) {
		case 'chatgpt':
			return 'openai-codex';
		case 'openai':
		case 'anthropic':
			return c.provider;
		default:
			return null;
	}
}

/** Pi's provider for the Firstmate session, when the wizard or the setup answers chose one. */
export function savedPiProvider(env: NodeJS.ProcessEnv): string | null {
	try {
		const harness = parseHarness(env.WHEELHOUSE_HARNESS);
		if (harness !== 'pi') return null;
		const c = madeChoice(harness, defaultConfigDir(env));
		return c ? piProvider(c) : null;
	} catch {
		return null;
	}
}

function agentItem(
	agent: OtherAgent,
	env: CommandEnv,
	found: string | null,
	version: string | null
): DepItem {
	const s = AGENT_SPECS[agent];
	const fix = found ? null : remedy(agent, installCommand(agent), env);
	return {
		tool: agent,
		what: s.what,
		status: found ? 'ok' : 'missing',
		detail: found ? (version ?? 'Installed') : 'Not installed',
		required: true,
		oneClick: fix?.oneClick ?? null,
		terminal: found ? [] : (fix?.terminal ?? [installCommand(agent)]),
		link: s.docs,
		note: found ? null : (fix?.note ?? null)
	};
}

export interface AgentOptions {
	env: NodeJS.ProcessEnv;
	/** A folder of Wheelhouse's own to run the test in. */
	workDir: string;
	commandEnv: CommandEnv;
	run?: Run;
	find?: (name: string) => string | null;
}

/** Whether `agent` is installed, and which version, without running a test. */
export async function agentStatus(agent: OtherAgent, opts: AgentOptions): Promise<ClaudeStatus> {
	const run = opts.run ?? runBounded;
	const find = opts.find ?? ((n: string) => which(n, opts.env.PATH));
	const file = find(AGENT_SPECS[agent].bin);
	let version: string | null = null;
	if (file) {
		const r = await run(file, ['--version'], {
			env: opts.env,
			timeoutMs: 15_000,
			maxOutputBytes: 4096
		});
		version = r.ok ? parseClaudeVersion(`${r.stdout}\n${r.stderr}`) : null;
	}
	const installed = Boolean(file && version);
	return {
		installed,
		path: file,
		version,
		signedIn: null,
		detail:
			file && !version
				? `${file} did not report a ${agentName(agent)} version; reinstall it.`
				: null,
		install: agentItem(agent, opts.commandEnv, installed ? file : null, version)
	};
}

/** The one-word test's arguments. */
export function testArgs(c: AgentChoice & { agent: OtherAgent }): string[] {
	if (c.agent === 'codex')
		return ['exec', '--skip-git-repo-check', '--sandbox', 'read-only', TEST_PROMPT];
	const provider = piProvider(c);
	return [
		'-p',
		'--no-session',
		'--no-extensions',
		'--no-skills',
		'--no-context-files',
		...(provider ? ['--provider', provider] : []),
		TEST_PROMPT
	];
}

/** Ask the agent for one word, without a terminal, to see that it is signed in and answering. */
export async function testAgent(
	c: AgentChoice & { agent: OtherAgent },
	opts: AgentOptions
): Promise<ClaudeStatus> {
	const status = await agentStatus(c.agent, opts);
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
	const r = await run(status.path, testArgs(c), {
		cwd: opts.workDir,
		env: opts.env,
		timeoutMs: TEST_TIMEOUT_MS,
		maxOutputBytes: 64 * 1024
	});
	const name = agentName(c.agent);
	if (r.ok && answeredOk(r.stdout))
		return { ...status, signedIn: true, detail: `${name} answered.` };
	// The agents print progress on stderr; the reason a test failed is its last line.
	const lines = `${r.stdout}\n${r.stderr}`
		.split('\n')
		.map((l) => l.trim())
		.filter(Boolean);
	const said = r.ok ? lines[0] : lines.at(-1);
	const why = r.ok
		? `It answered something else: ${said ?? '(nothing)'}`
		: r.kind === 'timeout'
			? 'It did not answer in time.'
			: (said ?? r.message);
	return { ...status, signedIn: false, detail: redactKey(why).slice(0, 300) };
}

/** Anything that looks like an API key, replaced (claude.ts's redact, and OpenAI's `sk-` keys). */
export const redactKey = (line: string) =>
	redact(line).replace(/sk-[A-Za-z0-9_*-]{6,}/g, '[redacted]');

/**
 * The command the wizard's terminal runs for signing in to `c`, or why there is
 * none (an API key is typed into the wizard instead).
 */
export function signInArgv(
	c: AgentChoice,
	bin: string,
	cloud: boolean
): { ok: true; argv: string[] } | { ok: false; error: string } {
	if (c.auth !== 'subscription')
		return {
			ok: false,
			error: `${agentName(c.agent)} signs in with an API key here, not in a terminal.`
		};
	switch (c.agent) {
		case 'claude':
			return { ok: true, argv: [bin] };
		case 'codex':
			return { ok: true, argv: cloud ? [bin, 'login', '--device-auth'] : [bin, 'login'] };
		case 'pi':
			return { ok: true, argv: [bin, '--no-session'] };
	}
}

/** Pi's own folder: $PI_CODING_AGENT_DIR, else ~/.pi/agent. */
export const piAgentDir = (env: NodeJS.ProcessEnv) =>
	env.PI_CODING_AGENT_DIR
		? path.resolve(env.PI_CODING_AGENT_DIR)
		: path.join(env.HOME || homedir(), '.pi', 'agent');

/** Pi's auth.json with `provider`'s API key added, every other entry kept. */
export function withPiKey(text: string | null, provider: KeyProvider, key: string): string {
	let auth: Record<string, unknown> = {};
	if (text !== null) {
		let raw: unknown;
		try {
			raw = JSON.parse(text);
		} catch {
			// Never the parser's message: it can quote the file, which holds other credentials.
			throw new Error('it is not JSON');
		}
		if (typeof raw !== 'object' || raw === null || Array.isArray(raw))
			throw new Error('it is not a JSON object');
		auth = raw as Record<string, unknown>;
	}
	return `${JSON.stringify({ ...auth, [provider]: { type: 'api_key', key } }, null, 2)}\n`;
}

export type LoginResult = { ok: true } | { ok: false; error: string };

/**
 * Sign the agent in with an API key, as its own login would keep it: Codex
 * through `codex login --with-api-key` (the key on its standard input), Pi in
 * its auth.json, written whole to a private file that then replaces it.
 */
export async function signInWithKey(
	c: AgentChoice & { agent: OtherAgent },
	provider: KeyProvider,
	key: string,
	opts: AgentOptions
): Promise<LoginResult> {
	const name = agentName(c.agent);
	if (c.agent === 'codex') {
		const find = opts.find ?? ((n: string) => which(n, opts.env.PATH));
		const bin = find('codex');
		if (!bin) return { ok: false, error: 'Install Codex first.' };
		const r = await (opts.run ?? runBounded)(bin, ['login', '--with-api-key'], {
			env: opts.env,
			timeoutMs: LOGIN_TIMEOUT_MS,
			maxOutputBytes: 16 * 1024,
			input: key,
			maxInputBytes: 16 * 1024
		});
		if (r.ok) return { ok: true };
		const said = `${r.stderr}\n${r.stdout}`
			.split('\n')
			.map((l) => l.trim())
			.find(Boolean);
		const why = r.kind === 'timeout' ? 'it did not finish in time' : (said ?? r.message);
		return {
			ok: false,
			error: `Codex did not take the key: ${redactKey(why).replaceAll(key, '[redacted]')}`
		};
	}
	const dir = piAgentDir(opts.env);
	const file = path.join(dir, 'auth.json');
	const tmp = `${file}.${process.pid}.wheelhouse.tmp`;
	try {
		let text: string | null = null;
		try {
			text = readFileSync(file, 'utf8');
		} catch (e) {
			if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
		}
		const next = withPiKey(text, provider, key);
		mkdirSync(dir, { recursive: true, mode: 0o700 });
		writeFileSync(tmp, next, { mode: 0o600 });
		renameSync(tmp, file);
		return { ok: true };
	} catch (e) {
		return {
			ok: false,
			error: `Could not give ${name} the key in ${file}: ${(e as Error).message}`
		};
	} finally {
		rmSync(tmp, { force: true });
	}
}
