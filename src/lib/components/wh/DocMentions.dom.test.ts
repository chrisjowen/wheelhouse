import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it } from 'vitest';
import DocMentions from './DocMentions.svelte';

let app: ReturnType<typeof mount> | null = null;

afterEach(() => {
	if (app) unmount(app);
	app = null;
	document.body.innerHTML = '';
});

const links = (props: { text: string; shown?: string }) => {
	app = mount(DocMentions, { target: document.body, props });
	flushSync();
	return [...document.querySelectorAll('a[data-doc-link]')].map((a) => a.getAttribute('title'));
};

describe('DocMentions', () => {
	it('lists the Markdown files the raw line names', () => {
		expect(links({ text: 'done data/wh-1/report.md and data/wh-1/plan.md' })).toEqual([
			'data/wh-1/report.md',
			'data/wh-1/plan.md'
		]);
	});

	it('leaves out files the shown words already link', () => {
		expect(
			links({
				text: 'done data/wh-1/report.md and data/wh-1/plan.md',
				shown: 'Wrote data/wh-1/report.md'
			})
		).toEqual(['data/wh-1/plan.md']);
	});

	it('lists nothing when the shown words link every file', () => {
		expect(
			links({ text: 'Wrote data/wh-1/report.md', shown: 'Wrote data/wh-1/report.md' })
		).toEqual([]);
	});
});
