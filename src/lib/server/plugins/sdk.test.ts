import { describe, expect, it } from 'vitest';
import * as sdk from '../../../../packages/plugin-sdk/index.js';
import type * as Sdk from '../../../../packages/plugin-sdk/index.js';
import { normalizeBlocks } from '../../plugins/blocks';
import type { PluginHost } from '../../plugins/elements';
import { SLOTS, type Block, type Render, type ServiceView } from '../../plugins/types';
import { PLUGIN_API_VERSION, type ProviderContext, type WheelhousePlugin } from './types';

/**
 * The SDK (packages/plugin-sdk) restates the contract for plugin authors. The
 * assignments below fail `npm run check` when the two drift apart; the tests
 * check the values.
 */

// What a plugin built with the SDK exports fits what the registry runs…
export const fitsExport = (
	p: Sdk.WheelhousePlugin
): Omit<WheelhousePlugin, 'id' | 'name' | 'version' | 'apiVersion'> => ({
	...p,
	contributions: p.contributions
});
// …its blocks and renders are Wheelhouse's own…
export const fitsBlock = (b: Sdk.Block): Block => b;
export const fitsRender = (r: Sdk.Render): Render => r;
// …and the context Wheelhouse hands a provider is the one the SDK describes.
export const fitsContext = (c: ProviderContext): Sdk.ProviderContext => c;
// The host API an element gets, and the services it reads, are the ones the SDK describes.
export const fitsHost = (h: PluginHost): Sdk.PluginHost => h;
export const fitsService = (v: ServiceView): Sdk.ServiceView => v;

describe('the plugin SDK', () => {
	it('describes this contract version and its slots', () => {
		expect(sdk.PLUGIN_API_VERSION).toBe(PLUGIN_API_VERSION);
		expect([...sdk.SLOTS]).toEqual([...SLOTS]);
	});

	it('builds blocks Wheelhouse keeps as they are', () => {
		const blocks = [
			sdk.text('Plain'),
			sdk.text('Quiet', { muted: true }),
			sdk.kv([{ key: 'Clone', value: '/src/x' }]),
			sdk.table(['Task', 'PR'], [['Fix', { text: '#3', href: 'https://github.com/o/r/pull/3' }]]),
			sdk.links([{ label: 'Repository', href: 'https://github.com/o/r', note: 'main' }]),
			sdk.image('/shot.png', 'A screenshot'),
			sdk.status('ok', 'Deployed', 'at 10:00'),
			sdk.graph(
				[
					{ id: 'a', label: 'A' },
					{ id: 'b', label: 'B' }
				],
				[{ from: 'a', to: 'b' }]
			)
		];
		expect(normalizeBlocks(blocks)).toEqual({ ok: true, blocks });
	});

	it('builds provider results', () => {
		expect(sdk.available([1], 'a test', null)).toEqual({
			available: true,
			value: [1],
			source: 'a test',
			observedAt: null
		});
		expect(sdk.unavailable('No README.')).toEqual({ available: false, reason: 'No README.' });
		const p = { providers: [], contributions: [] };
		expect(sdk.definePlugin(p)).toBe(p);
	});
});
