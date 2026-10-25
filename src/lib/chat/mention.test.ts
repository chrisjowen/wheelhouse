import { describe, expect, it } from 'vitest';
import { chatMention } from './mention';

const fleet = (title = 'Show checks') => ({
	tasks: [{ id: 'wh-checks', shortTitle: title, projectId: 'wh' }],
	projects: [{ id: 'wh', name: 'wheelhouse' }]
});

describe('chatMention', () => {
	it('mentions the task named by ?chat= once', () => {
		const take = chatMention();
		expect(take(new URL('http://h/?chat=wh-checks'), fleet())).toEqual({
			kind: 'task',
			id: 'wh-checks',
			title: 'Show checks',
			project: 'wheelhouse',
			url: null
		});
	});

	it('does not mention it again as the fleet refreshes under the same URL', () => {
		// SvelteKit's replaceState leaves page.url as it was, so the home page
		// sees ?chat= on every live fleet update while the captain types.
		const take = chatMention();
		const url = new URL('http://h/?chat=wh-checks');
		expect(take(url, fleet())).not.toBeNull();
		for (let i = 0; i < 5; i++) expect(take(url, fleet(`Show checks ${i}`))).toBeNull();
	});

	it('waits for the fleet to list the task, then mentions it once', () => {
		const take = chatMention();
		const url = new URL('http://h/?chat=wh-checks');
		expect(take(url, null)).toBeNull();
		expect(take(url, { tasks: [], projects: [] })).toBeNull();
		expect(take(url, fleet())).not.toBeNull();
		expect(take(url, fleet())).toBeNull();
	});

	it('mentions again on a new arrival with ?chat=', () => {
		const take = chatMention();
		expect(take(new URL('http://h/?chat=wh-checks'), fleet())).not.toBeNull();
		expect(take(new URL('http://h/'), fleet())).toBeNull();
		expect(take(new URL('http://h/?chat=wh-checks'), fleet())).not.toBeNull();
	});

	it('ignores a URL without ?chat= or naming no listed task', () => {
		const take = chatMention();
		expect(take(new URL('http://h/'), fleet())).toBeNull();
		expect(take(new URL('http://h/?chat=nope'), fleet())).toBeNull();
	});
});
