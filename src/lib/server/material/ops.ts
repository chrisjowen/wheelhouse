import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { parseHarness, type Harness } from '../../harness';
import { readRemembered } from '../setup/remembered';
import { renderSkill } from './bundle';
import { hashTree, replaceTree, sameHashes, type Tree } from './files';
import {
	backupDir,
	emptyManifest,
	forgetItem,
	materialDir,
	readBase,
	readManifest,
	readOff,
	serialize,
	writeManifest,
	writeOff,
	type Manifest
} from './manifest';
import { readLocal } from './skilldir';
import {
	installOver,
	plannedSkills,
	syncMaterial,
	type MaterialContext,
	type MaterialResult,
	type SkillItem,
	type SyncInputs
} from './sync';

/**
 * What `wheelhouse skills` does, from the CLI's own process: it renders the
 * bundle with the inputs the server last synced with (the manifest's
 * `render`), against the Firstmate the manifest (or setup) names. A server
 * syncing at the same moment is safe: swaps re-check the target, and the
 * manifest is replaced whole.
 */

export type Outcome<T = string> = { ok: true; value: T } | { ok: false; error: string };

export interface SkillsCli {
	ctx: MaterialContext;
	inputs: SyncInputs;
	dir: string;
}

async function savedHarness(configDir: string): Promise<Harness> {
	try {
		const raw = JSON.parse(await readFile(path.join(configDir, 'harness.json'), 'utf8')) as {
			harness?: string;
		};
		return parseHarness(raw.harness);
	} catch {
		return 'claude';
	}
}

/** The context `wheelhouse skills` works in, or why it cannot. */
export async function skillsCli(o: {
	env: NodeJS.ProcessEnv;
	configDir: string;
	skillsRoot: string;
	version: string;
}): Promise<Outcome<SkillsCli>> {
	const dir = materialDir(o.configDir);
	let m: Manifest | null;
	try {
		m = await readManifest(dir, true);
	} catch (e) {
		return { ok: false, error: `Could not read ${dir}/manifest.json: ${(e as Error).message}` };
	}
	const remembered = readRemembered(o.configDir);
	const install = m?.firstmate
		? { firstmateDir: m.firstmate.dir, homeDir: m.firstmate.home }
		: remembered
			? { firstmateDir: remembered.firstmate, homeDir: remembered.home ?? remembered.firstmate }
			: null;
	if (!install)
		return {
			ok: false,
			error:
				'Wheelhouse is not connected to a Firstmate yet. Open Wheelhouse (`wheelhouse open`) first'
		};
	const inputs: SyncInputs = m?.render ?? {
		reviewSurface: null,
		harness: await savedHarness(o.configDir)
	};
	return {
		ok: true,
		value: {
			ctx: {
				install,
				env: o.env,
				configDir: o.configDir,
				skillsRoot: o.skillsRoot,
				version: o.version
			},
			inputs,
			dir
		}
	};
}

export interface StatusView {
	schema: 'wheelhouse-skills-status.v1';
	result: MaterialResult;
	manifest: Pick<Manifest, 'wheelhouse' | 'firstmate' | 'render'> | null;
}

/** What a sync would do now, changing nothing. */
export async function status(c: SkillsCli): Promise<StatusView> {
	const result = await syncMaterial(c.ctx, c.inputs, { dryRun: true });
	const m = await readManifest(c.dir, true);
	return {
		schema: 'wheelhouse-skills-status.v1',
		result,
		manifest: m ? { wheelhouse: m.wheelhouse, firstmate: m.firstmate, render: m.render } : null
	};
}

/** Sync now; naming items turns them on again first (`uninstall` turned them off). */
export async function sync(c: SkillsCli, ids: string[]): Promise<Outcome<MaterialResult>> {
	const unknown = ids.filter((id) => !itemOf(c, id));
	if (unknown.length) return { ok: false, error: `No such item: ${unknown.join(', ')}` };
	if (ids.length) {
		await serialize(c.dir, async () => {
			const off = await readOff(c.dir);
			if (ids.some((id) => off.delete(id))) await writeOff(c.dir, off);
		});
	}
	return { ok: true, value: await syncMaterial(c.ctx, c.inputs, ids.length ? { only: ids } : {}) };
}

const itemOf = (c: SkillsCli, id: string): SkillItem | undefined =>
	plannedSkills(c.ctx.env, c.inputs.harness).find((i) => i.id === id);

const render = (c: SkillsCli, item: SkillItem) =>
	renderSkill(c.ctx.skillsRoot!, item.skill, { reviewSurface: c.inputs.reviewSurface });

async function stateOf(c: SkillsCli, id: string) {
	const r = await syncMaterial(c.ctx, c.inputs, { dryRun: true, only: [id] });
	return r.items[0]?.state;
}

function diffDirs(a: string, b: string, labels: [string, string]): Promise<string> {
	return new Promise((resolve, reject) =>
		execFile(
			'diff',
			['-ruN', '--label', labels[0], '--label', labels[1], a, b],
			{ maxBuffer: 16 * 1024 * 1024 },
			(error, stdout) => {
				// diff exits 1 when the folders differ.
				if (error && (error as { code?: unknown }).code !== 1) reject(error);
				else resolve(stdout);
			}
		)
	);
}

/** Unified diffs of an item: your edits (what Wheelhouse wrote → now) and this version's (→ the bundle). */
export async function diff(c: SkillsCli, id: string): Promise<Outcome> {
	const item = itemOf(c, id);
	if (!item) return { ok: false, error: `No such item: ${id}` };
	const local = await readLocal(item.target);
	if (local.kind === 'unreadable')
		return { ok: false, error: `Cannot read ${item.target}: ${local.reason}` };
	const next = await render(c, item);
	const base = await readBase(c.dir, id);
	const scratch = await mkdtemp(path.join(tmpdir(), 'wheelhouse-skills-diff-'));
	try {
		const put = async (name: string, tree: Tree) => {
			const d = path.join(scratch, name);
			await replaceTree(d, tree);
			return d;
		};
		const localDir = await put('local', local.kind === 'files' ? local.tree : {});
		const nextDir = await put('next', next);
		const parts: string[] = [];
		if (base) {
			const baseDir = await put('base', base);
			parts.push(
				`# Edits since Wheelhouse wrote ${item.target}\n`,
				(await diffDirs(baseDir, localDir, ['wheelhouse-wrote', 'now'])) || '(none)\n',
				`\n# What this version of Wheelhouse changes\n`,
				(await diffDirs(baseDir, nextDir, ['wheelhouse-wrote', 'this-version'])) || '(none)\n'
			);
		} else {
			parts.push(
				`# ${item.target} compared with this version (Wheelhouse has no record of what it wrote there)\n`,
				(await diffDirs(localDir, nextDir, ['now', 'this-version'])) || '(no differences)\n'
			);
		}
		return { ok: true, value: parts.join('') };
	} finally {
		await rm(scratch, { recursive: true, force: true });
	}
}

/**
 * Replace an item that is not Wheelhouse's (`adopt`) or was edited (`accept`)
 * with this version, keeping a copy of what was there in backup/.
 */
export async function replace(
	c: SkillsCli,
	id: string,
	expect: 'foreign' | 'modified'
): Promise<Outcome> {
	const item = itemOf(c, id);
	if (!item) return { ok: false, error: `No such item: ${id}` };
	const state = await stateOf(c, id);
	if (state !== expect)
		return {
			ok: false,
			error: `${id} is ${state ?? 'not planned'}, not ${expect === 'foreign' ? 'foreign (not managed by Wheelhouse)' : 'locally edited'}`
		};
	const tree = await render(c, item);
	return serialize(c.dir, async () => {
		const local = await readLocal(item.target);
		if (local.kind === 'unreadable')
			return {
				ok: false,
				error: `${item.target} is a symbolic link or holds one; move it aside first`
			};
		const m = (await readManifest(c.dir)) ?? emptyManifest(c.ctx.version, c.inputs.harness);
		const backup = backupDir(c.dir, id, c.ctx.now?.() ?? new Date());
		if (local.kind === 'files') await replaceTree(backup, local.tree);
		await installOver(c.ctx, c.dir, m, item, tree);
		await writeManifest(c.dir, m);
		return {
			ok: true,
			value: `Installed this version at ${item.target}${local.kind === 'files' ? `; the copy that was there is in ${backup}` : ''}.`
		};
	});
}

/** Keep an edited item as it is, until this or a later version of Wheelhouse changes it again. */
export async function keep(c: SkillsCli, id: string): Promise<Outcome> {
	const item = itemOf(c, id);
	if (!item) return { ok: false, error: `No such item: ${id}` };
	const state = await stateOf(c, id);
	if (state !== 'modified') return { ok: false, error: `${id} is ${state}, not locally edited` };
	const next = hashTree(await render(c, item));
	return serialize(c.dir, async () => {
		const local = await readLocal(item.target);
		if (local.kind !== 'files') return { ok: false, error: `${item.target} changed meanwhile` };
		const m = (await readManifest(c.dir)) ?? emptyManifest(c.ctx.version, c.inputs.harness);
		const rec = m.items[id] ?? {
			id,
			kind: 'skill-dir' as const,
			target: item.target,
			bundle: item.skill.name,
			version: 'unknown',
			files: local.receipt ?? {},
			writtenAt: (c.ctx.now?.() ?? new Date()).toISOString()
		};
		m.items[id] = { ...rec, kept: { local: hashTree(local.tree), next } };
		await writeManifest(c.dir, m);
		return {
			ok: true,
			value: `Keeping ${item.target} as it is; Wheelhouse flags it again when a later version changes the skill.`
		};
	});
}

/**
 * Remove items Wheelhouse installed, and turn them off so it does not put them
 * back; an edited copy is left in place and reported. No ids: every item.
 */
export async function uninstall(c: SkillsCli, ids: string[]): Promise<Outcome<string[]>> {
	return serialize(c.dir, async () => {
		const m = await readManifest(c.dir);
		const planned = plannedSkills(c.ctx.env, c.inputs.harness);
		const known = new Map<string, string>([
			...planned.map((p) => [p.id, p.target] as const),
			...Object.values(m?.items ?? {}).map((r) => [r.id, r.target] as const)
		]);
		const unknown = ids.filter((id) => !known.has(id));
		if (unknown.length) return { ok: false, error: `No such item: ${unknown.join(', ')}` };
		const off = await readOff(c.dir);
		const lines: string[] = [];
		for (const [id, target] of known) {
			if (ids.length && !ids.includes(id)) continue;
			const local = await readLocal(target);
			const rec = m?.items[id];
			const bases = [rec?.files, local.kind === 'files' ? local.receipt : null].filter((b) => !!b);
			const ours =
				local.kind === 'absent' ||
				(local.kind === 'files' && bases.some((b) => sameHashes(hashTree(local.tree), b!)));
			if (!ours) {
				lines.push(
					`Left ${target}: ${local.kind === 'files' ? 'it was locally edited' : 'it is not a folder Wheelhouse wrote'}. Remove it yourself if you no longer want it.`
				);
				continue;
			}
			if (local.kind === 'files') await rm(target, { recursive: true, force: true });
			await forgetItem(c.dir, id);
			if (m) delete m.items[id];
			off.add(id);
			lines.push(
				`Removed ${target}; Wheelhouse will not install ${id} again until \`wheelhouse skills sync ${id}\`.`
			);
		}
		if (m) await writeManifest(c.dir, m);
		await writeOff(c.dir, off);
		return { ok: true, value: lines };
	});
}
