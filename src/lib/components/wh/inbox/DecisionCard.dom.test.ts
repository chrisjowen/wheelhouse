import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it } from 'vitest';
import { optionsFor, type InboxCard } from '$lib/inbox';
import DecisionCard from './DecisionCard.svelte';

const card = (o: Partial<InboxCard> = {}): InboxCard => ({
	id: 'demo-search:merge-pr',
	taskId: 'demo-search',
	taskTitle: 'Search',
	projectId: 'demo',
	kind: 'merge',
	key: 'merge-pr',
	question: 'Merge pull request #12? Its checks are green.',
	askedAt: null,
	owner: 'captain',
	evidence: {
		text: null,
		findings: [],
		file: null,
		pr: null,
		preview: null,
		checks: 'green',
		screenshots: []
	},
	options: optionsFor('merge'),
	recommendation: null,
	sent: null,
	...o
});

let app: ReturnType<typeof mount> | null = null;

afterEach(() => {
	if (app) unmount(app);
	app = null;
	document.body.innerHTML = '';
});

describe('DecisionCard', () => {
	it('shows a failed delivery as not sent, even while the answer error is showing', () => {
		const failed = card({
			sent: {
				choice: 'approve',
				note: null,
				at: '2026-10-27T10:00:00Z',
				delivery: 'failed',
				detail: 'note refused',
				requestId: 'r1'
			}
		});
		app = mount(DecisionCard, {
			target: document.body,
			props: {
				card: failed,
				error: 'Not delivered to Firstmate: note refused',
				now: Date.parse('2026-10-27T10:01:00Z'),
				onAnswer: () => {},
				onLater: () => {}
			}
		});
		flushSync();
		expect(document.body.textContent).not.toContain('Sent to Firstmate');
		expect(document.querySelector('[role="status"]')).toBeNull();
	});
});
