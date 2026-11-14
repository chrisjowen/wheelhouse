import path from 'node:path';
import { version } from '../../../../package.json';
import { parseHarness, type Harness } from '../../harness';
import type { FirstmateInstall } from '../firstmate/install';
import { defaultConfigDir } from '../plugins/config';
import type { PluginRegistry } from '../plugins/registry';
import {
	cached,
	gitHead,
	MaterialSync,
	reviewSurfaceOf,
	syncMaterial,
	type MaterialContext,
	type MaterialResult
} from './sync';

/**
 * The server's side of the agent material: the context it syncs with, and
 * the `MaterialSync` the runtime keeps. Only a server started by the
 * `wheelhouse` CLI (which sets WHEELHOUSE_INSTALL_DIR) installs anything.
 */

export function materialContext(
	install: Pick<FirstmateInstall, 'firstmateDir' | 'homeDir'>,
	env: NodeJS.ProcessEnv
): MaterialContext {
	return {
		install,
		env,
		configDir: defaultConfigDir(env),
		skillsRoot: env.WHEELHOUSE_INSTALL_DIR
			? path.join(env.WHEELHOUSE_INSTALL_DIR, 'skills')
			: undefined,
		version
	};
}

/** The harness Firstmate runs on, as the CLI chose it (claude when unset or unknown). */
export function serverHarness(env: NodeJS.ProcessEnv): Harness {
	try {
		return parseHarness(env.WHEELHOUSE_HARNESS);
	} catch {
		return 'claude';
	}
}

/** Sync once now, with the review surface the plugins name (setup's connection and finish). */
export async function syncForServer(
	install: Pick<FirstmateInstall, 'firstmateDir' | 'homeDir'>,
	env: NodeJS.ProcessEnv,
	plugins?: PluginRegistry
): Promise<MaterialResult> {
	const reviewSurface = plugins
		? reviewSurfaceOf(await plugins.roleProvider('review.surface'), plugins.status())
		: null;
	return syncMaterial(materialContext(install, env), {
		reviewSurface,
		harness: serverHarness(env)
	});
}

/** Firstmate's commit is read at most once a minute, though the fleet is collected far more often. */
const COMMIT_MS = 60_000;

export function materialSync(
	install: Pick<FirstmateInstall, 'firstmateDir' | 'homeDir'>,
	env: NodeJS.ProcessEnv,
	plugins: PluginRegistry,
	log: (line: string) => void
): MaterialSync {
	const commit = cached(() => gitHead(install.firstmateDir), COMMIT_MS);
	const ctx: MaterialContext = { ...materialContext(install, env), commit: () => commit() };
	return new MaterialSync(
		async () => ({
			reviewSurface: reviewSurfaceOf(
				await plugins.roleProvider('review.surface'),
				plugins.status()
			),
			harness: serverHarness(env),
			firstmateCommit: await commit()
		}),
		(inputs) => syncMaterial(ctx, inputs),
		log
	);
}
