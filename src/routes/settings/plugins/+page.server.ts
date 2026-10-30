import { currentPluginPage, currentPlugins } from '$lib/server/runtime';
import type { PluginPageView } from '$lib/plugins/types';
import type { PageServerLoad } from './$types';

/** Every plugin, and for each one Wheelhouse can configure, where it is on. */
export const load: PageServerLoad = async () => {
	const view = await currentPlugins();
	const ids = [...new Set(view.plugins.map((p) => p.id))];
	const pages: Record<string, PluginPageView> = {};
	for (const v of await Promise.all(ids.map((id) => currentPluginPage(id)))) {
		if (v) pages[v.plugin.id] = v;
	}
	return { view, pages };
};
