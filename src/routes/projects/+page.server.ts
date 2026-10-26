import { currentFleet, loadSlots } from '$lib/server/runtime';
import { repoUrl } from '$lib/server/repo';
import { slotKey } from '$lib/plugins/keys';
import { PROJECTS_VIEWS, VIEW_COOKIE, viewOf } from '$lib/views';
import type { PageServerLoad } from './$types';

// Each project's repository link and plugin tabs, and the remembered layout.
export const load: PageServerLoad = async ({ cookies }) => {
	const fleet = await currentFleet();
	const repos = await Promise.all(
		fleet.projects.map(async (p) => [p.id, await repoUrl(p.path).catch(() => null)] as const)
	);
	return {
		repos: Object.fromEntries(repos) as Record<string, string | null>,
		slots: await loadSlots(fleet.projects.map((p) => slotKey.project(p.id))),
		slotsAt: Date.now(),
		layout: viewOf(cookies.get(VIEW_COOKIE.projects), PROJECTS_VIEWS)
	};
};
