import { describe, expect, it } from 'vitest';
import { checksView, docBullets, narration, parsePrTesting, parseTestOutput } from './checks';
import type { Pipeline } from '../../types';

const VITEST = `
 ✓ src/lib/a.test.ts (12 tests) 30ms
 ❯ src/lib/links.test.ts (3 tests | 2 failed) 12ms

⎯⎯⎯⎯⎯⎯⎯ Failed Tests 2 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  src/lib/links.test.ts > share links > expires after its days
AssertionError: expected false to be true // Object.is equality
 ❯ src/lib/links.test.ts:8:61

⎯⎯⎯⎯⎯⎯⎯[1/2]⎯

 FAIL  src/lib/links.test.ts > share links > token is 12 bytes
AssertionError: expected 12 to be 16
⎯⎯⎯⎯⎯⎯⎯[2/2]⎯

 Test Files  1 failed | 1 passed (2)
      Tests  2 failed | 13 passed | 1 skipped (16)
   Duration  1.2s
`;

describe('test runner output', () => {
	it('reads vitest counts and failed test names with their output', () => {
		const r = parseTestOutput(VITEST)!;
		expect(r).toMatchObject({ passed: 13, failed: 2, skipped: 1 });
		expect(r.failures.map((f) => f.name)).toEqual([
			'src/lib/links.test.ts › share links › expires after its days',
			'src/lib/links.test.ts › share links › token is 12 bytes'
		]);
		expect(r.failures[0].output).toContain('expected false to be true');
		expect(r.failures[0].output).not.toContain('token is 12 bytes');
	});

	it('reads jest, pytest, mocha and go summaries', () => {
		expect(
			parseTestOutput(
				'  ● retry › POST is retried only when idempotent\n\n    expect(received).toBe(expected)\n\nTests:       1 failed, 5 passed, 6 total\n'
			)
		).toMatchObject({
			passed: 5,
			failed: 1,
			failures: [{ name: 'retry › POST is retried only when idempotent' }]
		});
		expect(
			parseTestOutput(
				'FAILED tests/test_exif.py::test_heic_orientation - AssertionError: rotated\n==== 1 failed, 10 passed, 2 skipped in 0.52s ====\n'
			)
		).toMatchObject({
			passed: 10,
			failed: 1,
			skipped: 2,
			failures: [{ name: 'test_heic_orientation', output: 'AssertionError: rotated' }]
		});
		expect(parseTestOutput('\n  12 passing (30ms)\n  2 failing\n')).toMatchObject({
			passed: 12,
			failed: 2
		});
		expect(
			parseTestOutput(
				'--- PASS: TestA (0.00s)\n--- FAIL: TestB (0.01s)\n    b_test.go:9: want 2\nFAIL\nFAIL\tpkg/x\t0.02s\n'
			)
		).toMatchObject({ passed: 1, failed: 1, failures: [{ name: 'TestB' }] });
	});

	it('keeps the latest summary when a log holds several rounds', () => {
		const r = parseTestOutput(`${VITEST}\n      Tests  16 passed (16)\n`)!;
		expect(r).toMatchObject({ passed: 16, failed: 0 });
	});

	it('says nothing for narration without a runner summary', () => {
		expect(
			parseTestOutput('no test command configured, asking agent to run tests...\n')
		).toBeNull();
	});
});

const AGENT_LOG = `no test command configured, asking agent to run tests...

claude started pid=1

First try.
claude exited pid=1 status=success

no test command configured, asking agent to run tests...

claude started pid=58224

Built the workspace packages and started a disposable Postgres on port 5617; now seeding and launching the web app.Guided start passes (blocked on empty name, lands on first task).Running bin/fm-peek.sh to check.All tests pass. Tearing down the server and temp files.
claude exited pid=58224 status=success
`;

describe('narration', () => {
	it('splits the latest round into sentences and drops internals', () => {
		expect(narration(AGENT_LOG)).toEqual([
			'Built the workspace packages and started a disposable Postgres on port 5617; now seeding and launching the web app.',
			'Guided start passes (blocked on empty name, lands on first task).',
			'All tests pass.',
			'Tearing down the server and temp files.'
		]);
	});
});

const PR_BODY = `## What Changed

- **README and docs:** the README is now a short product page; technical detail moved to \`docs/guide.md\`.
- **Passage page:** the footer links to the new guide.

## Testing

I ran the CI install step by hand. Everything passed.

- Live validation: ✅ go - 2 of 3 scenarios driven live

| Scenario | Result | Live | Evidence |
| --- | --- | --- | --- |
| A user installs the tarball and runs \`wheelhouse --help\` | ✅ pass | live | pack-install-run.txt |
| Adversarial: a release whose tag doesn&#39;t match is refused | ❌ fail | live | the tag check let v9 through |
| Pushing a tag publishes to npm | ⏸️ untested | no | Needs GitHub Actions with OIDC. |

<details>
<summary>Evidence</summary>

\`\`\`text
lots of output
\`\`\`
</details>
`;

describe('pull request testing notes', () => {
	it('reads the summary and scenario table', () => {
		const t = parsePrTesting(PR_BODY)!;
		expect(t.note).toBe('I ran the CI install step by hand. Everything passed.');
		expect(t.scenarios.map((s) => s.result)).toEqual(['pass', 'fail', 'untested']);
		expect(t.scenarios[0].name).toBe('A user installs the tarball and runs wheelhouse --help');
		expect(t.scenarios[1]).toMatchObject({
			name: 'Adversarial: a release whose tag doesn’t match is refused',
			detail: 'the tag check let v9 through'
		});
	});

	it('picks the documentation bullets of What Changed', () => {
		expect(docBullets(PR_BODY)).toEqual([
			'README and docs: the README is now a short product page; technical detail moved to docs/guide.md.'
		]);
	});
});

describe('checks view', () => {
	const pipeline = (over: Partial<Pipeline> = {}): Pipeline => ({
		step: 'ci',
		label: 'CI',
		startedAt: null,
		round: null,
		steps: [
			{ key: 'intent', label: 'Intent', state: 'done', findings: 0, fixes: null, durationMs: 20 },
			{ key: 'rebase', label: 'Rebase', state: 'done', findings: 0, fixes: null, durationMs: 9000 },
			{ key: 'review', label: 'Review', state: 'done', findings: 3, fixes: 1, durationMs: 60000 },
			{ key: 'test', label: 'Tests', state: 'done', findings: 0, fixes: null, durationMs: 90000 },
			{ key: 'document', label: 'Docs', state: 'done', findings: 0, fixes: 1, durationMs: 30000 },
			{ key: 'lint', label: 'Lint', state: 'done', findings: 0, fixes: null, durationMs: 800 },
			{ key: 'push', label: 'Push', state: 'done', findings: 0, fixes: null, durationMs: 4000 },
			{
				key: 'pr',
				label: 'Pull request',
				state: 'done',
				findings: 0,
				fixes: null,
				durationMs: 9000
			},
			{ key: 'ci', label: 'CI', state: 'running', findings: 0, fixes: null, durationMs: 60000 }
		],
		outcome: 'running',
		gate: null,
		answered: false,
		roundStartedAt: null,
		ci: 'green',
		observedAt: null,
		...over
	});
	const logs = new Map([
		['rebase', 'rebasing branch fm/x onto origin/main\nup to date\n'],
		[
			'review',
			'reviewing changes\nfound 3 findings\nfix round starting after round 1\ncommitted agent fixes\nreviewing changes\nno findings\n'
		],
		['test', VITEST],
		[
			'document',
			'housekeeping: updating documentation and linting in one pass...\n\nclaude started pid=3\n\nUpdated the ADR.\nclaude exited pid=3 status=success\n\ncommitted agent fixes: no-mistakes(document): Document that approvals have no Ask for information\n\ndocument findings: 0 unresolved items\n'
		],
		['lint', 'lint assessed in the combined document+lint housekeeping pass: 0 unresolved items\n'],
		['ci', 'watching CI for branch fm/x\nCI checks passed\n']
	]);

	it('puts every step in plain words', () => {
		const v = checksView({
			pipeline: pipeline(),
			logs,
			startedAt: null,
			runs: 2,
			prBody: PR_BODY,
			docs: [{ title: 'Approvals', path: 'docs/adr/0003-approvals.md' }],
			decided: []
		});
		const by = Object.fromEntries(v.steps.map((s) => [s.key, s]));
		expect(by.rebase.summary).toBe('Already up to date with the main branch');
		expect(by.review.summary).toBe('Found 3 things to look at over 2 rounds; made 1 fix');
		expect(by.test.summary).toBe(
			'2 of 15 tests failed, 1 skipped; 1 of 3 scenarios passed when tried live'
		);
		expect(by.test.tests?.scenarios).toHaveLength(3);
		expect(by.document.summary).toBe('Updated the docs: 1 document changed in all');
		expect(by.document.docs?.summary[0]).toBe(
			'Document that approvals have no Ask for information'
		);
		expect(by.lint.summary).toBe('No lint problems');
		expect(by.ci.summary).toBe('CI checks passed');
		expect(v.testingNote).toBe('I ran the CI install step by hand. Everything passed.');
	});

	it('works from the step logs alone, the newest one under way', () => {
		const v = checksView({
			pipeline: null,
			logs: new Map([
				['intent', 'intent step\n'],
				['rebase', 'up to date\n'],
				['review', 'reviewing changes\n']
			]),
			startedAt: null,
			runs: 1,
			prBody: null,
			docs: [],
			decided: []
		});
		expect(v.steps.map((s) => [s.key, s.state])).toEqual([
			['intent', 'done'],
			['rebase', 'done'],
			['review', 'running']
		]);
		expect(v.steps[2].summary).toBe('Reading the change');
	});
});
