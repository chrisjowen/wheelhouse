import type { RequestEvent } from '@sveltejs/kit';
import { describe, expect, it } from 'vitest';
import { oldTaskLink } from './oldlinks';

function event(path: string, init: { method?: string; accept?: string; data?: boolean } = {}) {
	const url = new URL(`http://127.0.0.1:4310${path}`);
	const headers = new Headers({ accept: init.accept ?? 'text/html,application/xhtml+xml' });
	return {
		request: new Request(url, { method: init.method ?? 'GET', headers }),
		url,
		isDataRequest: init.data ?? false
	} as unknown as RequestEvent;
}

describe('oldTaskLink', () => {
	it('sends a page opened with a task in its address to the task page', () => {
		expect(oldTaskLink(event('/harbour?task=search'))).toBe('/tasks/search');
		expect(oldTaskLink(event('/?task=a%2Fb'))).toBe('/tasks/a%2Fb');
	});

	it('leaves the API, plugins, the task page and other requests alone', () => {
		expect(oldTaskLink(event('/harbour'))).toBeNull();
		expect(oldTaskLink(event('/api/slots?task=wh-1'))).toBeNull();
		expect(oldTaskLink(event('/plugins/review/state?task=wh-1'))).toBeNull();
		expect(oldTaskLink(event('/tasks/wh-1?task=wh-2'))).toBeNull();
		expect(oldTaskLink(event('/harbour?task=a', { accept: 'application/json' }))).toBeNull();
		expect(oldTaskLink(event('/harbour?task=a', { data: true }))).toBeNull();
		expect(oldTaskLink(event('/harbour?task=a', { method: 'POST' }))).toBeNull();
	});
});
