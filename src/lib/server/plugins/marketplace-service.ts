import path from 'node:path';
import { currentPlugins } from '../runtime';
import { defaultStateDir } from '../store/store';
import { defaultConfigDir } from './config';
import { Marketplace } from './marketplace';

let shared: Marketplace | null = null;

/**
 * This Wheelhouse's marketplace: the captain's registries, cloned under the
 * state directory, and the plugins it already has.
 */
export function marketplaceService(): Marketplace {
	shared ??= new Marketplace({
		configDir: defaultConfigDir(process.env),
		cacheDir: path.join(defaultStateDir(process.env), 'plugin-registries'),
		known: async () =>
			(await currentPlugins()).plugins.map((p) => ({ id: p.id, repository: p.repository }))
	});
	return shared;
}
