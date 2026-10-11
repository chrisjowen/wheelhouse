import { createHash } from 'node:crypto';
import { open, realpath } from 'node:fs/promises';
import path from 'node:path';
import { repoOfRemote, type CheckDeps } from './checks';
import { GIT_REF, MAX_FILE_BYTES } from './schema';

/**
 * Where passage files come from:
 * - the project's `.wheelhouse.yaml`, read from the default branch of the
 *   project's Firstmate clone (`<home>/projects/<id>`) with `git cat-file`,
 *   never from its working tree, another branch, or a task's worktree: a
 *   crewmate must not be able to declare the check that clears its own work;
 * - the captain-owned file `<config dir>/projects/<id>.yaml`.
 * The Firstmate home's own configuration is never read.
 */

export const PROJECT_FILE = '.wheelhouse.yaml';
/** Project ids become file names; Firstmate's task id rule keeps them to one path segment. */
export const PROJECT_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

export interface SourceText {
	state: 'absent' | 'read' | 'unreadable';
	/** Where it was read from, in plain words. */
	location: string;
	text: string | null;
	/** sha256 of the text. */
	digest: string | null;
	problem: string | null;
}

export interface ProjectClone {
	dir: string;
	/** The default branch as a remote-tracking ref, e.g. origin/main. */
	defaultRef: string;
	/** owner/name when origin is on GitHub. */
	repo: string | null;
}

export const digestOf = (text: string) => createHash('sha256').update(text).digest('hex');

/** The default branch of a clone, as origin's remote-tracking ref. */
async function defaultRef(dir: string, deps: CheckDeps): Promise<string | null> {
	const head = await deps.git(dir, [
		'symbolic-ref',
		'--quiet',
		'--short',
		'refs/remotes/origin/HEAD'
	]);
	const name = head.ok ? head.stdout.trim() : '';
	if (name.startsWith('origin/') && GIT_REF.test(name)) return name;
	for (const candidate of ['origin/main', 'origin/master']) {
		const r = await deps.git(dir, ['rev-parse', '--verify', '--quiet', `${candidate}^{commit}`]);
		if (r.ok) return candidate;
	}
	return null;
}

/** The project's clone and its default branch, or why there is none. */
export async function readClone(
	homeDir: string,
	projectId: string,
	deps: CheckDeps
): Promise<{ clone: ProjectClone | null; problem: string | null }> {
	if (!PROJECT_ID.test(projectId)) return { clone: null, problem: 'not a project id' };
	const dir = path.join(homeDir, 'projects', projectId);
	const top = await deps.git(dir, ['rev-parse', '--show-toplevel']);
	const real = await realpath(dir).catch(() => null);
	if (!top.ok || !real || (await realpath(top.stdout.trim()).catch(() => null)) !== real) {
		return {
			clone: null,
			problem: `Firstmate has no clone of this project at projects/${projectId}.`
		};
	}
	const ref = await defaultRef(dir, deps);
	if (!ref) return { clone: null, problem: 'The project clone has no origin default branch.' };
	const remote = await deps.git(dir, ['remote', 'get-url', 'origin']);
	return {
		clone: { dir, defaultRef: ref, repo: remote.ok ? repoOfRemote(remote.stdout) : null },
		problem: null
	};
}

/** `.wheelhouse.yaml` at the tip of the clone's default branch. */
export async function readProjectFile(clone: ProjectClone, deps: CheckDeps): Promise<SourceText> {
	const spec = `${clone.defaultRef}:${PROJECT_FILE}`;
	const location = `${PROJECT_FILE} on ${clone.defaultRef} of projects/${path.basename(clone.dir)}`;
	const size = await deps.git(clone.dir, ['cat-file', '-s', spec]);
	if (!size.ok) return { state: 'absent', location, text: null, digest: null, problem: null };
	if (Number(size.stdout.trim()) > MAX_FILE_BYTES) {
		return {
			state: 'unreadable',
			location,
			text: null,
			digest: null,
			problem: `The file is larger than ${MAX_FILE_BYTES / 1024} KiB.`
		};
	}
	const r = await deps.git(clone.dir, ['cat-file', 'blob', spec]);
	if (!r.ok) {
		return {
			state: 'unreadable',
			location,
			text: null,
			digest: null,
			problem: 'git could not read the file.'
		};
	}
	return { state: 'read', location, text: r.stdout, digest: digestOf(r.stdout), problem: null };
}

/** The captain-owned passage file for a project, if there is one. */
export async function readCaptainFile(configDir: string, projectId: string): Promise<SourceText> {
	const file = path.join(configDir, 'projects', `${projectId}.yaml`);
	const none = { location: file, text: null, digest: null };
	if (!PROJECT_ID.test(projectId)) return { ...none, state: 'absent', problem: null };
	let fh;
	try {
		fh = await open(file, 'r');
	} catch (e) {
		const code = (e as NodeJS.ErrnoException).code;
		return code === 'ENOENT' || code === 'ENOTDIR'
			? { ...none, state: 'absent', problem: null }
			: { ...none, state: 'unreadable', problem: `Could not read it: ${(e as Error).message}` };
	}
	try {
		const buf = Buffer.alloc(MAX_FILE_BYTES + 1);
		const { bytesRead } = await fh.read(buf, 0, buf.length, 0);
		if (bytesRead > MAX_FILE_BYTES) {
			return {
				...none,
				state: 'unreadable',
				problem: `The file is larger than ${MAX_FILE_BYTES / 1024} KiB.`
			};
		}
		const text = buf.subarray(0, bytesRead).toString('utf8');
		return { state: 'read', location: file, text, digest: digestOf(text), problem: null };
	} catch (e) {
		return { ...none, state: 'unreadable', problem: `Could not read it: ${(e as Error).message}` };
	} finally {
		await fh.close();
	}
}
