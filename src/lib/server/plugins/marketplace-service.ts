import { currentPlugins } from '../runtime';
import { defaultConfigDir } from './config';
import { Marketplace } from './marketplace';

let shared: Marketplace | null = null;

/** This Wheelhouse's marketplace: the captain's registries, and the plugins it already has. */
export function marketplaceService(): Marketplace {
	shared ??= new Marketplace({
		configDir: defaultConfigDir(process.env),
		known: async () =>
			(await currentPlugins()).plugins.map((p) => ({ id: p.id, repository: p.repository }))
	});
	return shared;
}
