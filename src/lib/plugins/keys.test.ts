import { describe, expect, it } from 'vitest';
import { parseSlotKey, projectTabHref, slotKey } from './keys';

describe('slot keys', () => {
	it('round-trip a project and a task', () => {
		expect(parseSlotKey(slotKey.project('a b'))).toEqual({ scope: 'project', projectId: 'a b' });
		expect(parseSlotKey(slotKey.task('t/1'))).toEqual({ scope: 'task', taskId: 't/1' });
		expect(parseSlotKey(slotKey.fleet)).toEqual({ scope: 'fleet' });
	});

	it('give each project tab its own page', () => {
		expect(projectTabHref('acme', { pluginId: 'docket', contributionId: 'chart' })).toBe(
			'/projects/acme/docket/chart'
		);
		expect(projectTabHref('a/b', { pluginId: 'p', contributionId: 'c d' })).toBe(
			'/projects/a%2Fb/p/c%20d'
		);
	});
});
