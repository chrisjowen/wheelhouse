import { describe, expect, it } from 'vitest';
import { median, readReport, reportPrompt, type ReportContext } from './report';
import { sample, vitals } from './testing';

const NOW = Date.parse('2026-11-17T12:00:00.000Z');

function context(over: Partial<ReportContext> = {}): ReportContext {
	return {
		now: NOW,
		machine: sample({
			processes: [
				{
					pid: 412,
					ppid: 1,
					cpuSeconds: 1000,
					pcpu: 98,
					rssBytes: 512 * 1024 ** 2,
					ageSeconds: 3600,
					name: 'claw-agent',
					command: '/opt/example/bin/claw-agent --config ~/.claw/config.json --token=•••'
				}
			],
			services: [
				{
					label: 'com.example.claw',
					runs: 123821,
					lastExit: 78,
					pid: null,
					state: 'spawn scheduled',
					periodic: false,
					program: '/opt/example/bin/claw-agent'
				},
				{
					label: 'com.example.quiet',
					runs: 3,
					lastExit: 0,
					pid: 10,
					state: 'running',
					periodic: false,
					program: null
				}
			]
		}),
		cpu: new Map([[412, 112]]),
		restarts: new Map([['com.example.claw', 512]]),
		vitals: vitals(),
		findings: [
			{
				id: 'crash-loop:com.example.claw',
				rule: 'crash-loop',
				severity: 'serious',
				subject: 'com.example.claw',
				title: 'com.example.claw keeps crashing and restarting',
				detail: 'It restarted 512 times in the last 60 minutes.',
				firstSeen: '2026-11-17T11:55:00.000Z',
				lastSeen: '2026-11-17T12:00:00.000Z',
				closedAt: null,
				proposal: null
			}
		],
		signals: [],
		normal: { scans: 12, load: 1.2, availablePercent: 55 },
		previous: null,
		...over
	};
}

describe('the report’s summary', () => {
	it('says what is busy, what restarts, what is normal and what the rules found', () => {
		const text = reportPrompt(context());
		expect(text).toContain('claw-agent pid 412: 112% CPU');
		expect(text).toContain(
			'com.example.claw: 512 restarts in the last hour, 123821 runs since login, last exit 78'
		);
		expect(text).not.toContain('com.example.quiet');
		expect(text).toContain('Normal for this computer (median of 12 scans');
		expect(text).toContain('[serious] com.example.claw keeps crashing and restarting');
		expect(text).toContain('Event loop p99 25 ms');
	});

	it('masks any secret that slipped through, as a last pass', () => {
		const leaky = context();
		leaky.machine!.processes[0].command =
			'tool --password=hunter2 ghp_0123456789abcdefghijABCDEFGHIJ';
		const text = reportPrompt(leaky);
		expect(text).not.toContain('hunter2');
		expect(text).not.toContain('ghp_0123');
	});

	it('copes with no scan yet, and stays short', () => {
		expect(reportPrompt(context({ machine: null, findings: [] }))).toContain(
			'No scan of the computer yet.'
		);
		const many = context();
		many.findings = Array.from({ length: 400 }, (_, i) => ({
			...many.findings[0],
			id: `x${i}`,
			detail: 'x'.repeat(100)
		}));
		expect(reportPrompt(many).length).toBeLessThan(12_100);
	});
});

describe('reading the report', () => {
	const envelope = (out: unknown) => JSON.stringify({ type: 'result', structured_output: out });

	it('reads the structured answer, cutting long fields', () => {
		const r = readReport(
			envelope({
				status: 'attention',
				headline: 'A background service is crash-looping.',
				summary: 'com.example.claw restarts every few seconds.',
				items: [
					{ title: 'Crash loop', cause: 'A bad config key.', fix: 'Fix the key, then restart it.' },
					{ title: '', cause: 'x', fix: 'y' },
					{ title: 'Long', cause: 'c'.repeat(600), fix: 'f' }
				]
			})
		);
		expect(r?.status).toBe('attention');
		expect(r?.items.map((i) => i.title)).toEqual(['Crash loop', 'Long']);
		expect(r?.items[1].cause.length).toBe(400);
	});

	it('calls a report with items one that wants a look, whatever it says', () => {
		expect(
			readReport(
				envelope({
					status: 'ok',
					headline: 'h',
					summary: '',
					items: [{ title: 't', cause: '', fix: '' }]
				})
			)?.status
		).toBe('attention');
		expect(
			readReport(envelope({ status: 'ok', headline: 'All quiet.', summary: '', items: [] }))?.status
		).toBe('ok');
	});

	it('refuses what it cannot read', () => {
		expect(readReport('not json')).toBeNull();
		expect(readReport(JSON.stringify({ is_error: true, result: 'x' }))).toBeNull();
		expect(readReport(envelope({ status: 'ok', headline: '', items: [] }))).toBeNull();
	});
});

it('takes a median', () => {
	expect(median([])).toBeNull();
	expect(median([3, 1, 2])).toBe(2);
	expect(median([4, 1, 2, 3])).toBe(2.5);
});
