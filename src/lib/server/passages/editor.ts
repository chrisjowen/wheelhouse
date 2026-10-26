import { randomBytes } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, mkdir, open, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { MAX_FILE_BYTES } from './schema';
import { digestOf, PROJECT_FILE, PROJECT_ID } from './sources';

/**
 * The passage editor's files. The captain edits one of two files:
 * - `project`: `.wheelhouse.yaml` in the working tree of Firstmate's clone of
 *   the project (`<home>/projects/<id>`). Saving changes a file in that
 *   repository; Wheelhouse still only applies the version on the default
 *   branch, so the change takes effect once it is committed there.
 * - `captain`: the captain-owned `<config dir>/projects/<id>.yaml`, which
 *   takes effect the next time passage files are read (within a minute).
 *
 * This is the one place Wheelhouse writes into the Firstmate home besides
 * `fm-inbox.sh note`, and only when the captain saves in the editor. Both
 * files are written to a temporary file renamed over the old one, never
 * through a symbolic link, and only when they still match what the editor
 * loaded (else 409, so a newer file is never overwritten unseen).
 */

export type EditTarget = 'project' | 'captain';

export interface EditorFile {
	target: EditTarget;
	/** The file exists. */
	exists: boolean;
	text: string;
	/** sha256 of the file as read (null when it does not exist). */
	digest: string | null;
	/** Where the file is, for the record (shown small, never as the main wording). */
	location: string;
	problem: string | null;
}

export type WriteResult =
	{ ok: true; digest: string } | { ok: false; status: 409 | 500; message: string };

export function editorPath(
	target: EditTarget,
	o: { cloneDir: string | null; configDir: string | null; projectId: string }
): string | null {
	if (!PROJECT_ID.test(o.projectId)) return null;
	if (target === 'project') return o.cloneDir ? path.join(o.cloneDir, PROJECT_FILE) : null;
	return o.configDir ? path.join(o.configDir, 'projects', `${o.projectId}.yaml`) : null;
}

/** Read a passage file for editing: a regular file only, never through a link. */
export async function readEditorFile(target: EditTarget, file: string): Promise<EditorFile> {
	const none = { target, exists: false, text: '', digest: null, location: file };
	let st;
	try {
		st = await lstat(file);
	} catch (e) {
		const code = (e as NodeJS.ErrnoException).code;
		if (code === 'ENOENT' || code === 'ENOTDIR') return { ...none, problem: null };
		return { ...none, problem: `Could not read it: ${(e as Error).message}` };
	}
	if (!st.isFile()) {
		return {
			...none,
			exists: true,
			problem: 'It is not a plain file (a link or a folder), so the editor leaves it alone.'
		};
	}
	if (st.size > MAX_FILE_BYTES) {
		return {
			...none,
			exists: true,
			problem: `The file is larger than ${MAX_FILE_BYTES / 1024} KiB.`
		};
	}
	let fh;
	try {
		fh = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
		const buf = Buffer.alloc(MAX_FILE_BYTES + 1);
		const { bytesRead } = await fh.read(buf, 0, buf.length, 0);
		if (bytesRead > MAX_FILE_BYTES) {
			return {
				...none,
				exists: true,
				problem: `The file is larger than ${MAX_FILE_BYTES / 1024} KiB.`
			};
		}
		const text = buf.subarray(0, bytesRead).toString('utf8');
		return { target, exists: true, text, digest: digestOf(text), location: file, problem: null };
	} catch (e) {
		return { ...none, exists: true, problem: `Could not read it: ${(e as Error).message}` };
	} finally {
		await fh?.close();
	}
}

/**
 * Write a passage file when it still matches `baseDigest` (null: it must not
 * exist yet). The folder must already exist for the project file (it is the
 * clone); the captain's projects folder is created when missing.
 */
export async function writeEditorFile(
	target: EditTarget,
	file: string,
	text: string,
	baseDigest: string | null
): Promise<WriteResult> {
	const now = await readEditorFile(target, file);
	if (now.problem && now.exists) return { ok: false, status: 409, message: now.problem };
	if (now.digest !== baseDigest) {
		return {
			ok: false,
			status: 409,
			message: now.exists
				? 'The file changed since the editor loaded it. Reload to see the newer version before saving.'
				: 'The file was removed since the editor loaded it. Reload before saving.'
		};
	}
	const dir = path.dirname(file);
	try {
		if (target === 'captain') await mkdir(dir, { recursive: true });
		const tmp = path.join(dir, `.${path.basename(file)}.${randomBytes(6).toString('hex')}.tmp`);
		try {
			await writeFile(tmp, text, { mode: 0o644, flag: 'wx' });
			await rename(tmp, file);
		} catch (e) {
			await rm(tmp, { force: true });
			throw e;
		}
	} catch (e) {
		return {
			ok: false,
			status: 500,
			message: `Wheelhouse could not save the file: ${(e as Error).message}`
		};
	}
	return { ok: true, digest: digestOf(text) };
}
