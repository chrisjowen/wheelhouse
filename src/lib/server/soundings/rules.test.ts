import { describe, expect, it } from 'vitest';
import { DEFAULT_SOUNDINGS_SETTINGS as S, type ServiceSample } from '../../soundings';
import { evaluate, scanPoint, type RuleInput, type ScanPoint } from './rules';
import { sample, vitals } from './testing';

const NOW = Date.parse('2026-11-17T12:00:00.000Z');
const MIN = 60_000;

function input(over: Partial<RuleInput> = {}): RuleInput {
	return {
		now: NOW,
		machine: sample(),
		history: [],
		vitals: vitals(),
		vitalsHistory: [],
		signals: [],
		...over
	};
}

const point = (minutesAgo: number, over: Partial<ScanPoint> = {}): ScanPoint => ({
	at: NOW - minutesAgo * MIN,
	runs: {},
	cpu: {},
	load: 1.5,
	availablePercent: 50,
	...over
});

const service = (over: Partial<ServiceSample>): ServiceSample => ({
	label: 'com.example.claw',
	runs: 0,
	lastExit: 0,
	pid: null,
	state: 'running',
	periodic: false,
	program: '/opt/example/bin/claw-agent',
	...over
});

const ids = (i: RuleInput, s = S) => evaluate(i, s).map((f) => f.id);

describe('rules', () => {
	it('finds nothing on a quiet computer', () => {
		expect(evaluate(input(), S)).toEqual([]);
	});

	describe('crash loop', () => {
		const looping = (runs: number, then: number, over: Partial<ServiceSample> = {}) =>
			input({
				machine: sample({ services: [service({ runs, lastExit: 78, ...over })] }),
				history: [point(60, { runs: { 'com.example.claw': then } }), point(5)]
			});

		it('flags a service restarting hundreds of times an hour, with a request to Firstmate', () => {
			const [f] = evaluate(looping(123821, 123321), S);
			expect(f).toMatchObject({
				id: 'crash-loop:com.example.claw',
				rule: 'crash-loop',
				severity: 'serious'
			});
			expect(f.detail).toContain('restarted 500 times in the last 60 minutes, about 500 an hour');
			expect(f.detail).toContain('exited with code 78');
			expect(f.proposal?.note).toContain('launchctl bootout gui/$(id -u)/com.example.claw');
			expect(f.proposal?.note).toContain('Do not delete anything');
		});

		it('leaves a service that restarts now and then', () => {
			expect(ids(looping(110, 100))).toEqual([]);
		});

		it('leaves a job on a timer that exits cleanly, but not one that keeps failing', () => {
			expect(ids(looping(1000, 100, { periodic: true, lastExit: 0 }))).toEqual([]);
			expect(ids(looping(1000, 100, { periodic: true }))).toEqual(['crash-loop:com.example.claw']);
		});

		it('needs an earlier scan, and ignores a count that went down (a new login)', () => {
			expect(
				ids(input({ machine: sample({ services: [service({ runs: 99999, lastExit: 1 })] }) }))
			).toEqual([]);
			expect(ids(looping(5, 9000))).toEqual([]);
		});

		it('uses systemctl to stop a Linux unit', () => {
			const i = looping(5000, 100);
			i.machine = { ...i.machine!, platform: 'linux' };
			expect(evaluate(i, S)[0].proposal?.note).toContain('systemctl --user stop com.example.claw');
		});
	});

	describe('CPU hog', () => {
		const busy = (cpuNow: number, cpuThen: number, minutesAgo = 10) =>
			input({
				machine: sample({
					processes: [
						{
							pid: 412,
							ppid: 1,
							cpuSeconds: cpuNow,
							pcpu: 99,
							rssBytes: 1e8,
							ageSeconds: 9000,
							name: 'claw-agent',
							command: 'claw-agent --run'
						}
					]
				}),
				history: [point(minutesAgo, { cpu: { '412:claw-agent': cpuThen } })]
			});

		it('flags a process above the share of a core all through the window', () => {
			const [f] = evaluate(busy(1000, 1000 - 600 * 1.2), S);
			expect(f).toMatchObject({ id: 'cpu-hog:claw-agent:412', severity: 'warning' });
			expect(f.detail).toContain('120% of a core');
		});

		it('calls one using more than twice the threshold serious', () => {
			expect(evaluate(busy(5000, 5000 - 600 * 2), S)[0].severity).toBe('serious');
		});

		it('leaves a busy moment, or a window that is too short', () => {
			expect(ids(busy(1000, 1000 - 600 * 0.3))).toEqual([]);
			expect(ids(busy(1000, 1000 - 300 * 1.5, 5))).toEqual([]);
		});
	});

	it('flags memory pressure, low disks, large logs and old dev servers', () => {
		const found = evaluate(
			input({
				machine: sample({
					memory: {
						totalBytes: 16 * 1024 ** 3,
						availableBytes: 0.5 * 1024 ** 3,
						pressure: 'critical',
						swapUsedBytes: 6 * 1024 ** 3
					},
					disks: [{ mount: '/', sizeBytes: 1000 * 1024 ** 3, availBytes: 40 * 1024 ** 3 }],
					logs: [
						{ path: '~/Library/Logs/claw.log', bytes: 3 * 1024 ** 3 },
						{ path: '~/Library/Logs/ok.log', bytes: 100 * 1024 ** 2 }
					],
					listeners: [
						{ pid: 733, port: 5173, name: 'node', ageSeconds: 5 * 86400, dev: true },
						{ pid: 734, port: 5174, name: 'node', ageSeconds: 3600, dev: true },
						{ pid: 735, port: 7000, name: 'ControlCenter', ageSeconds: 9 * 86400, dev: false }
					]
				})
			}),
			S
		);
		expect(found.map((f) => [f.id, f.severity])).toEqual([
			['memory-pressure:system', 'serious'],
			['low-disk:/', 'serious'],
			['big-log:~/Library/Logs/claw.log', 'warning'],
			['old-dev-server:5173:733', 'info']
		]);
		expect(found[1].detail).toContain('40.0 GB free of 1000 GB (4%)');
		expect(found[2].proposal?.note).toContain('Do not delete anything without asking me');
	});

	describe('Wheelhouse itself', () => {
		it('judges its memory by footprint, else post-GC heap, never RSS', () => {
			const huge = 4000 * 1024 ** 2;
			expect(ids(input({ vitals: vitals({ rssBytes: huge }) }))).toEqual([]);
			expect(ids(input({ vitals: vitals({ footprintBytes: 1600 * 1024 ** 2 }) }))).toEqual([
				'wheelhouse-memory:self'
			]);
			const f = evaluate(
				input({ vitals: vitals({ footprintBytes: null, postGcHeapBytes: huge }) }),
				S
			)[0];
			expect(f.severity).toBe('serious');
			expect(f.detail).toContain('heap after garbage collection');
		});

		const minutes = (n: number, p99: number, snap: number | null = 1000) =>
			Array.from({ length: n }, (_, i) => ({
				at: NOW - (n - 1 - i) * MIN,
				eventLoopP99Ms: p99,
				lastSnapshotMs: snap
			}));

		it('flags a slow event loop only when it lasts', () => {
			expect(ids(input({ vitalsHistory: minutes(6, 450) }))).toEqual(['event-loop:self']);
			const blip = minutes(6, 450);
			blip[3].eventLoopP99Ms = 40;
			expect(ids(input({ vitalsHistory: blip }))).toEqual([]);
			expect(ids(input({ vitalsHistory: minutes(2, 450) }))).toEqual([]);
		});

		it('flags slow fleet reads only when they last', () => {
			expect(ids(input({ vitalsHistory: minutes(11, 10, 22_000) }))).toEqual([
				'slow-snapshot:self'
			]);
			expect(ids(input({ vitalsHistory: minutes(11, 10, 9_000) }))).toEqual([]);
		});

		it('notes orphaned chat followers', () => {
			const f = evaluate(
				input({
					vitals: vitals({ chatFeeds: { count: 3, listening: 0, watchers: 1, orphans: 1 } })
				}),
				S
			);
			expect(f.map((x) => [x.id, x.severity])).toEqual([['orphan-watchers:self', 'info']]);
		});
	});

	it('notes page trouble over the last hour, and loading that never finished', () => {
		const at = new Date(NOW - 10 * MIN).toISOString();
		const old = new Date(NOW - 2 * 3600_000).toISOString();
		const found = evaluate(
			input({
				signals: [
					{ at, kind: 'network', message: 'GET /api/x → 500', page: '/harbour', count: 8 },
					{ at, kind: 'exception', message: 'boom', page: '/', count: 2 },
					{ at: old, kind: 'exception', message: 'old', page: '/', count: 50 },
					{ at, kind: 'stuck', message: 'Still loading after 60 s', page: '/plugins', count: 1 }
				]
			}),
			S
		);
		expect(found.map((f) => f.id)).toEqual(['page-trouble:errors', 'page-trouble:stuck']);
		expect(found[0].title).toContain('10 errors');
	});

	it('honours changed thresholds', () => {
		const i = input({
			machine: sample({
				disks: [{ mount: '/', sizeBytes: 1000 * 1024 ** 3, availBytes: 150 * 1024 ** 3 }]
			})
		});
		expect(ids(i)).toEqual([]);
		expect(ids(i, { ...S, diskFreePercent: 20 })).toEqual(['low-disk:/']);
	});

	it('remembers a scan by its runs, CPU times, load and memory', () => {
		const p = scanPoint(
			sample({
				services: [service({ runs: 7 }), service({ label: 'x', runs: null })],
				processes: [
					{
						pid: 1,
						ppid: 0,
						cpuSeconds: 33,
						pcpu: 1,
						rssBytes: 1,
						ageSeconds: 1,
						name: 'launchd',
						command: 'launchd'
					}
				]
			})
		);
		expect(p).toEqual({
			at: NOW,
			runs: { 'com.example.claw': 7 },
			cpu: { '1:launchd': 33 },
			load: 1.5,
			availablePercent: 50
		});
	});
});
