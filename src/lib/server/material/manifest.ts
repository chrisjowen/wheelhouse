import { readFile, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import type { Harness } from '../../harness';
import type { ReviewSurface } from './bundle';
import { present, readTree, replaceTree, writeAtomic, type Hashes, type Tree } from './files';

/**
 * The record of everything Wheelhouse installed for Firstmate and its crew,
 * kept in Wheelhouse's own config folder (never in Firstmate's):
 *
 *   <config>/agent-material/manifest.json   what was written where, its hashes and version
 *   <config>/agent-material/base/<item>/     the exact bytes last written, for a real diff
 *   <config>/agent-material/proposed/<item>/ a newer version held back from an edited copy
 *   <config>/agent-material/backup/<item>/   a copy replaced by `adopt` or `accept`
 *   <config>/agent-material/settings.json    items turned off: { "items": { "<id>": false } }
 *
 * The next sync compares what was written (base), what is there now and what
 * this version would write, so an upgrade replaces only copies nobody changed,
 * and the manifest says exactly what differs for the rest.
 */

export const MANIFEST_SCHEMA = 'wheelhouse-material.v1';
const HISTORY_MAX = 50;

export type ItemKind = 'skill-dir' | 'managed-block';

export interface ManifestItem {
	id: string;
	kind: ItemKind;
	/** The folder (a skill) or file (a block) written. */
	target: string;
	/** The bundled skill's name, or the block's marker name. */
	bundle: string;
	/** The Wheelhouse version that last wrote it. */
	version: string;
	/** sha256 of each file as last written; a block's text is the one entry `block`. */
	files: Hashes;
	writtenAt: string;
	/** `wheelhouse skills keep`: leave this edited copy alone while it and the bundle stay as they were. */
	kept?: { local: Hashes; next: Hashes };
}

/** One of Firstmate's contracts a bundled skill relies on, as last checked. */
export interface AssumptionCheck {
	file: string;
	marker: string;
	present: boolean;
}

export interface FirstmateRecord {
	dir: string;
	home: string;
	/** Its checkout's HEAD when last checked, or null when git could not say. */
	commit: string | null;
	checkedAt: string;
	assumptions: AssumptionCheck[];
}

export interface HistoryEntry {
	at: string;
	version: string;
	changes: { id: string; state: string }[];
}

export interface Manifest {
	schema: typeof MANIFEST_SCHEMA;
	wheelhouse: { version: string };
	firstmate: FirstmateRecord | null;
	/** What the bundled text was last rendered with; the CLI renders with the same. */
	render: { reviewSurface: ReviewSurface | null; harness: Harness };
	items: Record<string, ManifestItem>;
	history: HistoryEntry[];
}

export const materialDir = (configDir: string) => path.join(configDir, 'agent-material');
const manifestFile = (dir: string) => path.join(dir, 'manifest.json');
const settingsFile = (dir: string) => path.join(dir, 'settings.json');
/** An item id as one folder name. */
const folder = (id: string) => id.replace(/[^A-Za-z0-9@._-]/g, '_');
export const baseDir = (dir: string, id: string) => path.join(dir, 'base', folder(id));
export const proposedDir = (dir: string, id: string) => path.join(dir, 'proposed', folder(id));
export const backupDir = (dir: string, id: string, at: Date) =>
	path.join(dir, 'backup', folder(id), at.toISOString().replace(/[:.]/g, '-'));

export function emptyManifest(version: string, harness: Harness): Manifest {
	return {
		schema: MANIFEST_SCHEMA,
		wheelhouse: { version },
		firstmate: null,
		render: { reviewSurface: null, harness },
		items: {},
		history: []
	};
}

function valid(m: unknown): m is Manifest {
	const x = m as Manifest;
	return (
		!!x &&
		x.schema === MANIFEST_SCHEMA &&
		typeof x.items === 'object' &&
		x.items !== null &&
		Array.isArray(x.history) &&
		typeof x.render === 'object' &&
		x.render !== null
	);
}

/**
 * The manifest, null when there is none yet. One that cannot be read is never
 * trusted: it is moved aside, unless `look` (a dry run) asks only to look.
 */
export async function readManifest(dir: string, look = false): Promise<Manifest | null> {
	const file = manifestFile(dir);
	let text: string;
	try {
		text = await readFile(file, 'utf8');
	} catch (e) {
		if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
		throw e;
	}
	try {
		const m = JSON.parse(text);
		if (valid(m)) return m;
	} catch {
		/* moved aside below */
	}
	if (!look) await rename(file, `${file}.invalid-${Date.now()}`);
	return null;
}

export async function writeManifest(dir: string, m: Manifest): Promise<void> {
	m.history = m.history.slice(-HISTORY_MAX);
	await writeAtomic(manifestFile(dir), JSON.stringify(m, null, 2) + '\n');
}

/** The bytes Wheelhouse last wrote for an item, or null when it has none (an install before the manifest). */
export async function readBase(dir: string, id: string): Promise<Tree | null> {
	const d = baseDir(dir, id);
	return (await present(d)) ? readTree(d) : null;
}

export const saveBase = (dir: string, id: string, tree: Tree) =>
	replaceTree(baseDir(dir, id), tree);

export async function saveProposed(dir: string, id: string, tree: Tree | null): Promise<void> {
	if (tree) await replaceTree(proposedDir(dir, id), tree);
	else await rm(proposedDir(dir, id), { recursive: true, force: true });
}

export async function forgetItem(dir: string, id: string): Promise<void> {
	await rm(baseDir(dir, id), { recursive: true, force: true });
	await rm(proposedDir(dir, id), { recursive: true, force: true });
}

/** Item ids the captain turned off (`wheelhouse skills uninstall`); a bad file turns nothing off. */
export async function readOff(dir: string): Promise<Set<string>> {
	try {
		const s = JSON.parse(await readFile(settingsFile(dir), 'utf8')) as {
			items?: Record<string, unknown>;
		};
		return new Set(
			Object.entries(s.items ?? {})
				.filter(([, on]) => on === false)
				.map(([id]) => id)
		);
	} catch {
		return new Set();
	}
}

export async function writeOff(dir: string, off: Set<string>): Promise<void> {
	const items = Object.fromEntries([...off].sort().map((id) => [id, false]));
	await writeAtomic(settingsFile(dir), JSON.stringify({ items }, null, 2) + '\n');
}

const chains = new Map<string, Promise<unknown>>();

/** Run `work` after every earlier call for the same material folder in this process has finished. */
export function serialize<T>(dir: string, work: () => Promise<T>): Promise<T> {
	const prev = chains.get(dir) ?? Promise.resolve();
	const run = prev.then(work, work);
	const settled = run.catch(() => {});
	chains.set(dir, settled);
	void settled.then(() => {
		if (chains.get(dir) === settled) chains.delete(dir);
	});
	return run;
}
