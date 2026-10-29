import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { PROJECT_ID } from './store';

/**
 * Which project is asking. A Firstmate worker's pane carries FM_TASK_ID and
 * FM_TASK_INBOX (its steering inbox, `<state>/<task>.inbox`); the task's record
 * beside it, `<state>/<task>.meta`, names the project clone in `project=`,
 * whose folder name is the project's id, as Wheelhouse names it. Without a
 * task, the project is the repository named by the `origin` remote of the
 * directory the command runs in.
 *
 * This tells projects apart for grants; it proves nothing. A process can set
 * FM_TASK_ID or change directory, so grants keep a task from using a secret by
 * mistake or because injected text told it to, not one that sets out to.
 */

export interface Caller {
	task: string | null;
	project: string | null;
	/** How the project was found. */
	via: 'task-record' | 'origin-remote' | null;
}

export interface CallerDeps {
	env: NodeJS.ProcessEnv;
	cwd: string;
	readFile?: (file: string) => Promise<string>;
	/** The `origin` remote's URL for a directory, or null. */
	originUrl?: (cwd: string) => Promise<string | null>;
}

/** Firstmate's task id rule. */
const TASK_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

export async function resolveCaller(deps: CallerDeps): Promise<Caller> {
	const read = deps.readFile ?? ((f: string) => readFile(f, 'utf8'));
	const origin = deps.originUrl ?? gitOriginUrl;
	const raw = deps.env.FM_TASK_ID?.trim();
	const task = raw && TASK_ID.test(raw) ? raw : null;

	if (task) {
		const project = await projectFromTaskRecord(task, deps.env, read);
		if (project) return { task, project, via: 'task-record' };
	}
	const url = await origin(deps.cwd).catch(() => null);
	const project = url ? repoName(url) : null;
	return project ? { task, project, via: 'origin-remote' } : { task, project: null, via: null };
}

/** Where Firstmate keeps task records: beside the steering inbox, else under FM_HOME. */
function stateDir(task: string, env: NodeJS.ProcessEnv): string | null {
	const inbox = env.FM_TASK_INBOX;
	if (inbox && path.isAbsolute(inbox) && path.basename(inbox) === `${task}.inbox`) {
		return path.dirname(inbox);
	}
	return env.FM_HOME && path.isAbsolute(env.FM_HOME) ? path.join(env.FM_HOME, 'state') : null;
}

async function projectFromTaskRecord(
	task: string,
	env: NodeJS.ProcessEnv,
	read: (file: string) => Promise<string>
): Promise<string | null> {
	const state = stateDir(task, env);
	if (!state) return null;
	let meta: string;
	try {
		meta = await read(path.join(state, `${task}.meta`));
	} catch {
		return null;
	}
	let clone: string | null = null;
	for (const line of meta.split('\n')) {
		if (line.startsWith('project=')) clone = line.slice('project='.length).trim();
	}
	if (!clone || !path.isAbsolute(clone)) return null;
	// A task on Firstmate itself names the home; Wheelhouse calls that project `firstmate`.
	if (path.resolve(clone) === path.resolve(path.dirname(state))) return 'firstmate';
	const id = path.basename(clone);
	return PROJECT_ID.test(id) ? id : null;
}

/** The repository's name from a remote URL: `git@github.com:o/r.git` → `r`. */
export function repoName(url: string): string | null {
	const s = url.trim().replace(/\/+$/, '');
	const last = s.split(/[/:]/).pop() ?? '';
	const name = last.replace(/\.git$/, '');
	return PROJECT_ID.test(name) ? name : null;
}

function gitOriginUrl(cwd: string): Promise<string | null> {
	return new Promise((resolve) => {
		execFile(
			'git',
			['remote', 'get-url', 'origin'],
			{ cwd, timeout: 5_000, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } },
			(err, stdout) => resolve(err ? null : stdout.trim() || null)
		);
	});
}
