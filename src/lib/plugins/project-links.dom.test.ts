import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { mountElement } from './elements';
import type { SlotEntry } from './types';

/** The bundled Project links plugin's Harbour card, its <project-links-summary> element. */

const BUNDLE = pathToFileURL(path.resolve('plugins/project-links/wheelhouse/ui/index.js')).href;

const entry: SlotEntry = {
	key: 'project-links/summary@docs',
	slot: 'harbour.card',
	pluginId: 'project-links',
	contributionId: 'summary',
	title: 'Project links',
	order: 500,
	step: null,
	projectId: 'docs',
	render: { element: 'project-links-summary' },
	ui: BUNDLE,
	badge: null,
	content: { available: true, value: null, source: 'a test', observedAt: null }
};

describe('the Project links Harbour card', () => {
	it('shows the repository, the README and the open pull requests, and redraws on new data', async () => {
		const host = document.createElement('div');
		const el = await mountElement(host, {
			tag: 'project-links-summary',
			ui: BUNDLE,
			data: {
				repoUrl: 'https://github.com/o/r',
				readme: { title: 'Harbour Docs', url: 'https://github.com/o/r/blob/HEAD/README.md' },
				pulls: [
					{ title: 'a', url: 'https://github.com/o/r/pull/1', number: 1, landed: false },
					{ title: 'b', url: 'https://github.com/o/r/pull/2', number: 2, landed: true }
				]
			},
			entry
		});
		const links = () =>
			[...el.shadowRoot!.querySelectorAll('a')].map((a) => [a.textContent, a.href]);
		expect(links()).toEqual([
			['github.com/o/r', 'https://github.com/o/r'],
			['Harbour Docs', 'https://github.com/o/r/blob/HEAD/README.md']
		]);
		expect(el.shadowRoot!.textContent).toContain('1 open pull request');

		el.data = { repoUrl: 'javascript:alert(1)', readme: null, pulls: [] };
		expect(links()).toEqual([]);
		expect(el.shadowRoot!.textContent).toContain('No repository link');
		expect(el.shadowRoot!.textContent).toContain('0 open pull requests');
	});
});
