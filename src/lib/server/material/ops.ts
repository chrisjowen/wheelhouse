import { execFile } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { parseHarness, type Harness } from '../../harness';
import { readRemembered } from '../setup/remembered';
import { parseBlock, withoutBlock } from './block';
import { briefBlock, renderSkill } from './bundle';
import { CONTEXT_ID } from './context';
import {
	hashTree,
	present,
	replaceTree,
	sameHashes,
	sha256,
	writeAtomic,
	type Tree
} from './files';
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
	BRIEF_ID,
	BRIEF_MARKER,
	briefIncludeFile,
	installBlockOver,
	installOver,
	plannedSkills,
	removeContext,
	syncMaterial,
	type BlockSpec,
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
 * manifest is replaced whole. Settings → Agent material turns items on and
 * off through the same `sync` and `uninstall`, from the server's own context.
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
	const inputs: SyncInputs = m?.render
		? { reviewSurface: m.render.reviewSurface, harness: m.render.harness }
		: { reviewSurface: null, harness: await savedHarness(o.configDir) };
	return {
		ok: true,
		value: {
			ctx: {
				install,
				env: o.env,
				configDir: o.configDir,
				skillsRoot: o.skillsRoot,
				version: o.version,
				briefInclude: briefIncludeFile(install.homeDir),
				// The server keeps the session context in its state directory; the manifest says where.
				contextFile: m?.items[CONTEXT_ID]?.target,
				url: m?.render.url ?? null
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

/** One item Wheelhouse plans to install: a skill folder, the worker block or the session context. */
export type Planned =
	| ({ kind: 'skill-dir' } & SkillItem)
	| { kind: 'managed-block'; id: string; target: string }
	| { kind: 'launch-context'; id: string; target: string };

/** Every item this context installs, whether or not it is turned off. */
export function planned(c: SkillsCli): Planned[] {
	return [
		...plannedSkills(c.ctx.env, c.inputs.harness, c.ctx.skills).map((i) => ({
			kind: 'skill-dir' as const,
			...i
		})),
		...(c.ctx.briefInclude
			? [{ kind: 'managed-block' as const, id: BRIEF_ID, target: c.ctx.briefInclude }]
			: []),
		...(c.ctx.contextFile
			? [{ kind: 'launch-context' as const, id: CONTEXT_ID, target: c.ctx.contextFile }]
			: [])
	];
}

const itemOf = (c: SkillsCli, id: string): Planned | undefined =>
	planned(c).find((i) => i.id === id);

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

const blockSpec = (c: SkillsCli, target: string): BlockSpec => ({
	id: BRIEF_ID,
	name: BRIEF_MARKER,
	target,
	body: briefBlock(c.inputs)
});

/** What this version would write for an item, as files (a block is its one `block.md`). */
async function nextTree(c: SkillsCli, item: Planned): Promise<Tree> {
	if (item.kind === 'skill-dir')
		return renderSkill(c.ctx.skillsRoot!, item.skill, { reviewSurface: c.inputs.reviewSurface });
	if (item.kind === 'managed-block') return { 'block.md': blockSpec(c, item.target).body };
	throw new Error('Wheelhouse rewrites the session context itself');
}

/** What is there now, as files; an error says why it cannot be compared or replaced. */
async function localTree(item: Planned): Promise<{ tree: Tree } | { error: string }> {
	if (item.kind === 'skill-dir') {
		const local = await readLocal(item.target);
		if (local.kind === 'unreadable')
			return { error: `Cannot read ${item.target}: ${local.reason}` };
		return { tree: local.kind === 'files' ? local.tree : {} };
	}
	if (item.kind === 'managed-block') {
		const text = (await present(item.target)) ? await readFile(item.target, 'utf8') : '';
		const p = parseBlock(text, BRIEF_MARKER);
		if (p.state === 'broken') return { error: `${item.target}: ${p.reason}` };
		return { tree: p.state === 'one' ? { 'block.md': p.body } : {} };
	}
	return { error: 'Wheelhouse rewrites the session context itself; there is nothing to compare' };
}

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
	const local = await localTree(item);
	if ('error' in local) return { ok: false, error: local.error };
	const next = await nextTree(c, item);
	const base = await readBase(c.dir, id);
	const scratch = await mkdtemp(path.join(tmpdir(), 'wheelhouse-skills-diff-'));
	try {
		const put = async (name: string, tree: Tree) => {
			const d = path.join(scratch, name);
			await replaceTree(d, tree);
			return d;
		};
		const localDir = await put('local', local.tree);
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
	if (item.kind === 'launch-context')
		return { ok: false, error: 'Wheelhouse rewrites the session context itself' };
	const state = await stateOf(c, id);
	if (state !== expect)
		return {
			ok: false,
			error: `${id} is ${state ?? 'not planned'}, not ${expect === 'foreign' ? 'foreign (not managed by Wheelhouse)' : 'locally edited'}`
		};
	return serialize(c.dir, async (): Promise<Outcome> => {
		const m = (await readManifest(c.dir)) ?? emptyManifest(c.ctx.version, c.inputs.harness);
		const backup = backupDir(c.dir, id, c.ctx.now?.() ?? new Date());
		if (item.kind === 'managed-block') {
			const had = await present(item.target);
			if (had) {
				await mkdir(backup, { recursive: true });
				await copyFile(item.target, path.join(backup, path.basename(item.target)));
			}
			try {
				await installBlockOver(c.ctx, c.dir, m, blockSpec(c, item.target));
			} catch (e) {
				return { ok: false, error: (e as Error).message };
			}
			await writeManifest(c.dir, m);
			return {
				ok: true,
				value: `Wrote this version's block in ${item.target}${had ? `; the file as it was is in ${backup}` : ''}.`
			};
		}
		const tree = await nextTree(c, item);
		const local = await readLocal(item.target);
		if (local.kind === 'unreadable')
			return {
				ok: false,
				error: `${item.target} is a symbolic link or holds one; move it aside first`
			};
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
	// A block is recorded by the hash of its text alone (sync.ts syncBlock).
	const hashes = (tree: Tree) =>
		item.kind === 'managed-block' ? { block: sha256(tree['block.md'] ?? '') } : hashTree(tree);
	const next = hashes(await nextTree(c, item));
	return serialize(c.dir, async () => {
		const local = await localTree(item);
		if ('error' in local || !Object.keys(local.tree).length)
			return { ok: false, error: `${item.target} changed meanwhile` };
		const receipt = item.kind === 'skill-dir' ? await readLocal(item.target) : null;
		const m = (await readManifest(c.dir)) ?? emptyManifest(c.ctx.version, c.inputs.harness);
		const rec = m.items[id] ?? {
			id,
			kind: item.kind,
			target: item.target,
			bundle: item.kind === 'skill-dir' ? item.skill.name : BRIEF_MARKER,
			version: 'unknown',
			files: (receipt?.kind === 'files' && receipt.receipt) || {},
			writtenAt: (c.ctx.now?.() ?? new Date()).toISOString()
		};
		m.items[id] = { ...rec, kept: { local: hashes(local.tree), next } };
		await writeManifest(c.dir, m);
		return {
			ok: true,
			value: `Keeping ${item.target} as it is; Wheelhouse flags it again when a later version changes it.`
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
		const known = new Map<string, Planned>([
			...planned(c).map((p) => [p.id, p] as const),
			...Object.values(m?.items ?? {})
				.filter((r) => !planned(c).some((p) => p.id === r.id))
				.map((r) => [r.id, { kind: r.kind, id: r.id, target: r.target } as Planned] as const)
		]);
		const unknown = ids.filter((id) => !known.has(id));
		if (unknown.length) return { ok: false, error: `No such item: ${unknown.join(', ')}` };
		const off = await readOff(c.dir);
		const lines: string[] = [];
		for (const [id, item] of known) {
			if (ids.length && !ids.includes(id)) continue;
			const target = item.target;
			const rec = m?.items[id];
			const turnOff = (what: string) => {
				off.add(id);
				lines.push(
					`${what}; Wheelhouse will not install ${id} again until \`wheelhouse skills sync ${id}\`.`
				);
			};
			if (item.kind === 'launch-context') {
				// Wheelhouse's own file: its record stays, so the CLI still knows where it goes.
				await removeContext(target);
				turnOff(
					`Removed ${target}; a Firstmate session starting from now on gets no Wheelhouse context`
				);
				continue;
			}
			if (item.kind === 'managed-block') {
				const text = (await present(target)) ? await readFile(target, 'utf8') : '';
				const p = parseBlock(text, BRIEF_MARKER);
				const ours =
					p.state === 'absent' ||
					(p.state === 'one' && !!rec && sha256(p.body) === rec.files.block);
				if (!ours) {
					lines.push(
						`Left ${target}: ${p.state === 'broken' ? p.reason : 'its Wheelhouse block was edited, or Wheelhouse did not write it'}. Remove the block yourself if you no longer want it.`
					);
					continue;
				}
				if (p.state === 'one') {
					const mode = (await stat(target)).mode & 0o777;
					await writeAtomic(target, withoutBlock(text, BRIEF_MARKER)!, mode);
				}
				await forgetItem(c.dir, id);
				if (m) delete m.items[id];
				turnOff(`Removed Wheelhouse's block from ${target}`);
				continue;
			}
			const local = await readLocal(target);
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
			turnOff(`Removed ${target}`);
		}
		if (m) await writeManifest(c.dir, m);
		await writeOff(c.dir, off);
		return { ok: true, value: lines };
	});
}
