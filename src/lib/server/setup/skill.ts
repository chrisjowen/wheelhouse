import { createHash } from 'node:crypto';
import {
	lstat,
	mkdir,
	mkdtemp,
	readFile,
	readdir,
	realpath,
	rename,
	rm,
	writeFile
} from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { version } from '../../../../package.json';
import type { FirstmateInstall } from '../firstmate/install';

const NAME = 'manage-wheelhouse';
const RECEIPT = '.wheelhouse-managed.json';
const FILES = ['SKILL.md', 'references/operations.md'];
const hash = (text: string) => createHash('sha256').update(text).digest('hex');

/** The line in the bundled SKILL.md that the review surface's section replaces. */
export const REVIEW_SURFACE_MARKER = '<!-- wheelhouse:review-surface -->';

/** The plugin that is the review surface now (lib/plugins/types.ts ROLES), or null for the built-in. */
export interface ReviewSurface {
	id: string;
	name: string;
	/** An installed plugin's repository, `org/repo`, where its own instructions are. */
	repository?: string | null;
}

/** A plugin's name as the skill may quote it: one short line of plain characters. */
const plain = (s: string) =>
	s
		.replace(/[^\p{L}\p{N} ._()-]+/gu, ' ')
		.replace(/\s+/g, ' ')
		.trim()
		.slice(0, 60) || 'the plugin';

/**
 * What the skill tells Firstmate and its crew about the review surface: the
 * built-in (Lavish boards, and live previews with Wheelhouse's preview helper),
 * or the plugin the captain chose, used instead of Lavish for anything shown
 * to the captain. Rewritten, and the skill reinstalled, whenever it changes.
 */
export function reviewSurfaceSection(surface: ReviewSurface | null): string {
	if (!surface) {
		return [
			'Active review surface: **built-in**. Firstmate’s Lavish boards and Wheelhouse’s live preview, with its preview helper, are how the captain reviews work.',
			'Show the captain an HTML artifact as Firstmate’s own Lavish rule says, and a running app by reporting `preview <url>` (see Preview cards below).',
			'Wheelhouse rewrites this section when the captain chooses a review-surface plugin in Settings → Plugins (`GET /api/plugins` lists `roles`).'
		].join(' ');
	}
	const name = plain(surface.name);
	const where = surface.repository
		? `its README in https://github.com/${surface.repository}`
		: '`wheelhouse plugin list` and `GET /api/plugins`';
	return [
		`Active review surface: **${name}** (the \`${surface.id}\` plugin), chosen by the captain in Wheelhouse Settings → Plugins. While it is on it replaces Lavish and Wheelhouse’s preview helper.`,
		'',
		`- Use ${name} instead of Lavish for anything you or a worker would show the captain: an HTML artifact, a board, a design, a running app. This overrides the Lavish line in scout and worker briefs: open no Lavish board for the captain while this section names a plugin, and when you write a brief, tell the worker to use ${name} instead of Lavish.`,
		`- A running app still reports \`preview <url>\` (see Preview cards below); Wheelhouse shows ${name}’s button as the primary action on that preview, with no preview helper or board link.`,
		`- How to use ${name} is the plugin’s own; see ${where}. When it cannot show something, tell the captain rather than quietly falling back to Lavish.`,
		`- Wheelhouse rewrites this section whenever the role changes: the captain chooses another plugin or the built-in, or turns ${name} off or removes it.`
	].join('\n');
}

/** The bundled SKILL.md with its review surface section in place of its marker line. */
const renderSkill = (text: string, surface: ReviewSurface | null): string =>
	text.replace(REVIEW_SURFACE_MARKER, () => reviewSurfaceSection(surface));

export interface SkillResult {
	state: 'installed' | 'updated' | 'current' | 'skipped' | 'error' | 'disabled';
	message: string;
}

/** Resolve existing ancestors too, so a symlinked user config cannot enter the checkout. */
async function physical(file: string): Promise<string> {
	try {
		return await realpath(file);
	} catch (e) {
		if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
		const parent = path.dirname(file);
		if (parent === file) throw e;
		return path.join(await physical(parent), path.basename(file));
	}
}

async function present(file: string): Promise<boolean> {
	try {
		await lstat(file);
		return true;
	} catch (e) {
		if ((e as NodeJS.ErrnoException).code === 'ENOENT') return false;
		throw e;
	}
}

/** All entries must be ordinary files/directories; unexpected files count as local edits. */
async function contents(dir: string, prefix = ''): Promise<Record<string, string>> {
	const result: Record<string, string> = {};
	for (const entry of await readdir(dir, { withFileTypes: true })) {
		const rel = prefix + entry.name;
		if (entry.isDirectory())
			Object.assign(result, await contents(path.join(dir, entry.name), rel + '/'));
		else if (entry.isFile()) result[rel] = hash(await readFile(path.join(dir, entry.name), 'utf8'));
		else throw new Error('The skill contains a symbolic link or special file.');
	}
	return result;
}

/** What is at `target`: nothing, our current bundle, an older unchanged bundle of ours, or a copy we must not touch. */
async function inspect(
	target: string,
	hashes: Record<string, string>
): Promise<'absent' | 'current' | 'managed' | 'foreign'> {
	if (!(await present(target))) return 'absent';
	try {
		if (!(await lstat(target)).isDirectory()) return 'foreign';
		const receipt = JSON.parse(await readFile(path.join(target, RECEIPT), 'utf8'));
		const actual = await contents(target);
		delete actual[RECEIPT];
		const unchanged =
			receipt.schema === 'wheelhouse-skill.v1' &&
			receipt.files &&
			Object.keys(actual).length === Object.keys(receipt.files).length &&
			Object.entries(actual).every(([file, digest]) => receipt.files[file] === digest);
		if (!unchanged) return 'foreign';
		return receipt.version === version &&
			Object.keys(actual).length === Object.keys(hashes).length &&
			Object.entries(hashes).every(([file, digest]) => actual[file] === digest)
			? 'current'
			: 'managed';
	} catch {
		/* Moved away mid-read by another Wheelhouse; an unowned or locally changed copy is never overwritten. */
		return (await present(target)) ? 'foreign' : 'absent';
	}
}

/**
 * Claude Code user skills, shared by Firstmate sessions for this OS user.
 * No writes to Firstmate's checkout or operational home. A missing/invalid receipt
 * never establishes ownership, even when the existing content resembles our bundle.
 * `surface` is the review surface now (see reviewSurfaceSection): a change to it
 * changes SKILL.md, so the next call replaces an unchanged earlier install.
 */
export async function installWheelhouseSkill(
	install: FirstmateInstall,
	env: NodeJS.ProcessEnv,
	sourceDir = path.join(env.WHEELHOUSE_INSTALL_DIR || process.cwd(), 'skills', NAME),
	surface: ReviewSurface | null = null
): Promise<SkillResult> {
	if (env.WHEELHOUSE_MANAGE_SKILL === '0')
		return { state: 'disabled', message: 'Wheelhouse skill installation is disabled.' };
	const parent = path.resolve(
		env.CLAUDE_CONFIG_DIR || path.join(env.HOME || homedir(), '.claude'),
		'skills'
	);
	const target = path.join(parent, NAME);
	const current: SkillResult = {
		state: 'current',
		message: `Wheelhouse skill is current at ${target}.`
	};
	let stage: string | null = null;
	try {
		const destinations = [await physical(parent), await physical(target)];
		for (const dir of [install.firstmateDir, install.homeDir]) {
			const protectedDir = await physical(path.resolve(dir));
			if (
				destinations.some(
					(destination) =>
						destination === protectedDir || destination.startsWith(protectedDir + path.sep)
				)
			)
				return {
					state: 'skipped',
					message: `Left ${target} unchanged: user skills location is inside Firstmate's checkout or home.`
				};
		}
		await mkdir(parent, { recursive: true });
		const files = Object.fromEntries(
			await Promise.all(
				FILES.map(async (file) => {
					const text = await readFile(path.join(sourceDir, file), 'utf8');
					return [file, file === 'SKILL.md' ? renderSkill(text, surface) : text] as const;
				})
			)
		);
		const hashes = Object.fromEntries(
			Object.entries(files).map(([file, text]) => [file, hash(text)])
		);
		const found = await inspect(target, hashes);
		if (found === 'current') return current;
		if (found === 'foreign')
			return {
				state: 'skipped',
				message: `Left ${target} unchanged: locally edited or not managed by Wheelhouse. Move it aside to install the bundled skill.`
			};
		let now: Awaited<ReturnType<typeof inspect>> = found;
		const exists = found === 'managed';
		stage = await mkdtemp(path.join(parent, '.wheelhouse-skill-'));
		for (const [file, text] of Object.entries(files)) {
			await mkdir(path.dirname(path.join(stage, file)), { recursive: true });
			await writeFile(path.join(stage, file), text);
		}
		await writeFile(
			path.join(stage, RECEIPT),
			JSON.stringify({ schema: 'wheelhouse-skill.v1', version, files: hashes }) + '\n'
		);
		// Keep the previous complete directory available for rollback until replacement succeeds.
		const backup = stage + '-previous';
		for (let attempt = 1; ; attempt++) {
			let error: unknown = new Error('another copy appeared while installing');
			// A copy that looks foreign may be one another Wheelhouse is swapping; never replace it.
			if (now !== 'foreign')
				try {
					if (now === 'managed') await rename(target, backup);
					await rename(stage, target);
					break;
				} catch (e) {
					error = e;
					await rename(backup, target).catch(() => {});
				} finally {
					await rm(backup, { recursive: true, force: true });
				}
			// Another Wheelhouse may be swapping in this same bundle; look again once it settles.
			now = await inspect(target, hashes);
			if (now === 'current') return current;
			if (attempt === 20) throw error;
			await new Promise((resolve) => setTimeout(resolve, 10 * attempt));
		}
		stage = null;
		return {
			state: exists ? 'updated' : 'installed',
			message: `Wheelhouse skill ${exists ? 'updated' : 'installed'} at ${target}.`
		};
	} catch (e) {
		return {
			state: 'error',
			message: `Could not install Wheelhouse skill at ${target}: ${(e as Error).message}`
		};
	} finally {
		if (stage) await rm(stage, { recursive: true, force: true });
	}
}
