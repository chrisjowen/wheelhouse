import { describe, expect, it } from 'vitest';
import { PANELS } from '../../plugins/panels';
import { BUILTIN_PLUGINS } from './builtin';
import { EMPTY_CONFIG } from './config';
import { PluginRegistry } from './registry';

describe('compiled-in plugins', () => {
	it('all load against this contract', () => {
		const reg = new PluginRegistry(BUILTIN_PLUGINS, {
			fleet: () => ({ projects: [], tasks: [] }),
			worktree: () => null,
			config: async () => ({ config: EMPTY_CONFIG, error: null })
		});
		expect(reg.status().filter((s) => s.state !== 'loaded')).toEqual([]);
	});

	it('ship every panel their contributions name', () => {
		for (const p of BUILTIN_PLUGINS) {
			for (const c of p.contributions) {
				if ('component' in c.render)
					expect(PANELS[c.render.component], c.render.component).toBeDefined();
			}
		}
	});
});
