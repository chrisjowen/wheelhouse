import { describe, expect, it } from 'vitest';
import { placeTaskSections } from './placement';
import type { Slot, SlotEntry } from './types';

const entry = (key: string, slot: Slot, step: string | null): SlotEntry => ({
	key,
	slot,
	pluginId: 'p',
	contributionId: key,
	title: key,
	order: 500,
	step,
	projectId: null,
	render: { blocks: true },
	content: { available: true, value: [], source: 's', observedAt: null }
});

describe('placeTaskSections', () => {
	it('pins sections after a step the passage has and falls back to order otherwise', () => {
		const r = placeTaskSections(
			[
				entry('pinned', 'task.section', 'pr'),
				entry('missing', 'task.section', 'deployed'),
				entry('loose', 'task.section', null),
				entry('evidence', 'step.evidence', 'pr')
			],
			['queue', 'pr', 'landed']
		);
		expect(
			Object.fromEntries(Object.entries(r.afterStep).map(([k, v]) => [k, v.map((e) => e.key)]))
		).toEqual({
			pr: ['pinned']
		});
		expect(r.byOrder.map((e) => e.key)).toEqual(['missing', 'loose']);
	});
});
