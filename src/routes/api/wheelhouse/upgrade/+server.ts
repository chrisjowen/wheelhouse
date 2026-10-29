import { json } from '@sveltejs/kit';
import { NO_STORE } from '$lib/server/http';
import { updateService } from '$lib/server/upgrade/service';
import type { RequestHandler } from './$types';

/**
 * Upgrade Wheelhouse: fast-forward its clone, reinstall, rebuild and restart.
 * Answers 202 at once; GET /api/wheelhouse/update follows the steps. 409 when
 * it cannot start (another change under way, or no watcher to restart it).
 */
export const POST: RequestHandler = async () => {
	const s = updateService();
	const r = s.startUpgrade();
	if (!r.ok) return json({ message: r.error }, { status: 409, headers: NO_STORE });
	return json(await s.wheelhouse(), { status: 202, headers: NO_STORE });
};
