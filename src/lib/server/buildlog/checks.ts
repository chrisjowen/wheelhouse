import { clean } from '../../plain';
import { ciResultFromLog } from '../firstmate/evidence';
import { STEPS } from '../firstmate/nmstatus';
import { testLine, type CheckReport, type ChecksView, type TestResult } from '../../buildlog';
import type { CheckStepState, DecisionView, Pipeline } from '../../types';

/**
 * What each validation step found, in plain words, from the run's own step
 * logs (~/.no-mistakes/logs/<run>/<step>.log, tails only), the step states
 * no-mistakes reports for the run, and the pull request's Testing section
 * that no-mistakes writes. Pure, so it is unit-tested with real log shapes.
 */

// eslint-disable-next-line no-control-regex
const ANSI = /\u001b\[[0-9;?]*[A-Za-z]/g;
const MAX_OUTPUT_LINES = 12;
const MAX_OUTPUT_CHARS = 1200;
const MAX_FAILURES = 20;
const MAX_NOTES = 12;

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const num = (s: string | undefined) => (s === undefined ? null : Number(s));

function bound(lines: string[]): string {
	const kept = lines.slice(0, MAX_OUTPUT_LINES).join('\n').trimEnd();
	const cut = kept.length > MAX_OUTPUT_CHARS ? `${kept.slice(0, MAX_OUTPUT_CHARS - 1)}…` : kept;
	return lines.length > MAX_OUTPUT_LINES ? `${cut}\n…` : cut;
}

/** The lines after a failure heading, up to the next heading or a blank run, bounded. */
function outputAfter(lines: string[], i: number, stop: RegExp): string {
	const out: string[] = [];
	let blanks = 0;
	for (let j = i + 1; j < lines.length && out.length < MAX_OUTPUT_LINES + 1; j++) {
		const l = lines[j];
		if (stop.test(l)) break;
		if (!l.trim()) {
			if (++blanks > 1 && out.length) break;
			continue;
		}
		blanks = 0;
		out.push(l.replace(/^\s{0,6}/, ''));
	}
	return bound(out);
}

/**
 * Test counts and failures from a test runner's own output: vitest, jest,
 * pytest, go test, mocha, playwright and node's TAP reporter. The latest
 * summary in the text wins (a log holds every round). Null when the text has
 * no recognisable summary.
 */
export function parseTestOutput(raw: string): Omit<TestResult, 'scenarios' | 'basis'> | null {
	const text = raw.replace(ANSI, '').replace(/\r\n?/g, '\n');
	const lines = text.split('\n');
	let passed: number | null = null;
	let failed: number | null = null;
	let skipped: number | null = null;
	let at = -1;
	const take = (i: number, p: number | null, f: number | null, s: number | null) => {
		if (i < at) return;
		at = i;
		passed = p;
		failed = f;
		skipped = s;
	};
	lines.forEach((l, i) => {
		// vitest: "Tests  2 failed | 40 passed | 1 skipped (43)"
		let m = /^\s*Tests\s{2,}(.*\(\d+\))\s*$/.exec(l);
		if (m) {
			const part = (w: string) => num(new RegExp(`(\\d+) ${w}`).exec(m![1])?.[1]);
			take(i, part('passed') ?? 0, part('failed') ?? 0, part('skipped') ?? part('todo'));
			return;
		}
		// jest: "Tests:       1 failed, 5 passed, 6 total"
		m = /^\s*Tests:\s+(.*\d+ total)\s*$/.exec(l);
		if (m) {
			const part = (w: string) => num(new RegExp(`(\\d+) ${w}`).exec(m![1])?.[1]);
			take(i, part('passed') ?? 0, part('failed') ?? 0, part('skipped'));
			return;
		}
		// pytest: "==== 2 failed, 10 passed, 1 skipped in 0.52s ===="
		m = /^=+ (.*\b(?:passed|failed)\b.*) in [\d.]+s(?: \([^)]*\))? =+$/.exec(l);
		if (m) {
			const part = (w: string) => num(new RegExp(`(\\d+) ${w}`).exec(m![1])?.[1]);
			take(
				i,
				part('passed') ?? 0,
				(part('failed') ?? 0) + (part('errors?') ?? part('error') ?? 0),
				part('skipped')
			);
			return;
		}
		// mocha: "  12 passing (30ms)" then "  2 failing"; playwright: "  10 passed (5s)", "  2 failed"
		m = /^\s+(\d+) (passing|passed)\b(?: \([^)]*\))?\s*$/.exec(l);
		if (m) {
			const tail = lines.slice(i + 1, i + 4).join('\n');
			const f = /^\s+(\d+) (?:failing|failed)\b/m.exec(tail)?.[1];
			const s = /^\s+(\d+) (?:pending|skipped)\b/m.exec(tail)?.[1];
			take(i, Number(m[1]), f ? Number(f) : 0, s ? Number(s) : null);
			return;
		}
		m = /^\s+(\d+) (?:failing|failed)\s*$/.exec(l);
		if (m && i > at) {
			const before = lines.slice(Math.max(0, i - 3), i + 4).join('\n');
			const p = /^\s+(\d+) (?:passing|passed)\b/m.exec(before)?.[1];
			take(i, p ? Number(p) : null, Number(m[1]), null);
			return;
		}
		// node --test (TAP): "# pass 5" / "# fail 1"
		m = /^# fail (\d+)\s*$/.exec(l);
		if (m) {
			const p = lines
				.slice(Math.max(0, i - 4), i)
				.map((x) => /^# pass (\d+)/.exec(x)?.[1])
				.find(Boolean);
			const s = lines
				.slice(i, i + 4)
				.map((x) => /^# skipped (\d+)/.exec(x)?.[1])
				.find(Boolean);
			take(i, p ? Number(p) : null, Number(m[1]), s ? Number(s) : null);
		}
	});
	// go test: counts from "--- PASS" / "--- FAIL" lines when nothing else summarised.
	const goFail = lines.filter((l) => /^\s*--- FAIL: /.test(l)).length;
	const goPass = lines.filter((l) => /^\s*--- PASS: /.test(l)).length;
	if (at < 0 && (goFail || goPass || lines.some((l) => /^(ok|FAIL)\s+\S+\s/.test(l)))) {
		passed = goPass;
		failed = goFail;
		at = lines.length;
	}
	if (at < 0) return null;
	return { passed, failed, skipped, failures: failuresIn(lines) };
}

/** Failed tests by name, with the start of their output. */
function failuresIn(lines: string[]): { name: string; output: string }[] {
	const out: { name: string; output: string }[] = [];
	const seen = new Set<string>();
	const add = (name: string, output: string) => {
		const n = name.trim();
		if (!n || seen.has(n) || out.length >= MAX_FAILURES) return;
		seen.add(n);
		out.push({ name: n, output });
	};
	const HEADING =
		/^\s*(?:FAIL\s{1,2}\S.*>|●\s|FAILED\s|--- FAIL: |not ok \d+ - |\d+\) )|^⎯{3,}|^_{3,} .* _{3,}$/;
	lines.forEach((l, i) => {
		let m = /^\s*(?:×|✗|❯)?\s*FAIL\s{1,2}(\S.*? > .+?)(?:\s+\d+ms)?\s*$/.exec(l);
		if (m) return add(m[1].replace(/\s+>\s+/g, ' › '), outputAfter(lines, i, HEADING));
		m = /^\s*●\s+(.+›.+)$/.exec(l);
		if (m) return add(m[1], outputAfter(lines, i, HEADING));
		m = /^FAILED\s+(\S+)(?:\s+-\s+(.*))?$/.exec(l);
		if (m) return add(m[1].replace(/^.*::/, ''), (m[2] ?? '').trim());
		m = /^\s*--- FAIL: (\S+)/.exec(l);
		if (m) return add(m[1], outputAfter(lines, i, HEADING));
		m = /^not ok \d+ - (.+)$/.exec(l);
		if (m) return add(m[1], outputAfter(lines, i, /^(?:ok|not ok) \d+/));
		// mocha and playwright list failures as "  1) suite\n       name:" or "  1) [chromium] › a.spec.ts:3:1 › name ───"
		m = /^\s{2}\d+\) (.+?)(?:\s+─+)?\s*$/.exec(l);
		if (m && !/^\s{2}\d+ (?:passing|failing)/.test(l)) {
			let name = m[1];
			const next = lines[i + 1]?.trim();
			if (next && next.endsWith(':') && !/error/i.test(next))
				name = `${name} › ${next.slice(0, -1)}`;
			return add(
				name.replace(/\s+›\s+/g, ' › '),
				outputAfter(lines, i + (next?.endsWith(':') ? 1 : 0), /^\s{2}\d+\) /)
			);
		}
	});
	return out;
}

/**
 * The narration the test or docs agent wrote while it worked, as sentences:
 * no-mistakes logs them run together between "claude started" and "claude
 * exited", so they are split at sentence ends. Only the latest round.
 */
export function narration(log: string): string[] {
	const text = log.replace(ANSI, '').replace(/\r\n?/g, '\n');
	const starts = [...text.matchAll(/^(?:\S+ )?started pid=\d+\s*$/gm)];
	const last = starts.at(-1);
	if (!last || last.index === undefined) return [];
	const rest = text.slice(last.index + last[0].length);
	const end = /^(?:\S+ )?exited pid=\d+.*$/m.exec(rest);
	const body = (end ? rest.slice(0, end.index) : rest).trim();
	return body
		.split(/(?<=[.!?])\s*(?=[A-Z])|\n+/)
		.map((s) => clean(s.trim()))
		.filter((s) => s.length > 2)
		.slice(-MAX_NOTES);
}

/** How the latest agent turn in a step log ended: success, failure, or not yet. */
function agentExit(log: string): 'success' | 'failure' | null {
	const m = [...log.matchAll(/exited pid=\d+ status=(\w+)/g)].at(-1);
	return m ? (m[1] === 'success' ? 'success' : 'failure') : null;
}

/** The Testing section no-mistakes writes into a pull request body: its summary and scenario table. */
export function parsePrTesting(
	body: string
): { note: string | null; scenarios: TestResult['scenarios'] } | null {
	const text = body.replace(/\r\n?/g, '\n');
	const m = /^## Testing\s*\n([\s\S]*?)(?=^## |(?![\s\S]))/m.exec(text);
	if (!m) return null;
	const section = m[1].replace(/<details>[\s\S]*?<\/details>/g, '');
	const scenarios: TestResult['scenarios'] = [];
	const prose: string[] = [];
	let header: string[] | null = null;
	for (const line of section.split('\n')) {
		const l = line.trim();
		if (l.startsWith('|')) {
			const cells = l
				.replace(/^\||\|$/g, '')
				.split('|')
				.map((c) => c.trim());
			if (!header) {
				header = cells.map((c) => c.toLowerCase());
				continue;
			}
			if (cells.every((c) => /^:?-+:?$/.test(c))) continue;
			const col = (n: string) => cells[header!.indexOf(n)] ?? '';
			const result = col('result').toLowerCase();
			scenarios.push({
				name: unmark(col('scenario') || cells[0]),
				result: /fail|❌/.test(result)
					? 'fail'
					: /pass|✅/.test(result)
						? 'pass'
						: /untested|skip|⏸/.test(result)
							? 'untested'
							: 'other',
				detail: unmark(col('evidence') || col('reason') || '')
			});
		} else if (l && !l.startsWith('- Live validation')) {
			header = null;
			prose.push(l);
		}
	}
	const note = prose.length ? unmark(prose.join(' ')) : null;
	return note || scenarios.length ? { note, scenarios } : null;
}

/** Markdown emphasis, code and links as plain text. */
export function unmark(s: string): string {
	return s
		.replace(/&#39;/g, '’')
		.replace(/&quot;/g, '"')
		.replace(/&amp;/g, '&')
		.replace(/\*\*([^*]+)\*\*/g, '$1')
		.replace(/`([^`]+)`/g, '$1')
		.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
		.replace(/\s+/g, ' ')
		.trim();
}

/** The "What Changed" bullets of a pull request body that are about documentation. */
export function docBullets(body: string): string[] {
	const m = /^## What Changed\s*\n([\s\S]*?)(?=^## |(?![\s\S]))/m.exec(
		body.replace(/\r\n?/g, '\n')
	);
	if (!m) return [];
	return m[1]
		.split('\n')
		.filter((l) => /^\s*- /.test(l))
		.map((l) => unmark(l.replace(/^\s*- /, '')))
		.filter((l) => /\b(docs?|documentation|readme|adrs?|decision records?)\b/i.test(l))
		.slice(0, 6);
}

export interface ChecksInput {
	/** The run's steps as no-mistakes reported them (empty when only the logs could be read). */
	pipeline: Pipeline | null;
	/** Each step's log tail, by step key, for the steps that have one. */
	logs: Map<string, string>;
	/** When the run started. */
	startedAt: string | null;
	runs: number;
	/** The pull request's body, when it could be read. */
	prBody: string | null;
	/** The documentation the change touches. */
	docs: { title: string; path: string }[];
	/** Questions Firstmate answered for this task. */
	decided: DecisionView[];
}

/** Every step of the latest run, with what it came to. */
export function checksView(i: ChecksInput): ChecksView {
	const known = new Map((i.pipeline?.steps ?? []).map((s) => [s.key, s]));
	const testing = i.prBody ? parsePrTesting(i.prBody) : null;
	const lastLogged = Math.max(...STEPS.map(([k], n) => (i.logs.has(k) ? n : -1)));
	const ended = i.pipeline ? i.pipeline.outcome !== 'running' : false;
	const steps: CheckReport[] = [];
	STEPS.forEach(([key, label], n) => {
		const p = known.get(key);
		const log = i.logs.get(key) ?? null;
		if (!p && !log && !(i.pipeline?.steps.length && n > lastLogged)) return;
		const state: CheckStepState =
			p?.state ?? (log === null ? 'upcoming' : n < lastLogged || ended ? 'done' : 'running');
		steps.push(report(key, label, state, p?.findings ?? 0, p?.durationMs ?? null, log, i, testing));
	});
	return {
		startedAt: i.startedAt,
		outcome: i.pipeline?.outcome ?? null,
		runs: i.runs,
		steps,
		testingNote: testing?.note ?? null
	};
}

function report(
	key: string,
	label: string,
	state: CheckStepState,
	findings: number,
	durationMs: number | null,
	log: string | null,
	i: ChecksInput,
	testing: ReturnType<typeof parsePrTesting>
): CheckReport {
	const r: CheckReport = {
		key,
		label,
		state,
		summary: '',
		durationMs,
		notes: [],
		tests: null,
		docs: null
	};
	const text = log ?? '';
	const upcoming = state === 'upcoming';
	const skipped = state === 'skipped';
	const asked = i.decided.filter((d) => d.step === key);
	const askedLine = asked.length
		? `; Firstmate answered ${plural(
				asked.reduce((n, d) => n + d.calls.length, 0),
				'question'
			)}`
		: '';
	switch (key) {
		case 'intent':
			r.summary = upcoming ? 'Not started' : 'Read what the change is for';
			break;
		case 'rebase':
			r.summary = upcoming
				? 'Not started'
				: /conflict/i.test(text)
					? 'Ran into a conflict with the main branch'
					: /up to date|already/i.test(text)
						? 'Already up to date with the main branch'
						: state === 'done'
							? 'Brought up to date with the main branch'
							: 'Bringing the branch up to date';
			break;
		case 'review': {
			const rounds = (text.match(/^reviewing changes/gm) ?? []).length;
			const found = [...text.matchAll(/found (\d+) findings?/g)].map((m) => Number(m[1]));
			const fixes = (text.match(/^committed agent fixes/gm) ?? []).length;
			const total = found.reduce((a, b) => a + b, 0) || findings;
			if (upcoming) r.summary = 'Not started';
			else if (!total && state === 'done') r.summary = 'Found nothing to change';
			else if (!total) r.summary = 'Reading the change';
			else
				r.summary = `Found ${plural(total, 'thing')} to look at${rounds > 1 ? ` over ${rounds} rounds` : ''}${fixes ? `; made ${plural(fixes, 'fix', 'fixes')}` : ''}${askedLine}`;
			if (found.length > 1)
				r.notes = found.map(
					(n, k) => `Round ${k + 1}: ${n ? plural(n, 'finding') : 'nothing found'}`
				);
			break;
		}
		case 'test': {
			const parsed = parseTestOutput(text);
			const scenarios = testing?.scenarios ?? [];
			if (parsed || scenarios.length) {
				r.tests = {
					passed: parsed?.passed ?? null,
					failed: parsed?.failed ?? null,
					skipped: parsed?.skipped ?? null,
					failures: parsed?.failures ?? [],
					scenarios,
					basis: parsed
						? scenarios.length
							? 'the test run’s own summary and the pull request’s testing notes'
							: 'the test run’s own summary'
						: 'the pull request’s testing notes'
				};
			}
			r.notes = narration(text);
			const exit = agentExit(text);
			if (upcoming) r.summary = 'Not started';
			else if (skipped) r.summary = 'Skipped for this change';
			else if (r.tests) r.summary = testLine(r.tests);
			else if (
				/configured test command failed/.test(text) ||
				state === 'failed' ||
				exit === 'failure'
			)
				r.summary = 'Tests failed';
			else if (state === 'done')
				r.summary = findings ? `Tests raised ${plural(findings, 'problem')}` : 'Tests passed';
			else r.summary = 'Running the tests';
			if (r.summary === 'Tests passed' && findings)
				r.summary += `, with ${plural(findings, 'finding')}`;
			if (askedLine && r.summary) r.summary += askedLine;
			break;
		}
		case 'document': {
			const commits = [
				...text.matchAll(/^committed agent fixes: (?:no-mistakes\(document\): )?(.+)$/gm)
			].map((m) => m[1].trim());
			const bullets = i.prBody ? docBullets(i.prBody) : [];
			r.docs = { files: i.docs, summary: [...commits, ...bullets] };
			r.notes = narration(text);
			const left = Number(
				/document findings: (\d+) unresolved/.exec(
					[...text.matchAll(/document findings: \d+ unresolved/g)].at(-1)?.[0] ?? ''
				)?.[1] ?? 0
			);
			if (upcoming) r.summary = 'Not started';
			else if (skipped) r.summary = 'Skipped for this change';
			else if (commits.length)
				r.summary = `Updated the docs${i.docs.length ? `: ${plural(i.docs.length, 'document')} changed in all` : ''}`;
			else if (i.docs.length)
				r.summary = `${plural(i.docs.length, 'document')} changed; the docs step had nothing to add`;
			else if (/no agent changes to commit/.test(text) || state === 'done')
				r.summary = 'No documentation changes needed';
			else r.summary = 'Checking the docs match the change';
			if (left) r.summary += `; ${plural(left, 'item')} left open`;
			break;
		}
		case 'lint': {
			const m = [...text.matchAll(/(\d+) unresolved items?/g)].at(-1);
			r.summary = upcoming
				? 'Not started'
				: skipped
					? 'Skipped for this change'
					: m
						? Number(m[1])
							? `${plural(Number(m[1]), 'lint problem')} left`
							: 'No lint problems'
						: state === 'done'
							? 'No lint problems'
							: 'Checking style and lint';
			break;
		}
		case 'push':
			r.summary = upcoming
				? 'Not started'
				: state === 'done'
					? 'Pushed the branch'
					: 'Pushing the branch';
			break;
		case 'pr':
			r.summary = upcoming
				? 'Not started'
				: /updat/i.test(text)
					? 'Updated the pull request'
					: state === 'done'
						? 'Opened the pull request'
						: 'Opening the pull request';
			break;
		case 'ci': {
			const ci = log === null ? 'unknown' : ciResultFromLog(text);
			// Green CI is the step's result, though its monitor keeps watching until the merge.
			if (state === 'running' && ci === 'green') r.state = 'done';
			r.summary = upcoming
				? 'Not started'
				: /no_ci: true|declares no CI/.test(text)
					? 'This repository has no CI checks'
					: ci === 'green'
						? 'CI checks passed'
						: ci === 'red'
							? 'CI checks failed'
							: 'Waiting for CI checks';
			if (/CI repair/i.test(text)) r.notes = ['Pushed a repair for a failing CI check'];
			break;
		}
	}
	if (state === 'failed' && !/fail/i.test(r.summary))
		r.summary = `Failed: ${r.summary.charAt(0).toLowerCase()}${r.summary.slice(1)}`;
	if (state === 'waiting') r.summary += ' (stopped for a decision)';
	if (state === 'fixing') r.summary += '; fixing now';
	// A step not reached yet has nothing of its own to show.
	if (upcoming) {
		r.docs = null;
		r.notes = [];
	}
	return r;
}
