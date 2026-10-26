import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PluginRegistry } from '../../server/plugins/registry';
import type { PluginConfig } from '../../server/plugins/config';
import type { Project, TaskSummary } from '../../types';
import type { SlotEntry } from '../types';
import {
	adapterCandidates,
	adapterEnabled,
	dueIsReadOnly,
	improve,
	startCommand
} from './plugin.server';
import type { HarnessView, ProposalSection } from './types';

/**
 * The Improve plugin through the registry, against a fake improve checkout:
 * its adapter CLI prints canned output for each command and logs how it was
 * called, so the tests can check that Wheelhouse only reads.
 */

let dir: string;
let home: string;
let improveDir: string;
let log: string;
let ui: Server;
let uiUrl: string;

const OUT = {
	detect: {
		detected: true,
		enabled: true,
		via: 'AGENTS.md',
		home: '',
		code_root: '',
		route_reviews: true,
		periodic_review: { enabled: true, every_tasks: 20, every_days: 7 }
	},
	import: {
		imported_at: '2026-10-26T10:00:00.000Z',
		counts: {
			tasks: 42,
			ask_user_findings: 12,
			decisions: 30,
			blockers: 2,
			open: 1,
			captain_preferences: 9,
			learnings: 14
		},
		repeated: {
			ask_user_findings: [
				{
					kind: 'repeated-ask-user',
					count: 3,
					tasks: ['a', 'b', 'c'],
					example: 'Should a missing config file be an error or use defaults?',
					decided_answers: ['use defaults']
				}
			],
			decisions: [
				{
					kind: 'repeated-decision',
					count: 2,
					tasks: ['a', 'd'],
					example: 'Keep the legacy endpoint for one release?',
					answers: ['keep it']
				}
			]
		}
	},
	inventory: {
		contract: {
			file: 'AGENTS.md',
			estimated_tokens: 5200,
			startup_memory_budget_tokens: 7500,
			share_of_budget: 0.69
		},
		skills: { count: 11, largest: [{ skill: 'firstmate-review' }] }
	},
	route: [
		{
			file: 'IMP-1.yaml',
			action: 'skip',
			why: 'already filed as improve-imp-1',
			delivery: 'local-apply'
		},
		{
			file: 'IMP-2.yaml',
			action: 'hold',
			delivery: 'upstream-pr',
			visibility: 'shared-tracked',
			surfaces: ['contract'],
			outcome: 'dry-run'
		},
		{ file: 'IMP-3.yaml', action: 'skip', why: 'status is draft, not proposed' }
	],
	decisions: [
		{
			file: 'IMP-1.yaml',
			proposal: 'IMP-1',
			task_id: 'improve-imp-1',
			delivery: 'local-apply',
			routed_at: '2026-10-25T09:00:00.000Z',
			outcome: 'dry-run'
		}
	],
	due: { due: true, reasons: ['21 Firstmate tasks dispatched since the last harness review'] }
};

const PROPOSALS: Record<string, string> = {
	'IMP-1.yaml': `id: IMP-1
title: Tell workers a missing config file falls back to defaults
layer: instructions
status: proposed
created_at: 2026-10-24T09:00:00Z
hypothesis: Workers stop asking the same question.
evidence:
  - source: firstmate import
    observation: The same review question came up in 3 tasks.
scope:
  files: [data/captain.md]
intervention:
  summary: >
    Workers ask each time.
    Add one line to captain.md.
`,
	'IMP-2.yaml': `id: IMP-2
title: Shorten the always-loaded contract
status: proposed
created_at: 2026-10-25T09:00:00Z
scope:
  files: [AGENTS.md]
intervention:
  summary: Move the review rules into a skill.
`,
	'IMP-3.yaml': `id: IMP-3
title: A draft
status: draft
scope:
  files: [bin/fm-brief.sh]
`
};

const CHECKS: Record<string, unknown> = {
	'IMP-1.yaml': {
		visibility: 'captain-private',
		surfaces: ['captain-preferences'],
		delivery: 'local-apply',
		findings: []
	},
	'IMP-2.yaml': {
		visibility: 'shared-tracked',
		surfaces: ['contract'],
		delivery: 'upstream-pr',
		findings: []
	},
	'IMP-3.yaml': {
		visibility: 'shared-tracked',
		surfaces: ['brief-scaffold'],
		delivery: 'upstream-pr',
		findings: []
	}
};

function write(file: string, text: string) {
	mkdirSync(path.dirname(file), { recursive: true });
	writeFileSync(file, text);
}

beforeAll(async () => {
	dir = mkdtempSync(path.join(tmpdir(), 'wh-improve-'));
	home = path.join(dir, 'home');
	improveDir = path.join(dir, 'improve');
	log = path.join(dir, 'calls.log');
	OUT.detect.home = home;
	write(path.join(dir, 'out.json'), JSON.stringify(OUT));
	write(path.join(dir, 'checks.json'), JSON.stringify(CHECKS));
	write(
		path.join(improveDir, 'adapters', 'firstmate', 'cli.mjs'),
		`import fs from 'node:fs';
const args = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify({ cwd: process.cwd(), args }) + '\\n');
const out = JSON.parse(fs.readFileSync(${JSON.stringify(path.join(dir, 'out.json'))}, 'utf8'))[args[0]];
process.stdout.write(JSON.stringify(out, null, 2) + '\\n');
`
	);
	write(
		path.join(improveDir, 'scripts', 'proposal-check-cli.mjs'),
		`import fs from 'node:fs';
const checks = JSON.parse(fs.readFileSync(${JSON.stringify(path.join(dir, 'checks.json'))}, 'utf8'));
fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify({ cwd: process.cwd(), args: ['check', ...process.argv.slice(2)] }) + '\\n');
for (const f of process.argv.slice(2)) {
  process.stdout.write(JSON.stringify({ file: f, scope: 'harness', firstmate: checks[f.split('/').pop()] }, null, 2) + '\\n');
}
`
	);
	ui = createServer((req, res) => {
		res.statusCode = req.url === '/api/health' ? 200 : 404;
		res.end('{}');
	});
	await new Promise<void>((r) => ui.listen(0, '127.0.0.1', r));
	uiUrl = `http://127.0.0.1:${(ui.address() as AddressInfo).port}`;
});
afterAll(() => {
	ui.close();
	rmSync(dir, { recursive: true, force: true });
});

function setHome(o: { config?: unknown; reviewState?: unknown } = {}) {
	rmSync(home, { recursive: true, force: true });
	write(
		path.join(home, '.harness', 'improve.json'),
		JSON.stringify(o.config ?? { adapters: { firstmate: { enabled: true } } })
	);
	for (const [f, text] of Object.entries(PROPOSALS))
		write(path.join(home, '.harness', 'proposals', f), text);
	write(
		path.join(home, '.harness', 'firstmate', 'routed.json'),
		JSON.stringify({
			schema_version: 1,
			proposals: {
				'IMP-1.yaml': {
					proposal: 'IMP-1',
					task_id: 'improve-imp-1',
					delivery: 'local-apply',
					routed_at: '2026-10-25T09:00:00.000Z'
				}
			}
		})
	);
	if (o.reviewState !== null)
		write(
			path.join(home, '.harness', 'firstmate', 'review-state.json'),
			JSON.stringify(o.reviewState ?? { last_reviewed_at: '2026-10-20T09:00:00.000Z' })
		);
	write(log, '');
}

const projects: Project[] = [
	{ id: 'lumen', name: 'Lumen', description: null, path: null, passage: null }
];
const tasks = [
	{
		id: 'improve-imp-1',
		projectId: 'unassigned',
		title: 'Improve: Tell workers…',
		status: 'needs-decision',
		statusLabel: 'Needs your call',
		attention: { kind: 'decision', owner: 'captain', text: 'Approve, reject, or defer', url: null },
		pr: null
	},
	{ id: 'lumen-1', projectId: 'lumen', title: 'Lumen', status: 'working', pr: null }
] as unknown as TaskSummary[];

function registry(settings: Record<string, unknown> = {}) {
	const config: PluginConfig = {
		plugins: { improve: { settings: { adapter: improveDir, uiUrl, ...settings } } }
	};
	return new PluginRegistry([improve], {
		fleet: () => ({ projects, tasks }),
		worktree: () => null,
		home: () => home,
		config: async () => ({ config, error: null })
	});
}

const calls = () =>
	readFileSync(log, 'utf8')
		.split('\n')
		.filter(Boolean)
		.map((l) => JSON.parse(l) as { cwd: string; args: string[] });
const bySlot = (entries: SlotEntry[]) => Object.fromEntries(entries.map((e) => [e.slot, e]));

describe('Improve, through the registry', () => {
	beforeEach(() => setHome());

	it('fills the menu page, the rail card and the header indicator from one read', async () => {
		const s = bySlot((await registry().slots({ scope: 'fleet' })).entries);
		expect(Object.keys(s).sort()).toEqual(['header.indicator', 'home.card', 'nav.page']);
		expect(s['nav.page']).toMatchObject({
			title: 'Improvements',
			render: { component: 'improve/improvements' }
		});
		const v = (s['home.card'].content as { value: HarnessView }).value;
		expect(v.review).toMatchObject({
			due: true,
			headline:
				'A harness review is due: 21 Firstmate tasks dispatched since the last harness review.',
			lastReviewedAt: '2026-10-20T09:00:00.000Z'
		});
		expect(v.waiting).toBe(2);
		expect(v.evidence.summary).toBe(
			'improve has read 42 tasks with 12 review questions, 30 decisions and 2 blockers, and 9 preferences of yours and 14 learnings.'
		);
		expect(v.evidence.patterns.map((p) => p.sentence)).toEqual([
			'The automated review asked the same question in 3 tasks: “Should a missing config file be an error or use defaults?”',
			'Firstmate asked you the same thing in 2 tasks: “Keep the legacy endpoint for one release?”'
		]);
		expect(v.inventory).toEqual([
			'AGENTS.md is about 5,200 tokens, 69% of the startup budget.',
			'11 skills; the largest is firstmate-review.'
		]);
		expect(v.problems).toEqual([]);

		const [p2, p1, p3] = v.proposals;
		expect(p1).toMatchObject({
			file: 'IMP-1.yaml',
			title: 'Tell workers a missing config file falls back to defaults',
			statusLabel: 'Waiting for your call',
			changes: 'Workers ask each time. Add one line to captain.md.',
			visibility: 'captain-private',
			visibilityLabel: 'Private to you',
			surfaces: ['your preferences'],
			evidence: [
				{ source: 'firstmate import', observation: 'The same review question came up in 3 tasks.' }
			],
			decision: {
				taskId: 'improve-imp-1',
				href: '/tasks/improve-imp-1',
				state: 'Waiting for your call'
			},
			routing: null,
			openUrl: `${uiUrl}/proposals?p=IMP-1.yaml`
		});
		expect(p2).toMatchObject({
			file: 'IMP-2.yaml',
			visibilityLabel: 'Shared Firstmate code',
			decision: null,
			routing: 'Not filed yet: the next /improve review files it as a decision for you.'
		});
		expect(p3).toMatchObject({
			file: 'IMP-3.yaml',
			waiting: false,
			statusLabel: 'Being drafted',
			routing: null
		});
		expect(v.ui).toMatchObject({ running: true, deepLinks: true, start: null });
	});

	it('only reads: no --apply or --save, every command in the home', async () => {
		await registry().slots({ scope: 'fleet' });
		const c = calls();
		expect(c.map((x) => x.args[0]).sort()).toEqual(
			['check', 'decisions', 'detect', 'due', 'import', 'inventory', 'route'].sort()
		);
		for (const x of c) {
			expect(x.args).not.toContain('--apply');
			expect(x.args).not.toContain('--save');
			expect(realpathSync(x.cwd)).toBe(realpathSync(home));
		}
		expect(c.find((x) => x.args[0] === 'check')!.args.slice(1)).toEqual(
			Object.keys(PROPOSALS).map((f) => `.harness/proposals/${f}`)
		);
	});

	it('does not run due while it could still write the start of the count', async () => {
		setHome({ reviewState: null });
		const s = bySlot((await registry().slots({ scope: 'fleet' })).entries);
		expect(calls().map((x) => x.args[0])).not.toContain('due');
		expect((s['home.card'].content as { value: HarnessView }).value.review).toMatchObject({
			due: null,
			headline: 'Periodic review is on; improve starts counting at its next Claude Code session.',
			lastReviewedAt: null
		});
	});

	it('is silent when the adapter is off, and when the home has no improve.json', async () => {
		setHome({ config: { adapters: { firstmate: { enabled: false } } } });
		expect((await registry().slots({ scope: 'fleet' })).entries).toEqual([]);
		expect(calls()).toEqual([]);
		rmSync(path.join(home, '.harness', 'improve.json'));
		expect((await registry().slots({ scope: 'fleet' })).entries).toEqual([]);
	});

	it('says plainly when the adapter cannot be found, and how to start the UI when it is down', async () => {
		const v = (
			bySlot(
				(
					await registry({ adapter: path.join(dir, 'nowhere'), uiUrl: 'http://127.0.0.1:1' }).slots(
						{ scope: 'fleet' }
					)
				).entries
			)['nav.page'].content as { value: HarnessView }
		).value;
		expect(v.problems[0]).toContain('could not find improve’s Firstmate adapter');
		expect(v.proposals.map((p) => p.title)).toContain('Shorten the always-loaded contract');
		expect(v.proposals.every((p) => p.openUrl === null)).toBe(true);
		expect(v.ui).toMatchObject({ running: false, start: null });

		const down = (
			bySlot((await registry({ uiUrl: 'http://127.0.0.1:1' }).slots({ scope: 'fleet' })).entries)[
				'nav.page'
			].content as { value: HarnessView }
		).value.ui;
		expect(down.start).toBe(startCommand(improveDir, home, 'http://127.0.0.1:1'));
		expect(down.start).toContain('--host 127.0.0.1 --port 1');
	});

	it('shows the proposal on its Firstmate task, linking back to Improvements', async () => {
		const entries = (await registry().slots({ scope: 'task', taskId: 'improve-imp-1' })).entries;
		expect(entries).toHaveLength(1);
		const v = (entries[0].content as { value: ProposalSection }).value;
		expect(entries[0]).toMatchObject({ slot: 'task.section', title: 'Improvement' });
		expect(v.improvementsHref).toBe('/plugins/improve/improvements#IMP-1.yaml');
		expect(v.proposal).toMatchObject({
			id: 'IMP-1',
			visibility: 'captain-private',
			decision: { state: 'Waiting for your call' }
		});
		// Any other task gets nothing.
		expect((await registry().slots({ scope: 'task', taskId: 'lumen-1' })).entries).toEqual([]);
	});
});

describe('Improve helpers', () => {
	it('reads the adapter switch strictly', () => {
		expect(adapterEnabled('{"adapters":{"firstmate":{"enabled":true}}}')).toBe(true);
		expect(adapterEnabled('{"adapters":{"firstmate":{"enabled":"yes"}}}')).toBe(false);
		expect(adapterEnabled('not json')).toBe(false);
		expect(adapterEnabled(null)).toBe(false);
	});

	it('runs due only when it cannot write', () => {
		const d = { detected: true, enabled: true, periodic_review: { enabled: true } };
		expect(dueIsReadOnly(d, { enabled_at: 'x' })).toBe(true);
		expect(dueIsReadOnly(d, { last_reviewed_at: 'x' })).toBe(true);
		expect(dueIsReadOnly(d, {})).toBe(false);
		expect(dueIsReadOnly({ ...d, periodic_review: { enabled: false } }, { enabled_at: 'x' })).toBe(
			false
		);
		expect(dueIsReadOnly(null, { enabled_at: 'x' })).toBe(false);
	});

	it('looks for the adapter in the setting, the installed copy, then the home’s clone', () => {
		const installed = JSON.stringify({
			plugins: {
				'improve@improve-marketplace': [{ installPath: '/plugins/improve/0.1.0' }],
				'other@x': [{ installPath: '/plugins/other' }]
			}
		});
		const read = (f: string) => (f === '/cfg/plugins/installed_plugins.json' ? installed : null);
		expect(
			adapterCandidates({ adapter: '/src/improve' }, { CLAUDE_CONFIG_DIR: '/cfg' }, read)
		).toEqual([
			'/src/improve/adapters/firstmate/cli.mjs',
			'/plugins/improve/0.1.0/adapters/firstmate/cli.mjs',
			'projects/improve/adapters/firstmate/cli.mjs'
		]);
		expect(adapterCandidates({}, { HOME: '/h' }, () => null)).toEqual([
			'projects/improve/adapters/firstmate/cli.mjs'
		]);
	});
});
