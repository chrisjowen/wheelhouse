import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createInterface } from 'node:readline/promises';
import { HARNESSES, parseHarness, type Harness } from '../src/lib/harness';
import { which } from '../src/lib/server/sessions/tmux';
import { readSavedChoice } from '../src/lib/server/setup/agentchoice';
import { readAnswers } from '../src/lib/server/setup/answers';

interface ResolveHarnessOptions {
	explicit?: string;
	env: NodeJS.ProcessEnv;
	configDir: string;
	interactive?: boolean;
	find?: (name: string) => string | null;
	choose?: (installed: readonly Harness[]) => Promise<string | null>;
}

async function savedHarness(file: string): Promise<Harness | null> {
	let text: string;
	try {
		text = await readFile(file, 'utf8');
	} catch (error) {
		if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return null;
		throw new Error(`Cannot read ${file}. Check its permissions.`, { cause: error });
	}
	try {
		const value: unknown = JSON.parse(text);
		if (
			!value ||
			typeof value !== 'object' ||
			!('harness' in value) ||
			typeof value.harness !== 'string'
		) {
			throw new Error('Expected an object with a harness name.');
		}
		return parseHarness(value.harness);
	} catch (error) {
		throw new Error(
			`Invalid saved tool choice in ${file}. Set --harness to replace it, or edit or remove this file.`,
			{ cause: error }
		);
	}
}

async function saveHarness(file: string, harness: Harness): Promise<void> {
	await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
	const temporary = `${file}.${process.pid}.${randomBytes(8).toString('hex')}.tmp`;
	try {
		await writeFile(temporary, `${JSON.stringify({ harness })}\n`, { flag: 'wx', mode: 0o600 });
		await rename(temporary, file);
	} finally {
		await rm(temporary, { force: true });
	}
}

async function chooseHarness(
	installed: readonly Harness[],
	find: (name: string) => string | null,
	env: NodeJS.ProcessEnv
): Promise<string | null> {
	const fzf = find('fzf');
	if (fzf) {
		const result = spawnSync(fzf, ['--prompt=Firstmate tool > ', '--height=~10', '--no-multi'], {
			input: `${installed.join('\n')}\n`,
			encoding: 'utf8',
			env,
			stdio: ['pipe', 'pipe', 'inherit']
		});
		if (result.error) throw result.error;
		if (result.status === 1 || result.status === 130 || result.signal === 'SIGINT') return null;
		if (result.status !== 0)
			throw new Error('The tool picker failed. Run again with --harness <name>.');
		return result.stdout.trim() || null;
	}
	const input = createInterface({ input: process.stdin, output: process.stdout });
	const controller = new AbortController();
	input.once('SIGINT', () => controller.abort());
	input.once('close', () => controller.abort());
	try {
		const choices = installed.map((name, index) => `${index + 1}. ${name}`).join('\n');
		const answer = (
			await input.question(`Choose Firstmate's tool:\n${choices}\nNumber (blank to cancel): `, {
				signal: controller.signal
			})
		).trim();
		if (!answer) return null;
		const choice = /^\d+$/.test(answer) ? installed[Number(answer) - 1] : undefined;
		if (!choice)
			throw new Error(`Choose a number from 1 to ${installed.length}, or use --harness <name>.`);
		return choice;
	} catch (error) {
		if (controller.signal.aborted) return null;
		throw error;
	} finally {
		input.close();
	}
}

/**
 * The saved tool choice now, for a restart after the setup wizard changed it;
 * null when there is none or it cannot be read.
 */
export const savedHarnessNow = (configDir: string): Harness | null =>
	readSavedChoice(configDir)?.harness ?? null;

/**
 * Resolve the primary tool before starting it, remembering explicit and
 * interactive choices: the flag, the variable, the saved choice, the agent the
 * setup answers chose (a machine the cloud product made), the picker, else claude.
 */
export async function resolveHarness(options: ResolveHarnessOptions): Promise<Harness> {
	const { env } = options;
	const file = path.join(options.configDir, 'harness.json');
	const requested = options.explicit ?? env.WHEELHOUSE_HARNESS;
	if (requested !== undefined) {
		const harness = parseHarness(requested);
		await saveHarness(file, harness);
		return harness;
	}
	const saved = await savedHarness(file);
	if (saved) return saved;
	const answers = readAnswers(options.configDir);
	if (answers.state === 'ok') return answers.choice.agent;
	const interactive =
		options.interactive ?? (process.stdin.isTTY === true && process.stdout.isTTY === true);
	if (!interactive) return 'claude';
	const find = options.find ?? ((name) => which(name, env.PATH));
	const installed = HARNESSES.filter((harness) => find(harness));
	if (!installed.length) return 'claude';
	const selected =
		installed.length === 1
			? installed[0]
			: await (options.choose ?? ((choices) => chooseHarness(choices, find, env)))(installed);
	if (selected === null)
		throw new Error('Tool selection cancelled. No Firstmate session was started.');
	const harness = installed.find((name) => name === selected);
	if (!harness)
		throw new Error(
			'The selected tool is not installed. Choose an installed tool or use --harness <name>.'
		);
	await saveHarness(file, harness);
	return harness;
}
