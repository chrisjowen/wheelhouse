import { describe, expect, it } from 'vitest';
import {
	agentLine,
	consoleInImage,
	meaningfulConsoleLine,
	nowLine,
	shortTitle,
	STALE_STATUS_MS
} from './card';
import type { Activity, TaskStatus, TaskSummary } from './types';

function task(status: TaskStatus, o: Partial<TaskSummary> = {}): TaskSummary {
	return {
		id: 't',
		title: 't',
		shortTitle: 't',
		projectId: 'p',
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
		passage: { track: 'ship', steps: [], current: 0, basis: '' },
		attention: null,
		current: null,
		pr: null,
		since: null,
		completedOn: null,
		mergedAt: null,
		preview: null,
		blockedBy: [],
		hasReport: false,
		outputAvailable: true,
		outputNote: null,
		thumb: { kind: 'none' },
		screenshots: 0,
		...o
	};
}

describe('shortTitle', () => {
	it('drops a leading "<project>:" prefix and capitalises what is left', () => {
		expect(
			shortTitle(
				'wheelhouse: task-focused Bridge - one thread at a time, decisions shown as the question',
				'wheelhouse'
			)
		).toBe('Task-focused Bridge - one thread at a time, decisions shown as the question');
		expect(shortTitle('Wheelhouse: plugin slots', 'wheelhouse')).toBe('Plugin slots');
	});

	it('keeps titles whose prefix is not the project', () => {
		expect(shortTitle('docket: graph --json', 'wheelhouse')).toBe('docket: graph --json');
		expect(shortTitle('Fix: the thing', 'wheelhouse')).toBe('Fix: the thing');
		expect(shortTitle('plain title', 'wheelhouse')).toBe('plain title');
		expect(shortTitle('wheelhouse: x', null)).toBe('wheelhouse: x');
	});
});

describe('agentLine', () => {
	const w = (o: Partial<NonNullable<TaskSummary['worker']>>): TaskSummary['worker'] => ({
		harness: 'claude',
		name: 'fm-wh-plugins',
		model: null,
		modelKnown: true,
		mode: 'no-mistakes',
		yolo: 'off',
		...o
	});

	it('names the harness, the model (or the default) and the worker', () => {
		expect(agentLine(w({}))).toBe('Claude · default model · fm-wh-plugins');
		expect(agentLine(w({ model: 'opus-5', harness: 'codex' }))).toBe(
			'Codex · opus-5 · fm-wh-plugins'
		);
	});

	it('leaves out a model the ledger does not know, rather than calling it the default', () => {
		expect(agentLine(w({ modelKnown: false }))).toBe('Claude · fm-wh-plugins');
	});

	it('leaves out an unknown worker name, and says nothing without a harness', () => {
		expect(agentLine(w({ name: null }))).toBe('Claude · default model');
		expect(agentLine(w({ harness: null }))).toBeNull();
		expect(agentLine(null)).toBeNull();
	});
});

describe('consoleInImage', () => {
	it('shows the live console for work that is not completed', () => {
		for (const s of [
			'working',
			'waiting',
			'with-firstmate',
			'blocked',
			'needs-decision'
		] as const) {
			expect(consoleInImage(task(s))).toBe(true);
		}
	});

	it('keeps screenshots or the diff for completed work, and needs a terminal', () => {
		for (const s of ['landed', 'done', 'needs-review', 'queued', 'lost'] as const) {
			expect(consoleInImage(task(s))).toBe(false);
		}
		expect(consoleInImage(task('working', { outputAvailable: false }))).toBe(false);
	});
});

describe('meaningfulConsoleLine', () => {
	// A real Claude Code pane tail, as fm-peek.sh prints it.
	const pane = [
		'      57 +- Sessions run on Wheelhouse’s own tmux server',
		'',
		'⏺ Type-check and lint pass; running the full unit + smoke test suites now.',
		'',
		'⏺ Running full test suite, confirming default tmux socket untouched · 29s',
		'  ⎿  $ ls -la /private/tmp/tmux-501/; npm test 2>&1 | tail -25',
		'     (ctrl+b ctrl+b (twice) to run in background)',
		'',
		'✢ Schlepping… (3m 13s · ↓ 14.9k tokens)',
		'  ⎿  Tip: Use /btw to ask a quick side question without interrupting Claude’s',
		'                               Update available! Run: brew upgrade claude-code',
		'────────────────────────────────────────',
		'❯ ',
		'────────────────────────────────────────',
		'  ⏵⏵ bypass permissions on (shift+tab to cycle) · esc to interrupt'
	];

	it('takes the newest narration or tool bullet, without its timer', () => {
		expect(meaningfulConsoleLine(pane)).toBe(
			'Running full test suite, confirming default tmux socket untouched'
		);
	});

	it('falls back to the newest unindented plain line, cleaned of paths', () => {
		expect(meaningfulConsoleLine(['building /Users/me/x/app', '  output detail', '$ ', ''])).toBe(
			'building'
		);
		expect(meaningfulConsoleLine(['compiling the client bundle', '   indented output'])).toBe(
			'compiling the client bundle'
		);
	});

	it('says nothing for chrome-only or empty samples', () => {
		expect(meaningfulConsoleLine(pane.slice(8))).toBeNull();
		expect(meaningfulConsoleLine([])).toBeNull();
	});
});

describe('nowLine', () => {
	const now = Date.parse('2026-10-11T12:00:00Z');
	const at = (msAgo: number) => new Date(now - msAgo).toISOString();
	const activity = (source: Activity['source'], msAgo: number): Activity => ({
		text: `from ${source}`,
		at: at(msAgo),
		source
	});
	const sample = { line: 'Running the test suite', capturedAt: at(0) };

	it('uses the server activity when there is no console line', () => {
		const t = task('working', { busy: true, activity: activity('status', 60_000) });
		expect(nowLine(t, null, now)).toEqual({
			text: 'from status',
			at: at(60_000),
			source: 'status'
		});
		expect(nowLine(task('working'), null, now)).toBeNull();
	});

	it('prefers the console on a busy worker whose status line is old or missing', () => {
		const old = task('working', {
			busy: true,
			activity: activity('status', STALE_STATUS_MS + 1)
		});
		expect(nowLine(old, sample, now)).toEqual({
			text: 'Running the test suite',
			at: sample.capturedAt,
			source: 'console'
		});
		expect(nowLine(task('working', { busy: true }), sample, now)?.source).toBe('console');
		expect(
			nowLine(task('working', { busy: true, activity: activity('state', 0) }), sample, now)?.source
		).toBe('console');
	});

	it('keeps a fresh status line, a pipeline step, or an idle worker’s status', () => {
		const fresh = task('working', { busy: true, activity: activity('status', 30_000) });
		expect(nowLine(fresh, sample, now)?.source).toBe('status');
		const pipeline = task('working', {
			busy: true,
			activity: activity('pipeline', 10 * 60_000)
		});
		expect(nowLine(pipeline, sample, now)?.source).toBe('pipeline');
		const idle = task('waiting', { busy: false, activity: activity('status', 3_600_000) });
		expect(nowLine(idle, sample, now)?.source).toBe('status');
	});
});
