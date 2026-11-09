/**
 * Where the desk keeps its state, worked out the same way by the desk, the
 * CLI and Wheelhouse's plugin: $WH_REVIEW_STATE, else Wheelhouse's own state
 * folder (as Wheelhouse works it out) with plugins/shared-review under it.
 * No dependencies, so Wheelhouse's plugin entry can import it alone.
 */

import path from 'node:path';

export function stateDir(env = process.env) {
	if (env.WH_REVIEW_STATE) return path.resolve(env.WH_REVIEW_STATE);
	const base = env.WHEELHOUSE_STATE_DIR
		? path.resolve(env.WHEELHOUSE_STATE_DIR)
		: env.XDG_STATE_HOME
			? path.join(path.resolve(env.XDG_STATE_HOME), 'wheelhouse')
			: path.join(env.HOME ?? '', '.local', 'state', 'wheelhouse');
	return path.join(base, 'plugins', 'shared-review');
}

/** What the desk's health check names itself, so Wheelhouse tells it from anything else on its port. */
export const DESK_SERVICE = 'wheelhouse-shared-review-desk';
