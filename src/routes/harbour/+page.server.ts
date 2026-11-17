import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

// The Harbour is every project at a glance; one project's work lives on its own page,
// so an address scoped to a project (outside the Passage and Radar views) goes there.
export const load: PageServerLoad = async ({ url }) => {
	const view = url.searchParams.get('view');
	const chart = view === 'passage' || view === 'radar';
	const project = url.searchParams.get('project');
	if (project && !chart)
		redirect(
			307,
			`/projects/${encodeURIComponent(project)}${view === 'completed' ? '?view=completed' : ''}`
		);
	return {};
};
