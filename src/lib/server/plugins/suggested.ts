import type { SuggestedPlugin } from '../../plugins/types';

/**
 * First-party plugins that live in repositories of their own, and the sign in
 * the Firstmate home that the captain uses one. While the home has the file
 * and no plugin by that id is known (installed, bundled or compiled in, in any
 * state), the Plugins page says how to install it.
 */
export interface KnownPlugin {
	id: string;
	name: string;
	repository: string;
	whenHomeFile: string;
	why: string;
}

export const KNOWN_PLUGINS: KnownPlugin[] = [
	{
		id: 'improve',
		name: 'Improve',
		repository: 'chrisjowen/improve',
		whenHomeFile: '.harness/improve.json',
		why: 'This Firstmate home uses improve (it has .harness/improve.json), but its Wheelhouse plugin is not installed, so there is no Improvements page.'
	}
];

export function suggestedPlugins(
	known: { id: string }[],
	homeHas: (rel: string) => boolean,
	list: KnownPlugin[] = KNOWN_PLUGINS
): SuggestedPlugin[] {
	const ids = new Set(known.map((p) => p.id));
	return list
		.filter((k) => !ids.has(k.id) && homeHas(k.whenHomeFile))
		.map((k) => ({
			id: k.id,
			name: k.name,
			repository: k.repository,
			reason: k.why,
			command: `wheelhouse plugin install ${k.repository}`
		}));
}
