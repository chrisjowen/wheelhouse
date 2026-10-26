import type { FleetView, TaskStatus, TaskSummary } from '../../src/lib/types';

/** A synthetic TaskSummary, as the collector derives one, with whatever the test overrides. */
export function taskSummary(
	id: string,
	status: TaskStatus,
	o: Partial<TaskSummary> = {}
): TaskSummary {
	return {
		id,
		title: `lumen: ${id}`,
		shortTitle: id,
		projectId: 'lumen',
		kind: 'ship',
		track: 'ship',
		status,
		statusLabel: status,
		summary: null,
		summaryIsHistory: false,
		summaryRaw: null,
		activity: null,
		busy: false,
		pipeline: null,
		filesChanged: null,
		worker: null,
		branch: null,
		passage: {
			track: 'ship',
			steps: [],
			current: 0,
			basis: '',
			custom: false,
			live: null,
			link: null,
			checks: []
		},
		attention: null,
		current: null,
		pr: null,
		since: null,
		completedOn: null,
		mergedAt: null,
		preview: null,
		blockedBy: [],
		hasReport: false,
		outputAvailable: false,
		outputNote: null,
		thumb: { kind: 'none' },
		screenshots: 0,
		shots: [],
		...o
	};
}

/** A fleet view of these tasks, read just now. */
export function fleetOf(tasks: TaskSummary[], collectedAt = '2026-10-27T10:00:00Z'): FleetView {
	return {
		schema: 'wheelhouse-fleet.v1',
		generatedAt: collectedAt,
		collectedAt,
		stale: false,
		staleReason: null,
		projects: [],
		tasks
	};
}

const PR = 'https://github.com/example/lumen/pull/42';

/** A task whose green PR waits on the captain's merge. */
export const prGreen = (id: string, url = PR) =>
	taskSummary(id, 'needs-review', {
		pr: { url, number: Number(url.split('/').pop()) },
		attention: {
			kind: 'review',
			owner: 'captain',
			text: 'Pull request is ready for your review.',
			url
		}
	});

/** A task with a question waiting on the captain. */
export const question = (
	id: string,
	text = 'Ship the share links behind a flag, or to everyone?'
) =>
	taskSummary(id, 'needs-decision', {
		attention: { kind: 'decision', owner: 'captain', text, url: null }
	});
