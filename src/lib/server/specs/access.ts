import path from 'node:path';
import { json } from '@sveltejs/kit';
import { NO_STORE } from '../http';
import { getRuntime } from '../runtime';
import { defaultStateDir, isInside } from '../store/store';
import { SpecStore } from './store';

let cached: SpecStore | null = null;

/**
 * The spec drafts store, in `<state>/specs`. Refused when Wheelhouse's state
 * directory is inside the Firstmate home, which Wheelhouse never writes to.
 */
export async function specStore(
	env: NodeJS.ProcessEnv = process.env
): Promise<{ ok: true; store: SpecStore } | { ok: false; reason: string }> {
	const stateDir = defaultStateDir(env);
	const runtime = await getRuntime();
	if (runtime.configured && isInside(stateDir, runtime.install.homeDir)) {
		return {
			ok: false,
			reason: `The Wheelhouse state directory ${stateDir} is inside the Firstmate home, so specs cannot be saved; choose one outside it with --state-dir.`
		};
	}
	const dir = path.join(stateDir, 'specs');
	if (cached?.dir !== dir) cached = new SpecStore(dir);
	return { ok: true, store: cached };
}

/** The store, or the 503 response that explains why there is none. */
export async function specStoreOrResponse(): Promise<SpecStore | Response> {
	const s = await specStore();
	return s.ok ? s.store : json({ message: s.reason }, { status: 503, headers: NO_STORE });
}

export const notFound = () =>
	json({ message: 'That spec no longer exists.' }, { status: 404, headers: NO_STORE });
