import { describe, expect, it } from 'vitest';
import { clean, fallbackFor, plainStatus } from './plain';

/** Real lines from a Firstmate home's state/*.status files and fleet ledger, verbatim. */
const LINES: [state: string, note: string, plain: string][] = [
	[
		'needs-decision',
		'[key=nm-01M4NJ6EHNE0QZP9W6AWCZE7ET-review]: ask-user findings=task-section-pin-after-step,example-plugin-enabled-by-default file=/Users/chrisowen/Dev/spikes /firstmate/data/wh-plugins/nm-01M4NJ6EHNE0QZP9W6AWCZE7ET-findings.txt',
		'Review raised 2 questions; Firstmate is deciding'
	],
	[
		'needs-decision',
		'ask-user findings=review-1 file=/Users/chrisowen/Dev/spikes /firstmate/data/docket-graph-json/nm-01M4NH9P5C0GT1MRFYR1S17V3K-findings.txt',
		'Review raised 1 question; Firstmate is deciding'
	],
	[
		'paused',
		'no-mistakes run for fm/wh-plugins in progress (backgrounded drive call); resumes at its next gate or outcome',
		'Running automated review and tests'
	],
	[
		'paused',
		'no-mistakes run started for fm/docket-graph-json; waiting on backgrounded drive call for next gate/outcome',
		'Running automated review and tests'
	],
	[
		'paused',
		'no-mistakes review fix round 2 (4 auto-fix findings) for run 01M4NJ6EHNE0QZP9W6AWCZE7ET in progress (backgrounded respond); resumes at its next gate or outcome',
		'Fixing review findings (round 2)'
	],
	[
		'paused',
		'no-mistakes review fix round for run 01M4NJ6EHNE0QZP9W6AWCZE7ET in progress (backgrounded respond); resumes at its next gate or outcome',
		'Fixing review findings'
	],
	[
		'paused',
		'review gate answered (deployed-step-omitted kept as decided; 5 auto-fix findings sent for a pipeline fix round); waiting on the next gate or outcome',
		'Fixing review findings'
	],
	[
		'paused',
		'no-mistakes re-validation running for 50e3e7d; waiting on backgrounded drive call for next gate or outcome',
		'Running automated review and tests'
	],
	[
		'done',
		'PR https://github.com/chrisjowen/wheelhouse/pull/3 checks green',
		'Pull request #3 ready for your review'
	],
	[
		'paused',
		"waiting for the captain's merge of PR https://github.com/chrisjowen/wheelhouse/pull/2; live preview of PR head 3056612 running at http://127.0.0.1:4311/ (pid 66432)",
		'Waiting for your merge of pull request #2'
	],
	[
		'done',
		'plugin slots committed on fm/wh-plugins (9100494): registry with contract-version refusal, timeouts and error isolation',
		'Committed: plugin slots'
	],
	[
		'done',
		'review-evidence fix committed on fm/wh-review-3 (e2b562e): green PR awaiting merge -> Needs your review',
		'Committed: review-evidence fix'
	],
	[
		'resolved',
		"answered: Decisions on the review step's ask-user findings: - task-section-pin-after-step: FIX. The approved design pins docket's 'Waters t [truncated]",
		'Firstmate answered; work continues'
	],
	['note', 'preview http://127.0.0.1:4311/', 'Shared a live preview'],
	[
		'working',
		'setup done on fm/wh-passages; reading design report and codebase',
		'Reading design report and codebase'
	],
	[
		'working',
		'setup done on fm/wh-sessions; implementing sessions feature',
		'Implementing sessions feature'
	],
	[
		'working',
		"setup done on fm/wh-review-3; root cause found (no_ci ci-log marker keeps run 'ci running'); implementing",
		'Root cause found; implementing'
	],
	[
		'working',
		'Enter-to-send composer change committed (50e3e7d) on top of the pipeline fix; re-validating with no-mistakes',
		'Running automated review and tests'
	],
	[
		'working',
		'round 2 visual redesign per captain feedback',
		'Round 2 visual redesign per captain feedback'
	],
	[
		'needs-decision',
		'prototype live at http://127.0.0.1:4310/; awaiting captain feedback',
		'Prototype live; awaiting captain feedback'
	],
	[
		'done',
		'report at data/wh-extend-s2/report.md - YAML passages (checks + stage rules, default-branch only, lab-validated)',
		'Report ready'
	]
];

/** Crew-state details as fm-crew-state.sh prints them. */
const DETAILS: [state: string, detail: string, plain: string][] = [
	['working', 'harness busy (claude-hook)', 'Working'],
	[
		'working',
		'validating (running) · run: 01M4NJ6EHNE0QZP9W6AWCZE7ET',
		'Running automated review and tests'
	],
	['working', 'validating (fixing) · run: 01M4NJ6EHNE0QZP9W6AWCZE7ET', 'Fixing review findings'],
	['working', 'ci running · run: 01M4NJ6EHNE0QZP9W6AWCZE7ET', 'Waiting for CI checks'],
	[
		'parked',
		'parked at review: 3 finding(s) · run: 01M4NJ6EHNE0QZP9W6AWCZE7ET',
		'Review found 3 issues; waiting on a decision'
	],
	[
		'done',
		'checks green: PR ready for review (still monitoring for merge/close): https://github.com/o/r/pull/9',
		'Pull request #9 ready for your review'
	],
	['failed', 'run failed · run: 01M4NJ6EHNE0QZP9W6AWCZE7ET', 'Automated review and tests failed'],
	['unknown', 'backend target gone: firstmate:fm-wh-x', 'Lost contact with the worker'],
	['unknown', 'harness state unavailable (stale)', 'Worker state unavailable']
];

describe('plainStatus', () => {
	it.each(LINES)('%s: %s', (state, note, plain) => {
		expect(plainStatus(state, note)).toBe(plain);
	});

	it.each(DETAILS)('crew state %s: %s', (state, detail, plain) => {
		expect(plainStatus(state, detail)).toBe(plain);
	});

	it('never leaves keys, paths, run ids, finding ids or script names', () => {
		for (const [state, note] of [...LINES, ...DETAILS]) {
			const out = plainStatus(state, note);
			expect(out).not.toMatch(/\[key=|\[at=|\/Users\/|[0-9A-Z]{26}|\bnm-|\.sh\b|findings=|file=/);
		}
	});

	it('falls back to a generic sentence per state when nothing readable is left', () => {
		expect(plainStatus('blocked', 'fm-guard.sh exit 2 file=/tmp/x')).toBe(
			'Blocked: needs Firstmate'
		);
		expect(plainStatus('paused', '')).toBe('Paused');
		expect(plainStatus('needs-decision', 'key=a,b')).toBe('Waiting on Firstmate');
		expect(plainStatus('working', null)).toBe('Working');
		expect(fallbackFor('something-new')).toBe('Working');
	});

	it('bounds long lines at a word', () => {
		const out = plainStatus('working', `implementing ${'many small things '.repeat(20)}`);
		expect(out.length).toBeLessThanOrEqual(140);
		expect(out.endsWith('…')).toBe(true);
	});
});

describe('clean', () => {
	it('keeps PR numbers and drops other links', () => {
		expect(clean('see PR https://github.com/o/r/pull/12 and the notes')).toBe(
			'see PR #12 and the notes'
		);
		expect(clean('prototype left running at http://127.0.0.1:4310/')).toBe('prototype');
	});
});
