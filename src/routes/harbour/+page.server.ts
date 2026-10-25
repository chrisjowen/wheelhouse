import { redirect } from '@sveltejs/kit';
import { currentFleet, loadSlots } from '$lib/server/runtime';
import { projectTabHref, slotKey } from '$lib/plugins/keys';
import type { PageServerLoad } from './$types';

// Plugin entries for each project's tab and Harbour cards.
export const load: PageServerLoad = async ({ url }) => {
	// A project tab used to open here (?project=<id>&tab=<plugin>/<contribution>); it has its own page now.
	const project = url.searchParams.get('project');
	const [pluginId, contributionId, ...rest] = (url.searchParams.get('tab') ?? '').split('/');
	if (project && pluginId && contributionId && !rest.length) {
		redirect(308, projectTabHref(project, { pluginId, contributionId }));
	}
	const fleet = await currentFleet();
	return {
		slots: await loadSlots(fleet.projects.map((p) => slotKey.project(p.id))),
		slotsAt: Date.now()
	};
};
