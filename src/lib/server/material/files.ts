import { createHash } from 'node:crypto';
import { lstat, mkdir, readFile, readdir, realpath, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

/** File contents by path relative to a folder, `/`-separated. */
export type Tree = Record<string, string>;
/** sha256 (hex) of each file of a tree. */
export type Hashes = Record<string, string>;

export const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');

export const hashTree = (tree: Tree): Hashes =>
	Object.fromEntries(Object.entries(tree).map(([file, text]) => [file, sha256(text)]));

/** The same files with the same contents. */
export function sameHashes(a: Hashes, b: Hashes): boolean {
	const keys = Object.keys(a);
	return keys.length === Object.keys(b).length && keys.every((k) => b[k] === a[k]);
}

export async function present(file: string): Promise<boolean> {
	try {
		await lstat(file);
		return true;
	} catch (e) {
		if ((e as NodeJS.ErrnoException).code === 'ENOENT') return false;
		throw e;
	}
}

/** Resolve existing ancestors too, so a symlinked user config cannot reach into a protected folder. */
export async function physical(file: string): Promise<string> {
	try {
		return await realpath(file);
	} catch (e) {
		if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
		const parent = path.dirname(file);
		if (parent === file) throw e;
		return path.join(await physical(parent), path.basename(file));
	}
}

/** Whether any of `targets` is, or is inside, one of `protectedDirs`, after resolving links. */
export async function insideAny(targets: string[], protectedDirs: string[]): Promise<boolean> {
	const real = await Promise.all(targets.map(physical));
	for (const dir of protectedDirs) {
		const p = await physical(path.resolve(dir));
		if (real.some((t) => t === p || t.startsWith(p + path.sep))) return true;
	}
	return false;
}

/** Every file under `dir`; a symbolic link or special file anywhere throws. */
export async function readTree(dir: string, prefix = ''): Promise<Tree> {
	const tree: Tree = {};
	for (const entry of await readdir(dir, { withFileTypes: true })) {
		const rel = prefix + entry.name;
		if (entry.isDirectory())
			Object.assign(tree, await readTree(path.join(dir, entry.name), rel + '/'));
		else if (entry.isFile()) tree[rel] = await readFile(path.join(dir, entry.name), 'utf8');
		else throw new Error(`${rel} is a symbolic link or special file.`);
	}
	return tree;
}

export async function writeTree(dir: string, tree: Tree): Promise<void> {
	for (const [file, text] of Object.entries(tree)) {
		await mkdir(path.dirname(path.join(dir, file)), { recursive: true });
		await writeFile(path.join(dir, file), text);
	}
}

/** Replace `dir` with exactly `tree`, through a sibling staging folder. */
export async function replaceTree(dir: string, tree: Tree): Promise<void> {
	const stage = `${dir}.new-${process.pid}-${Date.now()}`;
	await rm(stage, { recursive: true, force: true });
	await writeTree(stage, tree);
	await mkdir(stage, { recursive: true });
	await rm(dir, { recursive: true, force: true });
	await rename(stage, dir);
}

/** Write a file through a temporary sibling and a rename, so a reader never sees half of it. */
export async function writeAtomic(file: string, text: string, mode = 0o600): Promise<void> {
	await mkdir(path.dirname(file), { recursive: true });
	const tmp = `${file}.${process.pid}-${Date.now()}.tmp`;
	await writeFile(tmp, text, { mode });
	await rename(tmp, file);
}
