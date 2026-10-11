import { createHash, randomBytes } from 'node:crypto';
import { lstatSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

/**
 * Pre-registers Claude Code's workspace trust for a session's scratch
 * directory, so the session reaches its prompt instead of stopping on "Quick
 * safety check: Is this a project you created or one you trust?" for a folder
 * Claude has never seen. Firstmate does the same for its worker worktrees
 * (bin/fm-claude-trust.sh); this follows that recipe:
 *
 *   - the store is `${CLAUDE_CONFIG_DIR:-$HOME}/.claude.json`, as the session's
 *     own `claude` resolves it (symlinks followed to the real file);
 *   - only `projects[<dir>].hasTrustDialogAccepted` is set, for the exact path
 *     of a directory Wheelhouse itself just created; no other flag is touched
 *     (in particular never the external CLAUDE.md import consent flags);
 *   - the write is atomic (an exclusive temporary file renamed over the store),
 *     two-space pretty-printed as Claude Code writes it, and refused rather
 *     than clobbering when the store changed under it (a running Claude Code
 *     rewrites this file); the result is read back to confirm it landed.
 */

export const TRUST_FLAG = 'hasTrustDialogAccepted';
const ATTEMPTS = 3;

/** The Claude Code config store the session's `claude` reads, or null when neither variable is set. */
export function claudeStore(env: NodeJS.ProcessEnv): string | null {
	const dir = env.CLAUDE_CONFIG_DIR || env.HOME;
	if (!dir || !path.isAbsolute(dir)) return null;
	return path.join(dir, '.claude.json');
}

const fingerprint = (buf: Buffer | null) =>
	buf === null ? 'absent' : createHash('sha256').update(buf).digest('hex');

function readStore(file: string): Buffer | null {
	try {
		return readFileSync(file);
	} catch (e) {
		if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
		throw e;
	}
}

type Attempt = 'recorded' | 'moved' | 'dropped';

function attempt(store: string, dir: string): Attempt {
	const original = readStore(store);
	const before = fingerprint(original);
	let root: Record<string, unknown> = {};
	const raw = original?.toString('utf8') ?? '';
	if (raw.trim()) {
		const parsed: unknown = JSON.parse(raw);
		if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
			throw new Error(`${store} is not a JSON object`);
		}
		root = parsed as Record<string, unknown>;
	}
	root.projects ??= {};
	const projects = root.projects as Record<string, unknown>;
	if (projects === null || typeof projects !== 'object' || Array.isArray(projects)) {
		throw new Error(`${store} has a "projects" value that is not an object`);
	}
	const entry = projects[dir];
	projects[dir] = {
		...(entry && typeof entry === 'object' && !Array.isArray(entry) ? entry : {}),
		[TRUST_FLAG]: true
	};
	// An unpredictable name and an exclusive create, so a planted symlink is never followed.
	const tmp = path.join(
		path.dirname(store),
		`.claude.json.wheelhouse-trust.${process.pid}.${randomBytes(8).toString('hex')}`
	);
	writeFileSync(tmp, `${JSON.stringify(root, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
	let renamed = false;
	try {
		if (fingerprint(readStore(store)) !== before) return 'moved';
		renameSync(tmp, store);
		renamed = true;
	} finally {
		if (!renamed) rmSync(tmp, { force: true });
	}
	const back = JSON.parse(readFileSync(store, 'utf8')) as { projects?: Record<string, unknown> };
	const landed = (back.projects?.[dir] as Record<string, unknown> | undefined)?.[TRUST_FLAG];
	return landed === true ? 'recorded' : 'dropped';
}

/**
 * Record trust for `dir` (a directory Wheelhouse created) in `store`.
 * Returns why it could not, or null once the flag is confirmed on disk.
 */
export function registerTrust(store: string, dir: string): string | null {
	let target: string;
	let file = store;
	try {
		target = realpathSync(dir);
		try {
			file = realpathSync(store);
		} catch (e) {
			if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
		}
		const st = lstatSync(file, { throwIfNoEntry: false });
		if (st && !st.isFile()) return `${file} is not a regular file`;
	} catch (e) {
		return (e as Error).message;
	}
	try {
		for (let i = 0; i < ATTEMPTS; i += 1) {
			const r = attempt(file, target);
			if (r === 'recorded') return null;
			if (r === 'moved' && i >= 1) return `${file} kept changing while trust was being recorded`;
		}
	} catch (e) {
		return (e as Error).message;
	}
	return `${file} did not keep the trust entry for ${target}`;
}
