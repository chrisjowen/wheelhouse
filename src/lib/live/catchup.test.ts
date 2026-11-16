import { describe, expect, it } from 'vitest';
import { groupCatchUp, type CatchUpItem } from './catchup';

const item = (kind: CatchUpItem['kind'], task: string, summary: string = kind): CatchUpItem => ({
	kind,
	task,
	title: task,
	project: 'p',
	summary,
	text: summary
});

describe('groupCatchUp', () => {
	it('gathers each task once, with decisions for the captain first', () => {
		const groups = groupCatchUp([
			item('moved', 'a'),
			item('moved', 'b'),
			item('decision', 'b', 'Merge it?'),
			item('cleared', 'a')
		]);
		expect(groups.map((g) => g.task)).toEqual(['b', 'a']);
		expect(groups[0].moved?.kind).toBe('moved');
		expect(groups[0].decisions.map((d) => d.summary)).toEqual(['Merge it?']);
		expect(groups[1].cleared).toHaveLength(1);
	});

	it('reads items written before they carried a summary', () => {
		const old = { kind: 'decision', task: 'a', title: 'a', text: 'Ship it?' } as CatchUpItem;
		expect(groupCatchUp([old])[0].decisions[0].summary).toBe('Ship it?');
	});

	it('says the question when the heading only repeats the task title', () => {
		const d = { ...item('decision', 'a'), title: 'Upload sheet', summary: 'lumen: Upload sheet' };
		d.text = 'Hold or ship?';
		expect(groupCatchUp([d])[0].decisions[0].summary).toBe('Hold or ship?');
	});
});
