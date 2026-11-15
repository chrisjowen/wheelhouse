import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import { live } from '$lib/client/live.svelte';
import { deriveTasks, type ReviewSignals } from '$lib/server/firstmate/model';
import { parseFleetSnapshot } from '$lib/server/firstmate/contracts';
import { snapshotFixture, taskRow } from '../../../../tests/helpers/fake-firstmate';
import type { ConsoleSample } from '$lib/card';

vi.mock('$app/state', () => ({ page: { data: {} } }));
const { default: TaskOverview } = await import('./TaskOverview.svelte');
const NOW = Date.parse('2026-11-15T12:00:00Z');
let app: ReturnType<typeof mount> | null = null;
afterEach(() => {
	if (app) unmount(app);
	app = null;
	document.body.innerHTML = '';
});

function draw(age: number, sample: ConsoleSample | null = null, lost = false) {
	live.now = NOW;
	const pr = 'https://github.com/o/r/pull/214';
	const row = taskRow({
		id: 'a',
		state: lost ? 'unknown' : 'working',
		endpointExists: !lost,
		pr: lost ? pr : undefined,
		lastEvent: { state: 'working', note: 'running the old tests', age_seconds: age }
	});
	row.current_state = {
		...(row.current_state as object),
		observed_at: new Date(NOW).toISOString()
	};
	const task = deriveTasks(parseFleetSnapshot(JSON.stringify(snapshotFixture({ tasks: [row] }))), {
		registry: [],
		thumbs: new Map(),
		ledger: new Map(),
		nowSeconds: NOW / 1000,
		review: new Map([
			['a', { ciChecks: 'green', prDraft: false, prState: 'OPEN' } as ReviewSignals]
		])
	}).tasks[0];
	app = mount(TaskOverview, {
		target: document.body,
		props: { task, detail: null, consoleSample: sample }
	});
	flushSync();
	return document.body.textContent?.replace(/\s+/g, ' ') ?? '';
}

describe('task overview current activity', () => {
	it('labels an older session report as history with its age and explains the relaunch', () => {
		const text = draw(86400);
		expect(document.querySelector('[data-now]')?.textContent).toContain(
			'Last report from the previous session:'
		);
		expect(text).toContain('yesterday');
		expect(text).toContain('The worker was relaunched and has not reported since.');
		expect(document.querySelector('[data-now]')?.textContent).not.toContain('Now:');
	});

	it('lets a console sample lead while retaining the previous session report', () => {
		const text = draw(86400, {
			line: 'Running the new tests',
			capturedAt: new Date(NOW).toISOString()
		});
		expect(document.querySelector('[data-now="console"]')?.textContent).toContain(
			'Now:Running the new tests'
		);
		expect(text).toContain('Last report from the previous session:');
		expect(text).toContain('Running the old tests');
	});

	it('calls a fresh status Now again', () => {
		draw(30, { line: 'A console line', capturedAt: new Date(NOW).toISOString() });
		expect(document.querySelector('[data-now="status"]')?.textContent).toContain('Now:');
		expect(document.body.textContent).not.toContain('previous session');
	});

	it('keeps lost contact, history, forge-ready review and the recovery sentence together', () => {
		const text = draw(86400, null, true);
		expect(text).toContain('Lost contact');
		expect(text).toContain('Needs your review:');
		expect(text).toContain('Last report: Running the old tests (24 h ago)');
		expect(text).toContain('task’s copy');
		expect(text).toContain('Firstmate’s relaunch');
		expect(document.querySelector('[data-now]')).toBeNull();
	});
});
