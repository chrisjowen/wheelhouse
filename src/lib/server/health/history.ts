import { lstat, readdir } from 'node:fs/promises';
import path from 'node:path';

/**
 * How large the history Firstmate and Wheelhouse keep has grown: the
 * Firstmate home's data/ folder, its handled inbox notes (state/inbox/handled
 * and each task's state/<task>.inbox/handled) and Wheelhouse's chat archive.
 * Read only, never changed: the health check proposes archiving to the
 * captain and leaves the deciding (and the doing) to them.
 */

export interface HistorySizes {
	dataBytes: number | null;
	handledNotes: number | null;
	chatArchiveBytes: number | null;
}

/** Entries looked at per walk before it stops counting (a bound on the disk reads). */
const MAX_ENTRIES = 300_000;
/** Yield to the event loop every this many entries. */
const YIELD_EVERY = 500;

const tick = () => new Promise<void>((r) => setImmediate(r));

/** Total size of the files under `dir` (symlinks are not followed); null when it cannot be read. */
export async function folderBytes(dir: string, max = MAX_ENTRIES): Promise<number | null> {
	let total = 0;
	let seen = 0;
	const stack = [dir];
	try {
		await lstat(dir);
	} catch {
		return null;
	}
	while (stack.length && seen < max) {
		const d = stack.pop()!;
		const names = await readdir(d, { withFileTypes: true }).catch(() => []);
		for (const e of names) {
			if (++seen % YIELD_EVERY === 0) await tick();
			if (seen >= max) break;
			const p = path.join(d, e.name);
			if (e.isDirectory()) stack.push(p);
			else if (e.isFile()) total += (await lstat(p).catch(() => null))?.size ?? 0;
		}
	}
	return total;
}

/** How many files `dir` holds directly; 0 when it is not there. */
async function countFiles(dir: string): Promise<number> {
	const names = await readdir(dir, { withFileTypes: true }).catch(() => []);
	return names.filter((e) => e.isFile()).length;
}

/** Handled inbox notes in a Firstmate home: its own inbox's, and each task inbox's. */
export async function handledNotes(homeDir: string): Promise<number | null> {
	const state = path.join(homeDir, 'state');
	const names = await readdir(state, { withFileTypes: true }).catch(() => null);
	if (!names) return null;
	let n = await countFiles(path.join(state, 'inbox', 'handled'));
	for (const e of names) {
		if (e.isDirectory() && e.name.endsWith('.inbox'))
			n += await countFiles(path.join(state, e.name, 'handled'));
	}
	return n;
}

export async function measureHistory(o: {
	homeDir: string;
	dataDir: string;
	chatArchiveDir: string | null;
}): Promise<HistorySizes> {
	return {
		dataBytes: await folderBytes(o.dataDir),
		handledNotes: await handledNotes(o.homeDir),
		chatArchiveBytes: o.chatArchiveDir ? await folderBytes(o.chatArchiveDir) : null
	};
}
