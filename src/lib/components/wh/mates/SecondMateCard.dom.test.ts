import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MatePeek, SecondMate } from '$lib/types';
import SecondMateCard from './SecondMateCard.svelte';

const mate: SecondMate = {
	id: 'tokyo',
	where: 'remote',
	host: 'tokyo-box',
	home: '/home/fm/tokyo',
	stateLabel: 'Needs your decision',
	tone: 'captain',
	health: {
		online: 'unknown',
		text: 'Not refreshed: this is what it reported 12 min ago',
		reason: 'Firstmate’s last fleet read could not fetch its summary from tokyo-box in time.',
		observedAt: null,
		ageSeconds: 720,
		cached: true,
		host: { cpu: null, memory: null, disk: null },
		hostNote: 'Host CPU, memory and disk: not reported yet.'
	},
	projects: ['lumen'],
	inFlight: [
		{
			id: 'tk-1',
			title: 'Add the share API',
			projectId: 'lumen',
			status: 'working',
			statusLabel: 'Working',
			doing: 'Review running',
			since: null,
			completedOn: null,
			pr: null,
			report: null
		}
	],
	queued: [],
	landed: [],
	prs: [
		{
			taskId: 'tk-0',
			title: 'Old work',
			url: 'https://github.com/o/lumen/pull/7',
			number: 7,
			landed: true
		}
	],
	previews: [],
	previewNote: 'Previews: not carried yet.',
	decisions: 2,
	captainDecisions: 1,
	omitted: ['3 more queued'],
	lastReport: null,
	peek: { available: true, reason: null }
};

let app: ReturnType<typeof mount> | null = null;
afterEach(() => {
	if (app) unmount(app);
	app = null;
	document.body.innerHTML = '';
	vi.unstubAllGlobals();
});

describe('a second mate on the Second mates page', () => {
	it('shows its health, work and PRs, says what is not available, and peeks only when asked', async () => {
		const peek: MatePeek = {
			available: false,
			offline: true,
			reason: 'Offline: Firstmate could not reach tokyo-box.',
			lines: [],
			capturedAt: null,
			requested: 40
		};
		const fetch = vi.fn(async () => new Response(JSON.stringify(peek)));
		vi.stubGlobal('fetch', fetch);
		app = mount(SecondMateCard, { target: document.body, props: { mate, now: Date.now() } });
		flushSync();
		const text = document.body.textContent!;
		expect(text).toContain('Last report');
		expect(text).toContain('Not refreshed: this is what it reported 12 min ago');
		expect(text).toContain('Host CPU, memory and disk: not reported yet.');
		expect(text).toContain('Add the share API');
		expect(text).toContain('2 open questions, 1 waiting on you, in Decisions');
		expect(text).toContain('#7');
		expect(text).toContain('Previews not available.');
		expect(text).toContain('leaves out 3 more queued');
		expect(fetch).not.toHaveBeenCalled();

		const look = [...document.querySelectorAll('button')].find((b) =>
			b.textContent!.includes('Look at its terminal')
		)!;
		look.click();
		await vi.waitFor(() =>
			expect(document.body.textContent).toContain('could not reach tokyo-box.')
		);
		expect(fetch).toHaveBeenCalledWith('/api/second-mates/tokyo/peek?lines=40');
	});
});
