import { describe, expect, it } from 'vitest';
import { commandGroup } from './commands';

describe('commandGroup', () => {
	it('names each source, and each plugin by name', () => {
		const c = { name: 'x', description: '' };
		expect(commandGroup({ ...c, source: 'firstmate' })).toBe('Firstmate');
		expect(commandGroup({ ...c, source: 'personal' })).toBe('Personal');
		expect(commandGroup({ ...c, source: 'plugin', plugin: 'superpowers' })).toBe(
			'Plugin superpowers'
		);
		expect(commandGroup({ ...c, source: 'builtin' })).toBe('Built-in');
	});
});
