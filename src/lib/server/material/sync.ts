import { execFile } from 'node:child_process';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import type { Harness } from '../../harness';
import type { MaterialHealth } from '../../types';
import type { PluginStatus, RoleProvider } from '../../plugins/types';
import { parseBlock, renderBlock, withBlock } from './block';
import { renderSkill, SKILLS, type ReviewSurface } from './bundle';
import {
	hashTree,
	insideAny,
	present,
	sameHashes,
	sha256,
	writeAtomic,
	type Hashes,
	type Tree
} from './files';
import {
	emptyManifest,
	materialDir,
	readManifest,
	readOff,
	saveBase,
	saveProposed,
	serialize,
	writeManifest,
	type AssumptionCheck,
	type ItemKind,
	type Manifest,
	type ManifestItem
} from './manifest';
import { readLocal, receiptText, swapIn, type Local } from './skilldir';
import { rootsFor, skillRootDir } from './targets';

/**
 * Bring everything Wheelhouse installs for Firstmate up to this version, item
 * by item, comparing three versions of each: what Wheelhouse last wrote (the
 * manifest's base, or an older install's receipt), what is there now, and what
 * this version would write.
 *
 *   nothing there                    install
 *   already this version             current
 *   unchanged since Wheelhouse wrote replace (updated)
 *   edited since                     leave it; hold the new version in proposed/ (modified)
 *   never Wheelhouse's               leave it (foreign); `wheelhouse skills adopt` replaces it
 *
 * Nothing is written inside Firstmate's checkout or home, except a managed
 * block in a file git ignores there: a file git sees would stop Firstmate's own
 * updates, which skip a checkout with untracked files.
 */

export type ItemState =
	| 'installed'
	| 'updated'
	| 'current'
	| 'kept'
	| 'modified'
	| 'foreign'
	| 'refused'
	| 'off'
	| 'error';

export interface ItemResult {
	id: string;
	kind: ItemKind;
	target: string;
	state: ItemState;
	message: string;
}

export interface MaterialResult {
	state: 'ok' | 'attention' | 'disabled' | 'error';
	/** One line for the server's output and the setup page. */
	message: string;
	items: ItemResult[];
	/** Firstmate contracts the bundled skills rely on that its checkout no longer has. */
	drift: AssumptionCheck[];
}

export interface SyncInputs {
	reviewSurface: ReviewSurface | null;
	harness: Harness;
}

export interface MaterialContext {
	install: { firstmateDir: string; homeDir: string };
	env: NodeJS.ProcessEnv;
	/** Wheelhouse's config folder, which keeps the manifest. */
	configDir: string;
	/** The installed package's `skills/` folder; none for a development server, which leaves everything alone. */
	skillsRoot?: string;
	version: string;
	now?: () => Date;
	/** Firstmate's checkout HEAD, or null when git cannot say. */
	commit?: (dir: string) => Promise<string | null>;
}

export const skillId = (name: string, root: string) => `skill:${name}@${root}`;

/** The skills this harness gets, with their ids and targets. */
export function plannedSkills(env: NodeJS.ProcessEnv, harness: Harness) {
	return SKILLS.flatMap((skill) =>
		rootsFor(harness).map((root) => ({
			id: skillId(skill.name, root),
			skill,
			target: path.join(skillRootDir(root, env), skill.name)
		}))
	);
}

type Decision = 'install' | 'current' | 'update' | 'modified' | 'foreign' | 'kept';

/** The three-way comparison above, for one item. */
export function decide(o: {
	local: Hashes | null | 'unreadable';
	next: Hashes;
	/** What Wheelhouse is known to have written there: the manifest's base and any receipt. */
	bases: Hashes[];
	kept?: { local: Hashes; next: Hashes };
}): Decision {
	if (o.local === 'unreadable') return 'foreign';
	if (o.local === null) return 'install';
	if (!o.bases.length) return 'foreign';
	const local = o.local;
	if (sameHashes(local, o.next)) return 'current';
	if (o.kept && sameHashes(local, o.kept.local) && sameHashes(o.next, o.kept.next)) return 'kept';
	return o.bases.some((b) => sameHashes(local, b)) ? 'update' : 'modified';
}

/** A decision as the state it leaves (a dry run reports what a sync would do). */
const AS_STATE: Record<Decision, ItemState> = {
	install: 'installed',
	update: 'updated',
	current: 'current',
	kept: 'kept',
	modified: 'modified',
	foreign: 'foreign'
};

const localHashes = (l: Local) =>
	l.kind === 'absent' ? null : l.kind === 'unreadable' ? 'unreadable' : hashTree(l.tree);

function message(state: ItemState, id: string, target: string, detail?: string): string {
	switch (state) {
		case 'installed':
			return `Wheelhouse skill installed at ${target}.`;
		case 'updated':
			return `Wheelhouse skill updated at ${target}.`;
		case 'current':
			return `Wheelhouse skill is current at ${target}.`;
		case 'kept':
			return `Wheelhouse skill at ${target} keeps its local edits, as asked.`;
		case 'modified':
			return `Left ${target} unchanged: it was locally edited${detail ? ` (${detail})` : ''}. \`wheelhouse skills diff ${id}\` compares it with this version; \`accept\` or \`keep\` settles it.`;
		case 'foreign':
			return `Left ${target} unchanged: not managed by Wheelhouse${detail ? ` (${detail})` : ''}. \`wheelhouse skills adopt ${id}\` replaces it with the bundled version.`;
		case 'refused':
			return `Left ${target} unchanged: ${detail ?? "it is inside Firstmate's checkout or home"}.`;
		case 'off':
			return `${id} is turned off; \`wheelhouse skills sync ${id}\` turns it on again.`;
		case 'error':
			return `Could not install Wheelhouse skill at ${target}: ${detail}`;
	}
}

function record(
	m: Manifest,
	id: string,
	kind: ItemKind,
	target: string,
	bundle: string,
	version: string,
	files: Hashes,
	now: Date
): void {
	m.items[id] = { id, kind, target, bundle, version, files, writtenAt: now.toISOString() };
}

async function syncSkill(
	ctx: MaterialContext,
	dir: string,
	m: Manifest,
	item: SkillItem,
	tree: Tree,
	dryRun: boolean
): Promise<ItemResult> {
	const { id, target } = item;
	const result = (state: ItemState, detail?: string): ItemResult => ({
		id,
		kind: 'skill-dir',
		target,
		state,
		message: message(state, id, target, detail)
	});
	if (
		await insideAny([path.dirname(target), target], [ctx.install.firstmateDir, ctx.install.homeDir])
	)
		return result('refused', "user skills location is inside Firstmate's checkout or home");
	const next = hashTree(tree);
	const rec: ManifestItem | undefined = m.items[id];
	const verdict = (l: Local) =>
		decide({
			local: localHashes(l),
			next,
			bases: [rec?.files, l.kind === 'files' ? l.receipt : null].filter((b): b is Hashes => !!b),
			kept: rec?.kept
		});
	const now = await readLocal(target);
	const first = verdict(now);
	const at = ctx.now?.() ?? new Date();
	if (dryRun) {
		return result(AS_STATE[first], now.kind === 'unreadable' ? now.reason : undefined);
	}
	if (first === 'install' || first === 'update') {
		const outcome = await swapIn(target, tree, receiptText(ctx.version, next), (l) => {
			const v = verdict(l);
			return v === 'install' || v === 'update' ? 'replace' : v === 'current' ? 'done' : 'stop';
		});
		if (outcome === 'stop') return syncSkill(ctx, dir, m, item, tree, dryRun);
		record(m, id, 'skill-dir', target, item.skill.name, ctx.version, next, at);
		await saveBase(dir, id, tree);
		await saveProposed(dir, id, null);
		return result(
			outcome === 'swapped' ? (first === 'install' ? 'installed' : 'updated') : 'current'
		);
	}
	if (first === 'current') {
		// An install from before the manifest (its receipt alone said it was ours) gets its record now.
		if (!rec || !sameHashes(rec.files, next) || rec.kept) {
			record(m, id, 'skill-dir', target, item.skill.name, ctx.version, next, at);
			await saveBase(dir, id, tree);
		}
		await saveProposed(dir, id, null);
		return result('current');
	}
	if (first === 'modified') {
		if (!rec && now.kind === 'files' && now.receipt)
			record(m, id, 'skill-dir', target, item.skill.name, 'unknown', now.receipt, at);
		await saveProposed(dir, id, tree);
		return result('modified');
	}
	return result(first, now.kind === 'unreadable' ? now.reason : undefined);
}

/** A planned skill item (plannedSkills). */
export type SkillItem = ReturnType<typeof plannedSkills>[number];

/**
 * Put this version in place whatever is there now (`wheelhouse skills adopt`
 * and `accept`, which back the old copy up first). A symbolic link is still
 * never replaced: it may point anywhere.
 */
export async function installOver(
	ctx: MaterialContext,
	dir: string,
	m: Manifest,
	item: SkillItem,
	tree: Tree
): Promise<void> {
	const next = hashTree(tree);
	const outcome = await swapIn(item.target, tree, receiptText(ctx.version, next), (l) =>
		l.kind === 'unreadable' ? 'stop' : 'replace'
	);
	if (outcome === 'stop')
		throw new Error(`${item.target} is a symbolic link or holds one; move it aside first`);
	record(
		m,
		item.id,
		'skill-dir',
		item.target,
		item.skill.name,
		ctx.version,
		next,
		ctx.now?.() ?? new Date()
	);
	await saveBase(dir, item.id, tree);
	await saveProposed(dir, item.id, null);
}

/** Whether git ignores `file` in the repository holding it. */
export function gitIgnored(file: string): Promise<boolean> {
	return new Promise((resolve) =>
		execFile(
			'git',
			['-C', path.dirname(file), 'check-ignore', '-q', '--', path.basename(file)],
			{ timeout: 5000 },
			(error) => resolve(!error)
		)
	);
}

/** A block Wheelhouse keeps inside a file someone else owns (block.ts). */
export interface BlockSpec {
	id: string;
	/** The marker name, e.g. `wheelhouse`. */
	name: string;
	target: string;
	body: string;
}

/** Bring one managed block up to `spec.body`, by the same three-way rules as a skill. */
export async function syncBlock(
	ctx: MaterialContext,
	dir: string,
	m: Manifest,
	spec: BlockSpec,
	dryRun = false
): Promise<ItemResult> {
	const { id, target } = spec;
	const result = (state: ItemState, detail?: string): ItemResult => ({
		id,
		kind: 'managed-block',
		target,
		state,
		message:
			state === 'installed' || state === 'updated' || state === 'current'
				? `Wheelhouse block ${state === 'current' ? 'is current' : state} in ${target}.`
				: message(state, id, target, detail)
	});
	if (
		(await insideAny([target], [ctx.install.firstmateDir, ctx.install.homeDir])) &&
		!(await gitIgnored(target))
	)
		return result(
			'refused',
			"git does not ignore it in Firstmate's checkout, and a file git sees stops Firstmate's own updates"
		);
	let text = '';
	let mode = 0o644;
	if (await present(target)) {
		text = await readFile(target, 'utf8');
		mode = (await stat(target)).mode & 0o777;
	}
	const parsed = parseBlock(text, spec.name);
	if (parsed.state === 'broken') return result('modified', parsed.reason);
	const next = { block: sha256(spec.body) };
	const rec = m.items[id];
	const first = decide({
		local: parsed.state === 'absent' ? null : { block: sha256(parsed.body) },
		next,
		bases: rec ? [rec.files] : [],
		kept: rec?.kept
	});
	if (dryRun) return result(AS_STATE[first]);
	const now = ctx.now?.() ?? new Date();
	if (first === 'install' || first === 'update') {
		const updated = withBlock(text, spec.name, renderBlock(spec.name, ctx.version, spec.body))!;
		await writeAtomic(target, updated, mode);
	}
	if (first === 'install' || first === 'update' || first === 'current') {
		if (!rec || !sameHashes(rec.files, next) || rec.kept)
			record(m, id, 'managed-block', target, spec.name, ctx.version, next, now);
		await saveBase(dir, id, { 'block.md': spec.body });
		await saveProposed(dir, id, null);
	} else if (first === 'modified') {
		await saveProposed(dir, id, { 'block.md': spec.body });
	}
	return result(AS_STATE[first]);
}

/** Firstmate's checkout HEAD, or null when it is not a git checkout git can read. */
export function gitHead(dir: string): Promise<string | null> {
	return new Promise((resolve) =>
		execFile('git', ['-C', dir, 'rev-parse', 'HEAD'], { timeout: 5000 }, (error, stdout) =>
			resolve(error ? null : stdout.trim() || null)
		)
	);
}

async function checkAssumptions(firstmateDir: string): Promise<AssumptionCheck[]> {
	const checks: AssumptionCheck[] = [];
	const seen = new Set<string>();
	for (const a of SKILLS.flatMap((s) => s.assumptions)) {
		const key = `${a.file}\0${a.marker}`;
		if (seen.has(key)) continue;
		seen.add(key);
		let text = '';
		try {
			text = await readFile(path.join(firstmateDir, a.file), 'utf8');
		} catch {
			/* a missing file drops its markers */
		}
		checks.push({ ...a, present: text.includes(a.marker) });
	}
	return checks;
}

function summary(items: ItemResult[], drift: AssumptionCheck[]): MaterialResult {
	const notable = items.filter((i) => i.state !== 'current' && i.state !== 'off');
	const lines = (notable.length ? notable : items).map((i) => i.message);
	if (drift.length)
		lines.push(
			`Firstmate's checkout no longer has ${drift.map((d) => `\`${d.marker}\` in ${d.file}`).join(', ')}, which the bundled skills rely on; they may describe it wrongly until Wheelhouse is updated.`
		);
	const state = items.some((i) => i.state === 'error')
		? 'error'
		: drift.length ||
			  items.some((i) => i.state === 'modified' || i.state === 'foreign' || i.state === 'refused')
			? 'attention'
			: 'ok';
	return { state, message: lines.join(' ') || 'Wheelhouse installs nothing here.', items, drift };
}

const disabled = (message: string): MaterialResult => ({
	state: 'disabled',
	message,
	items: [],
	drift: []
});

/**
 * Sync every bundled item for `inputs` (or only `only`), recording the outcome in
 * the manifest. `dryRun` reports what a sync would do and changes nothing.
 */
export async function syncMaterial(
	ctx: MaterialContext,
	inputs: SyncInputs,
	opts: { dryRun?: boolean; only?: string[] } = {}
): Promise<MaterialResult> {
	if (ctx.env.WHEELHOUSE_MANAGE_SKILL === '0')
		return disabled('Wheelhouse skill installation is disabled.');
	if (!ctx.skillsRoot)
		return disabled(
			'Wheelhouse skill is left as it is: only the packaged Wheelhouse server installs it.'
		);
	const skillsRoot = ctx.skillsRoot;
	const dir = materialDir(ctx.configDir);
	const dryRun = opts.dryRun ?? false;
	return serialize(dir, async () => {
		const m = (await readManifest(dir, dryRun)) ?? emptyManifest(ctx.version, inputs.harness);
		const off = await readOff(dir);
		const items: ItemResult[] = [];
		const trees = new Map<string, Tree | Error>();
		for (const item of plannedSkills(ctx.env, inputs.harness)) {
			if (opts.only && !opts.only.includes(item.id)) continue;
			if (off.has(item.id)) {
				items.push({
					id: item.id,
					kind: 'skill-dir',
					target: item.target,
					state: 'off',
					message: message('off', item.id, item.target)
				});
				continue;
			}
			let tree = trees.get(item.skill.name);
			if (!tree) {
				tree = await renderSkill(skillsRoot, item.skill, inputs).catch((e: Error) => e);
				trees.set(item.skill.name, tree);
			}
			try {
				if (tree instanceof Error) throw tree;
				items.push(await syncSkill(ctx, dir, m, item, tree, dryRun));
			} catch (e) {
				items.push({
					id: item.id,
					kind: 'skill-dir',
					target: item.target,
					state: 'error',
					message: message('error', item.id, item.target, (e as Error).message)
				});
			}
		}
		const assumptions = await checkAssumptions(ctx.install.firstmateDir);
		const drift = assumptions.filter((a) => !a.present);
		if (!dryRun) {
			const now = (ctx.now?.() ?? new Date()).toISOString();
			m.firstmate = {
				dir: ctx.install.firstmateDir,
				home: ctx.install.homeDir,
				commit: await (ctx.commit ?? gitHead)(ctx.install.firstmateDir),
				checkedAt: now,
				assumptions
			};
			m.render = { reviewSurface: inputs.reviewSurface, harness: inputs.harness };
			const changes = items
				.filter((i) => i.state === 'installed' || i.state === 'updated')
				.map((i) => ({ id: i.id, state: i.state }));
			if (changes.length) m.history.push({ at: now, version: ctx.version, changes });
			m.wheelhouse = { version: ctx.version };
			try {
				await writeManifest(dir, m);
			} catch (e) {
				return {
					...summary(items, drift),
					state: 'error',
					message: `Could not record Wheelhouse's agent material in ${dir}: ${(e as Error).message}`
				};
			}
		}
		return summary(items, drift);
	}).catch((e: Error): MaterialResult => ({
		state: 'error',
		message: `Could not sync Wheelhouse's agent material in ${dir}: ${e.message}`,
		items: [],
		drift: []
	}));
}

/** The review surface as the skill names it: the active provider, with its repository when installed. */
export function reviewSurfaceOf(
	active: RoleProvider | null,
	statuses: PluginStatus[]
): ReviewSurface | null {
	if (!active) return null;
	const status = statuses.find((s) => s.id === active.id && s.state === 'loaded');
	return { id: active.id, name: active.name, repository: status?.repository ?? null };
}

const RETRY_MS = 60_000;

/** What `MaterialSync` re-syncs on: the render inputs, and Firstmate's commit for its drift check. */
export interface SyncKey extends SyncInputs {
	firstmateCommit: string | null;
}

/**
 * Keeps the installed material current for the server: `sync` runs a full sync
 * whenever the review surface, the harness or Firstmate's commit differs from
 * the last one synced, so choosing another review surface, or a Firstmate
 * update, reaches the skills and the drift check. Calls run one at a time; a
 * failed sync is tried again on a later call, at most once a minute for the same
 * inputs, and its failure is logged only when its message changes.
 */
export class MaterialSync {
	private last: string | undefined;
	private chain: Promise<unknown> = Promise.resolve();
	private failed: { key: string; at: number; message: string } | null = null;
	private latest: MaterialResult | null = null;

	constructor(
		private readonly inputs: () => Promise<SyncKey>,
		private readonly run: (inputs: SyncInputs) => Promise<MaterialResult>,
		private readonly log: (line: string) => void = () => {},
		private readonly now: () => number = Date.now
	) {}

	/** Sync when the inputs changed; null when they had not. */
	sync(): Promise<MaterialResult | null> {
		const run = this.chain.then(async () => {
			const inputs = await this.inputs();
			const key = JSON.stringify(inputs);
			if (key === this.last) return null;
			const f = this.failed;
			if (f?.key === key && this.now() - f.at < RETRY_MS) return null;
			const r = await this.run({ reviewSurface: inputs.reviewSurface, harness: inputs.harness });
			this.latest = r;
			if (r.state === 'error') {
				this.last = undefined;
				this.failed = { key, at: this.now(), message: r.message };
				if (f?.message !== r.message) this.log(r.message);
			} else {
				this.last = key;
				this.failed = null;
				this.log(r.message);
			}
			return r;
		});
		this.chain = run.catch(() => {});
		return run;
	}

	/** The last sync's outcome, for /api/health. */
	view(): MaterialHealth {
		const r = this.latest;
		if (!r) return { state: 'unknown', message: null, items: [], drift: [] };
		return {
			state: r.state,
			message: r.message,
			items: r.items.map(({ id, state, target }) => ({ id, state, target })),
			drift: r.drift.map(({ file, marker }) => ({ file, marker }))
		};
	}
}

/** `fn`'s answer, asked again only once `ms` have passed. */
export function cached<T>(fn: () => Promise<T>, ms: number, now: () => number = Date.now) {
	let at = -Infinity;
	let value: Promise<T> | null = null;
	return (): Promise<T> => {
		if (!value || now() - at >= ms) {
			at = now();
			value = fn();
		}
		return value;
	};
}
