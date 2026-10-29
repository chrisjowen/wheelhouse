import { describe, expect, it } from 'vitest';
import { choicesIn, reportIn } from './options';
import type { InboxChoices } from '../../inbox';

/** The options of each call, as `label (detail)` with a * on the recommended one. */
const shape = (c: InboxChoices | null) =>
	c?.calls.map((call) => ({
		n: call.number,
		prompt: call.prompt,
		required: call.required,
		options: call.options.map(
			(o) => `${o.recommended ? '*' : ''}${o.label}${o.detail ? ` (${o.detail})` : ''}`
		)
	}));

// The hold texts Firstmate recorded for real captain calls (lettered, numbered with "or",
// numbered with "/"), plus the shapes around them.
const WATCHER =
	"Pick how Wheelhouse watches GitHub issues (report: data/wh-gh-watcher-design/report.md). A (recommended): bundled read-only plugin that polls gh issue list and shows new issues on the task board. B: core feature in Wheelhouse's server, with its own settings page. C: Firstmate-side watcher that files a backlog row per new issue. If A: should new issues also ring the bell?";
const GATEWAY =
	'Gateway design calls (report: data/wh-gateway-design/report.md). 1) Approach: A core gateway with outbound-only bot adapters (recommended) or C Claude Code channels only, no Wheelhouse work. 2) First channel: Discord (recommended) or Telegram. 3) WhatsApp: skip for now (recommended) or commit to the official Cloud API route with public webhook, dedicated number and templates.';
const AUDIT =
	"4 calls from the data audit (data/wh-data-audit/report.md): (1) turn on Firstmate's fleet activity ledger so landed tasks keep history - yes (rec) / no; (2) v1 scope - drop Deployed + 'N live' yes (rec) / placeholder, and Bridge report-ins plain text from Firstmate's dialog mirror with cards on URL match (rec) / inbox replies only; (3) needs-you as two buckets 'Needs you' + 'Waiting on Firstmate' (rec) / one bucket; (4) adopt UI-work brief conventions (screenshots dir, reported preview URL, options in decisions) now (rec) / also propose upstream";
const EXTEND =
	'7 calls from data/wh-extend-s2/report.md section 5 (recommended first): (1) passage file: YAML .wheelhouse.yaml on default branch + captain config (rec) / markdown frontmatter / config only; (2) command checks: captain config only (rec) / never / repo default branch; (3) plugins: panels+providers (rec) / iframes / Module Federation; (4) docket in Wheelhouse: read-only Chart + task waters + hazards (rec) / link out / plus Ask+Chat; (5) ontologies: project .docket + private instance (rec) / instance only / project only; (6) Firstmate use: intake practice + upstream brief line + impact script (rec) / wait for fm-ontology-c3 / none; (7) nautical: meaning in the Chart only (rec) / broader restyle. None gate v1.';
const TM_AUDIT =
	'Captain call on the tm-audit-a1 report at data/tm-audit-a1/report.md. Q1: ship the ready-to-ship fix batch (stop-hook cwd/off-by-one/no-session-persistence, SessionEnd flush, YAML 1.2 frontmatter parsing) - all, a subset, or not now. Q2: remote projection default scope (finding 2) - unique per checkout (orphans existing scopes), drift detection, or document only. Q3: background review cadence and cost (finding 4d) - trigger on SessionEnd or user turns with a cheap default model, or keep per-turn at 40 lines. Packaging items fold into tm-npm-publish-b2.';

describe('choicesIn', () => {
	it('reads lettered options, the recommended one and a trailing yes/no follow-up', () => {
		const c = choicesIn(WATCHER);
		expect(c?.intro).toBe('Pick how Wheelhouse watches GitHub issues');
		expect(shape(c)).toEqual([
			{
				n: null,
				prompt: null,
				required: true,
				options: [
					'*A (bundled read-only plugin that polls gh issue list and shows new issues on the task board)',
					"B (core feature in Wheelhouse's server, with its own settings page)",
					'C (Firstmate-side watcher that files a backlog row per new issue)'
				]
			},
			{
				n: null,
				prompt: 'If A: should new issues also ring the bell?',
				required: false,
				options: ['Yes', 'No']
			}
		]);
	});

	it('reads numbered calls, each with its own options, lettered or not', () => {
		const c = choicesIn(GATEWAY);
		expect(c?.intro).toBe('Gateway design calls');
		expect(shape(c)).toEqual([
			{
				n: 1,
				prompt: 'Approach',
				required: true,
				options: [
					'*A (core gateway with outbound-only bot adapters)',
					'C (Claude Code channels only, no Wheelhouse work)'
				]
			},
			{ n: 2, prompt: 'First channel', required: true, options: ['*Discord', 'Telegram'] },
			{
				n: 3,
				prompt: 'WhatsApp',
				required: true,
				options: [
					'*Skip for now',
					'Commit to the official Cloud API route with public webhook, dedicated number and templates'
				]
			}
		]);
	});

	it('reads (1) … / … calls, and leaves a call it cannot split cleanly to a written answer', () => {
		const c = choicesIn(AUDIT);
		expect(c?.intro).toBe('4 calls from the data audit');
		const calls = shape(c)!;
		expect(calls.map((x) => x.n)).toEqual([1, 2, 3, 4]);
		expect(calls[0]).toEqual({
			n: 1,
			prompt: "Turn on Firstmate's fleet activity ledger so landed tasks keep history",
			required: true,
			options: ['*Yes', 'No']
		});
		// Two recommendations in one call: two questions run together, so no options.
		expect(calls[1]).toMatchObject({ n: 2, options: [], required: false });
		expect(c!.calls[1].prompt).toMatch(/^V1 scope - drop Deployed/);
		expect(calls[2].options).toEqual([
			"*Needs-you as two buckets 'Needs you' + 'Waiting on Firstmate'",
			'One bucket'
		]);
		expect(calls[3].options).toEqual([
			'*Adopt UI-work brief conventions (screenshots dir, reported preview URL, options in decisions) now',
			'Also propose upstream'
		]);
	});

	it('reads seven calls, keeping the words after the last one as a note', () => {
		const c = choicesIn(EXTEND);
		const calls = shape(c)!;
		expect(calls).toHaveLength(7);
		expect(calls[0]).toEqual({
			n: 1,
			prompt: 'Passage file',
			required: true,
			options: [
				'*YAML .wheelhouse.yaml on default branch + captain config',
				'Markdown frontmatter',
				'Config only'
			]
		});
		expect(calls[2].options).toEqual(['*Panels+providers', 'Iframes', 'Module Federation']);
		expect(calls[6].options).toEqual(['*Meaning in the Chart only', 'Broader restyle']);
		expect(c?.after).toBe('None gate v1.');
	});

	it('reads Q1: … calls with comma lists, and preselects the first under "recommended first"', () => {
		const c = choicesIn(TM_AUDIT);
		expect(c?.intro).toBe('Captain call on the tm-audit-a1 report at data/tm-audit-a1/report.md');
		const calls = shape(c)!;
		expect(calls.map((x) => x.options)).toEqual([
			['All', 'A subset', 'Not now'],
			['Unique per checkout (orphans existing scopes)', 'Drift detection', 'Document only'],
			[
				'Trigger on SessionEnd or user turns with a cheap default model',
				'Keep per-turn at 40 lines'
			]
		]);
		expect(c!.calls[0].prompt).toMatch(/^Ship the ready-to-ship fix batch/);
		expect(c?.after).toBe('Packaging items fold into tm-npm-publish-b2.');
		const first = choicesIn(
			'Calls (recommended first): 1) Colour: navy / slate. 2) Font: serif / sans.'
		);
		expect(shape(first)!.map((x) => x.options)).toEqual([
			['*Navy', 'Slate'],
			['*Serif', 'Sans']
		]);
	});

	it('reads numbered questions asked as "this or that?"', () => {
		const c = choicesIn(
			'Open questions in data/casebook-runner-prototype/report.md. Main ones: (1) My work per instance only, or also an all-instances home? (2) recurring work in Ready or its own group? (3) who may start a case: any member, holders of a process role, or write access? (4) should pausing a task notify others?'
		);
		// A call that is only its options needs no heading; one with a topic keeps it.
		expect(shape(c)!.map((x) => [x.prompt, x.options])).toEqual([
			[null, ['My work per instance only', 'Also an all-instances home']],
			[null, ['Recurring work in Ready', 'Its own group']],
			['Who may start a case', ['Any member', 'Holders of a process role', 'Write access']],
			['Should pausing a task notify others?', ['Yes', 'No']]
		]);
	});

	it('finds no options in a plain hold, so the card keeps approve and skip', () => {
		for (const text of [
			'Choose the billing provider before work starts.',
			'Captain to choose how workers publish while the bot GitHub account is suspended',
			"Approve docket 0.5.0 on npm with 2FA: run 'npm stage approve 63dfe1fb' (or the Staged Packages tab on npmjs.com). Tell Firstmate when done.",
			'Pick navy or slate for the dark theme.',
			'Before the next npm release: publish contracts under a scope the captain owns, or bundle into the CLI',
			'A follow-up can fix the rest. Ship it as is?',
			'Step 1) is done.',
			''
		]) {
			expect(choicesIn(text), text).toBeNull();
		}
	});

	it('reads no options from prose that is neither lettered nor numbered, even with a recommendation', () => {
		expect(choicesIn('Theme for the board: navy (recommended) / slate / sand.')).toBeNull();
		expect(
			choicesIn(
				'Use Postgres (recommended) or SQLite for the store, and Redis or memcached for cache.'
			)
		).toBeNull();
	});

	it('reads A) and (B) style letters, and "Option C"', () => {
		expect(
			shape(choicesIn('Which store? A) SQLite (recommended). B) Postgres. C) flat files.'))![0]
				.options
		).toEqual(['*A (SQLite)', 'B (Postgres)', 'C (flat files)']);
		expect(shape(choicesIn('Pick one. Option A: keep it. Option B: drop it.'))![0].options).toEqual(
			['A (keep it)', 'B (drop it)']
		);
	});
});

describe('reportIn', () => {
	it('finds the report a hold names', () => {
		expect(reportIn(WATCHER)).toBe('data/wh-gh-watcher-design/report.md');
		expect(reportIn(AUDIT)).toBe('data/wh-data-audit/report.md');
		expect(reportIn('See /Users/me/fm/data/x-design/report.md for detail.')).toBe(
			'/Users/me/fm/data/x-design/report.md'
		);
		expect(reportIn('Choose the billing provider before work starts.')).toBeNull();
	});
});
