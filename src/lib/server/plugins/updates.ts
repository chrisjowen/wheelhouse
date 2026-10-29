import { tmpdir } from 'node:os';
import type { PluginUpdateView, PluginUpdatesView } from '../../updates';
import { newerTag, parseLsRemote } from '../upgrade/versions';
import { runGit, type Git, type Source } from './install';
import { readInstalled, type InstalledRecord } from './installed';

/**
 * Whether each installed plugin has something newer on GitHub, from one
 * `git ls-remote` of its repository; nothing is fetched or changed.
 *
 * - Installed from the default branch or a branch: newer when that branch has
 *   moved past the pinned commit (`available`).
 * - Installed at a release tag: `newer-tag` when the repository has a newer
 *   release tag, which `wheelhouse plugin update <id> --ref <tag>` moves to;
 *   `available` when the tag itself now names another commit.
 * - Installed at a commit: `pinned`, never checked.
 */

export type { PluginUpdateView, PluginUpdatesView } from '../../updates';

export interface UpdateCheckDeps {
	git?: Git;
	gitUrl?: (s: Source) => string;
}

const githubUrl = (s: Source) => `https://github.com/${s.org}/${s.repo}.git`;
const SHA = /^[0-9a-f]{7,40}$/;

/** The update state of one installed plugin. */
export async function checkPlugin(
	id: string,
	r: InstalledRecord,
	deps: UpdateCheckDeps = {}
): Promise<PluginUpdateView> {
	const base = {
		id,
		repository: r.repository,
		ref: r.ref,
		commit: r.commit,
		version: r.version,
		latest: null,
		reason: null
	};
	const [org, repo] = r.repository.split('/');
	const url = (deps.gitUrl ?? githubUrl)({ org, repo, ref: r.ref });
	const res = await (deps.git ?? runGit)(['ls-remote', url], tmpdir());
	if (res.code !== 0) {
		const why = res.stderr.trim().split('\n').pop() || 'git ls-remote failed';
		return { ...base, state: 'error', reason: `could not reach ${r.repository}: ${why}` };
	}
	const refs = parseLsRemote(res.stdout);
	const moved = (commit: string | null | undefined, ref: string | null) =>
		commit && commit !== r.commit
			? { ...base, state: 'available' as const, latest: { ref, commit } }
			: { ...base, state: 'current' as const };

	if (r.ref === null) return moved(refs.head, null);
	if (refs.tags.has(r.ref)) {
		const tag = newerTag(r.ref, [...refs.tags.keys()]);
		if (tag) {
			return {
				...base,
				state: 'newer-tag',
				latest: { ref: tag, commit: refs.tags.get(tag) as string }
			};
		}
		return moved(refs.tags.get(r.ref), r.ref);
	}
	if (refs.heads.has(r.ref)) return moved(refs.heads.get(r.ref), r.ref);
	if (SHA.test(r.ref)) return { ...base, state: 'pinned' };
	return {
		...base,
		state: 'error',
		reason: `${r.repository} has no branch or tag ${r.ref} any more`
	};
}

/** The update state of every installed plugin in `dir`, checked side by side. */
export async function checkPlugins(
	dir: string,
	deps: UpdateCheckDeps & { now?: () => Date } = {}
): Promise<PluginUpdatesView> {
	const checkedAt = (deps.now?.() ?? new Date()).toISOString();
	const installed = await readInstalled(dir);
	if (!installed.ok) {
		return {
			schema: 'wheelhouse-plugin-updates.v1',
			checkedAt,
			plugins: [],
			error: installed.error
		};
	}
	const rows = Object.entries(installed.installed.plugins).sort(([a], [b]) => a.localeCompare(b));
	return {
		schema: 'wheelhouse-plugin-updates.v1',
		checkedAt,
		plugins: await Promise.all(rows.map(([id, r]) => checkPlugin(id, r, deps))),
		error: null
	};
}
