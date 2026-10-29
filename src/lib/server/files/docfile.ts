import { open, realpath, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DOC_EXT } from '../../docpath';
import { docTitle } from '../buildlog/docs';

/**
 * Files Firstmate and its workers name in their text, read for the captain:
 * Markdown for the reader (/files), and the images a document links to
 * (/api/files). Only files inside the allowed folders are read: the
 * Firstmate home, Firstmate's own code, and each live task's project and
 * worktree. A relative path is read against the Firstmate home. Both the path
 * as written and the file it really is (symlinks followed) must be inside an
 * allowed folder, so neither `..` nor a symlink leads out. Read-only.
 */

export interface FileRoots {
	/** The Firstmate home, which relative paths are read against. */
	home: string;
	/** Every allowed folder, the home included. */
	roots: string[];
}

export const DOC_BYTES = 1024 * 1024;
export const ASSET_BYTES = 15 * 1024 * 1024;
const MAX_PATH = 4096;

/** What /api/files serves, by extension: images a document may show or link to. */
export const ASSET_TYPES: Record<string, string> = {
	'.png': 'image/png',
	'.jpg': 'image/jpeg',
	'.jpeg': 'image/jpeg',
	'.gif': 'image/gif',
	'.webp': 'image/webp',
	'.svg': 'image/svg+xml'
};

export type Refusal = { ok: false; status: 400 | 403 | 404 | 415; message: string };

const refuse = (status: Refusal['status'], message: string): Refusal => ({
	ok: false,
	status,
	message
});

function inside(p: string, dir: string): boolean {
	const rel = path.relative(dir, p);
	return rel !== '' && rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel);
}

/**
 * Folders that can be allowed: absolute, and neither the filesystem root nor
 * the user's home folder or one of its parents, so a malformed snapshot row
 * cannot open the whole disk.
 */
export function usableRoots(dirs: Iterable<string | null | undefined>, userHome = os.homedir()) {
	const out = new Set<string>();
	for (const d of dirs) {
		if (!d || !path.isAbsolute(d)) continue;
		const dir = path.resolve(d);
		if (dir === path.parse(dir).root) continue;
		if (userHome && (dir === path.resolve(userHome) || inside(userHome, dir))) continue;
		out.add(dir);
	}
	return [...out];
}

/** The file a path names, when it may be read: the real path, symlinks followed. */
export async function locate(
	input: string,
	r: FileRoots,
	allowed: (file: string) => boolean
): Promise<{ ok: true; file: string } | Refusal> {
	const p = input.trim();
	if (!p || p.length > MAX_PATH || p.includes('\0')) return refuse(400, 'No file was named.');
	const named = path.isAbsolute(p) ? path.resolve(p) : path.resolve(r.home, p);
	if (!allowed(named)) return refuse(415, 'Wheelhouse does not show that kind of file.');
	const outside = refuse(403, 'That file is outside the folders Wheelhouse may read.');
	if (!r.roots.some((root) => inside(named, path.resolve(root)))) return outside;
	const real = await realpath(named).catch(() => null);
	if (!real) return refuse(404, 'There is no such file.');
	const realRoots = await Promise.all(r.roots.map((root) => realpath(root).catch(() => null)));
	if (!realRoots.some((root) => root && inside(real, root))) return outside;
	if (!allowed(real)) return refuse(415, 'Wheelhouse does not show that kind of file.');
	const st = await stat(real).catch(() => null);
	if (!st?.isFile()) return refuse(404, 'There is no such file.');
	return { ok: true, file: real };
}

/** Up to `max` bytes of a file, and whether that was all of it. */
async function readStart(file: string, max: number): Promise<{ data: Buffer; whole: boolean }> {
	const fh = await open(file, 'r');
	try {
		const { size } = await fh.stat();
		const buf = Buffer.alloc(Math.min(size, max));
		const { bytesRead } = await fh.read(buf, 0, buf.length, 0);
		return { data: buf.subarray(0, bytesRead), whole: size <= max };
	} finally {
		await fh.close();
	}
}

export interface DocFile {
	/** The real path, which the document's relative links are resolved against. */
	path: string;
	/** The path as the captain knows it: relative to the Firstmate home when inside it. */
	shown: string;
	title: string;
	markdown: string;
	truncated: boolean;
}

/** A Markdown file, for the reader. */
export async function readDoc(
	input: string,
	r: FileRoots
): Promise<{ ok: true; doc: DocFile } | Refusal> {
	const found = await locate(input, r, (f) => DOC_EXT.test(f));
	if (!found.ok) return found;
	const { data, whole } = await readStart(found.file, DOC_BYTES).catch(() => ({
		data: null,
		whole: false
	}));
	if (!data) return refuse(404, 'That file could not be read.');
	// A cut can split a character; drop the partial one.
	const markdown = data.toString('utf8').replace(/�$/, '');
	const home = await realpath(r.home).catch(() => path.resolve(r.home));
	const shown = inside(found.file, home) ? path.relative(home, found.file) : found.file;
	return {
		ok: true,
		doc: {
			path: found.file,
			shown,
			title: docTitle(markdown, path.basename(found.file)),
			markdown,
			truncated: !whole
		}
	};
}

/** An image a document links to, with its content type. */
export async function readAsset(
	input: string,
	r: FileRoots
): Promise<{ ok: true; data: Buffer; type: string } | Refusal> {
	const typeOf = (f: string) => ASSET_TYPES[path.extname(f).toLowerCase()];
	const found = await locate(input, r, (f) => !!typeOf(f));
	if (!found.ok) return found;
	const st = await stat(found.file);
	if (st.size > ASSET_BYTES) return refuse(415, 'That file is too large to show.');
	const { data } = await readStart(found.file, ASSET_BYTES);
	return { ok: true, data, type: typeOf(found.file) };
}
