import { lstat, mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { present, readTree, writeTree, type Hashes, type Tree } from './files';

/**
 * A skill folder on disk. Each install also leaves a `.wheelhouse-managed.json`
 * receipt inside it (schema `wheelhouse-skill.v1`: version and file hashes), as
 * Wheelhouse has since 0.5.0, so the folder still says what Wheelhouse wrote
 * to an older release or a second Wheelhouse sharing the same user skills.
 */
export const RECEIPT = '.wheelhouse-managed.json';
const RECEIPT_SCHEMA = 'wheelhouse-skill.v1';

/** What is at a skill's target: nothing, its files (and the hashes its receipt names), or something not to touch. */
export type Local =
	| { kind: 'absent' }
	| { kind: 'files'; tree: Tree; receipt: Hashes | null }
	| { kind: 'unreadable'; reason: string };

function receiptHashes(text: string): Hashes | null {
	try {
		const r = JSON.parse(text) as { schema?: unknown; files?: unknown };
		if (r.schema !== RECEIPT_SCHEMA || !r.files || typeof r.files !== 'object') return null;
		const files = Object.entries(r.files as Record<string, unknown>);
		return files.every(([, v]) => typeof v === 'string') ? (r.files as Hashes) : null;
	} catch {
		return null;
	}
}

export async function readLocal(target: string): Promise<Local> {
	try {
		if (!(await present(target))) return { kind: 'absent' };
		if (!(await lstat(target)).isDirectory())
			return { kind: 'unreadable', reason: 'it is a symbolic link or not a folder' };
		const tree = await readTree(target);
		const receipt = RECEIPT in tree ? receiptHashes(tree[RECEIPT]) : null;
		delete tree[RECEIPT];
		return { kind: 'files', tree, receipt };
	} catch (e) {
		/* Moved away mid-read by another Wheelhouse, or a link inside: never overwritten. */
		if (!(await present(target).catch(() => true))) return { kind: 'absent' };
		return { kind: 'unreadable', reason: (e as Error).message };
	}
}

export const receiptText = (version: string, hashes: Hashes) =>
	JSON.stringify({ schema: RECEIPT_SCHEMA, version, files: hashes }) + '\n';

/** What a swap should do with what is at the target now. */
export type SwapCheck = 'replace' | 'done' | 'stop';

/**
 * Put `tree` (and its receipt) at `target` in one rename, keeping the previous
 * folder until the new one is in place. `check` looks at the target before each
 * attempt, so a copy another process changed or finished meanwhile is left alone:
 * 'done' (it already holds this tree) or 'stop' (never replace it).
 */
export async function swapIn(
	target: string,
	tree: Tree,
	receipt: string,
	check: (now: Local) => SwapCheck
): Promise<'swapped' | 'done' | 'stop'> {
	const parent = path.dirname(target);
	await mkdir(parent, { recursive: true });
	const stage = await mkdtemp(path.join(parent, '.wheelhouse-skill-'));
	let placed = false;
	try {
		await writeTree(stage, tree);
		await writeFile(path.join(stage, RECEIPT), receipt);
		const backup = stage + '-previous';
		for (let attempt = 1; ; attempt++) {
			const now = await readLocal(target);
			const verdict = check(now);
			if (verdict !== 'replace') return verdict;
			try {
				if (now.kind !== 'absent') await rename(target, backup);
				await rename(stage, target);
				placed = true;
				return 'swapped';
			} catch (e) {
				await rename(backup, target).catch(() => {});
				// Another Wheelhouse may be swapping in this same bundle; look again once it settles.
				if (attempt === 20) throw e;
			} finally {
				await rm(backup, { recursive: true, force: true });
			}
			await new Promise((resolve) => setTimeout(resolve, 10 * attempt));
		}
	} finally {
		if (!placed) await rm(stage, { recursive: true, force: true });
	}
}

/** The receipt in a folder Wheelhouse wrote, read on its own (for `wheelhouse skills`). */
export async function readReceipt(target: string): Promise<Hashes | null> {
	try {
		return receiptHashes(await readFile(path.join(target, RECEIPT), 'utf8'));
	} catch {
		return null;
	}
}
