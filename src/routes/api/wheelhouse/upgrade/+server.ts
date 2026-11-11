import { json } from '@sveltejs/kit';
import { NO_STORE } from '$lib/server/http';
import { updateService } from '$lib/server/upgrade/service';
import type { RequestHandler } from './$types';

/**
 * Upgrade Wheelhouse from the chosen update source (published: `npm install
 * -g`; github: fast-forward its clone, reinstall, rebuild), then restart.
 * Answers 202 once it starts; GET /api/wheelhouse/update follows the steps. 409 when
 * it cannot start (another change under way, no watcher to restart it, or the
 * source does not match how Wheelhouse is installed).
 */
export const POST: RequestHandler = async () => {
	const s = updateService();
	const r = await s.startUpgrade();
	if (!r.ok) return json({ message: r.error }, { status: 409, headers: NO_STORE });
	return json(await s.wheelhouse(), { status: 202, headers: NO_STORE });
};
