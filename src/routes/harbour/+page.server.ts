import { redirect } from '@sveltejs/kit';
import { currentFleet } from '$lib/server/runtime';
import { commitDays } from '$lib/server/activity';
import type { PageServerLoad } from './$types';

// The Harbour is every project at a glance; one project's work lives on its own page,
// so an address scoped to a project (outside the Passage and Radar views) goes there.
// The Projects view reads each clone's recent commits for its card's activity bars.
export const load: PageServerLoad = async ({ url }) => {
	const view = url.searchParams.get('view');
	const chart = view === 'passage' || view === 'radar';
	const project = url.searchParams.get('project');
	if (project && !chart)
		redirect(
			307,
			`/projects/${encodeURIComponent(project)}${view === 'completed' ? '?view=completed' : ''}`
		);
	if (chart) return { commits: {} as Record<string, number[] | null> };
	const fleet = await currentFleet();
	const commits = await Promise.all(
		fleet.projects.map(async (p) => [p.id, await commitDays(p.path).catch(() => null)] as const)
	);
	return { commits: Object.fromEntries(commits) as Record<string, number[] | null> };
};
