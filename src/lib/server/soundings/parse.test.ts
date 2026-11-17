import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
	devServerName,
	parseDf,
	parseDuration,
	parseFootprint,
	parseLaunchctlList,
	parseLaunchctlPrint,
	parseLsofListen,
	parseMeminfo,
	parsePressureLevel,
	parsePs,
	parsePsi,
	parseSmapsRollup,
	parseSs,
	parseSwapUsage,
	parseSystemctlShow,
	parseVmStat,
	programName,
	watchedLabel
} from './parse';

const fixture = (name: string) =>
	readFileSync(path.join(import.meta.dirname, 'fixtures', name), 'utf8');

describe('ps', () => {
	it('reads durations in both forms', () => {
		expect(parseDuration('02-04:27:19')).toBe(2 * 86400 + 4 * 3600 + 27 * 60 + 19);
		expect(parseDuration('33:52.50')).toBeCloseTo(33 * 60 + 52.5);
		expect(parseDuration('179:04.11')).toBeCloseTo(179 * 60 + 4.11);
		expect(parseDuration('01:02:03')).toBe(3723);
		expect(parseDuration('00:12')).toBe(12);
		expect(parseDuration('')).toBe(0);
		expect(parseDuration('n/a')).toBe(0);
	});

	it('reads macOS rows, with command lines that hold spaces', () => {
		const rows = parsePs(fixture('ps-darwin.txt'));
		expect(rows).toHaveLength(5);
		expect(rows[1]).toMatchObject({
			pid: 412,
			ppid: 1,
			pcpu: 98.7,
			rssBytes: 524288 * 1024,
			ageSeconds: 3 * 3600 + 2 * 60 + 10
		});
		expect(rows[1].cpuSeconds).toBeCloseTo(179 * 60 + 4.11);
		expect(rows[4].args).toBe('/Applications/Big App.app/Contents/MacOS/Big App --type=renderer');
		expect(programName(rows[1].args)).toBe('claw-agent');
	});

	it('reads Linux rows', () => {
		const rows = parsePs(fixture('ps-linux.txt'));
		expect(rows.map((r) => r.pid)).toEqual([1, 3100, 3222]);
		expect(rows[1].cpuSeconds).toBe(12 * 60);
		expect(rows[1].ageSeconds).toBe(4 * 86400);
	});
});

describe('launchd', () => {
	it('lists jobs, and follows only third-party ones', () => {
		const jobs = parseLaunchctlList(fixture('launchctl-list.txt'));
		expect(jobs).toHaveLength(5);
		expect(jobs[1]).toEqual({ pid: null, status: 78, label: 'com.example.claw' });
		expect(jobs.filter((j) => watchedLabel(j.label)).map((j) => j.label)).toEqual([
			'com.example.claw',
			'com.example.updater',
			'com.example.hourly'
		]);
	});

	it('reads a crash-looping job: its runs, exit code and program', () => {
		expect(parseLaunchctlPrint(fixture('launchctl-print-crashing.txt'))).toEqual({
			runs: 123821,
			lastExit: 78,
			state: 'spawn scheduled',
			pid: null,
			program: '/opt/example/bin/claw-agent',
			periodic: false
		});
	});

	it('knows a job on a timer, and reads its arguments when it names no program', () => {
		const job = parseLaunchctlPrint(fixture('launchctl-print-periodic.txt'));
		expect(job.periodic).toBe(true);
		expect(job.runs).toBe(51);
		expect(job.lastExit).toBe(0);
		expect(job.program).toBe('/Applications/Example.app/Contents/MacOS/Updater --update');
	});
});

describe('memory', () => {
	it('reads vm_stat in its own page size', () => {
		const v = parseVmStat(fixture('vm_stat.txt'));
		expect(v.pageSize).toBe(16384);
		expect(v.free).toBe(219628);
		expect(v.inactive).toBe(1381599);
		expect(v.compressed).toBe(412233);
	});

	it('reads the pressure level and swap', () => {
		expect(parsePressureLevel('1\n')).toBe('normal');
		expect(parsePressureLevel('2')).toBe('warn');
		expect(parsePressureLevel('4')).toBe('critical');
		expect(parsePressureLevel('')).toBeNull();
		expect(parseSwapUsage('total = 2048.00M  used = 1536.50M  free = 511.50M  (encrypted)')).toBe(
			Math.round(1536.5 * 1024 ** 2)
		);
		expect(parseSwapUsage('nonsense')).toBeNull();
	});

	it('reads Linux meminfo and pressure stall information', () => {
		expect(parseMeminfo(fixture('meminfo.txt'))).toEqual({
			totalBytes: 16303428 * 1024,
			availableBytes: 612340 * 1024,
			swapUsedBytes: (4194300 - 1048576) * 1024
		});
		expect(parsePsi(fixture('psi-memory.txt'))).toBe('warn');
		expect(parsePsi('some avg10=0.00 avg60=0.00 avg300=0.00 total=0')).toBe('normal');
		expect(parsePsi('some avg10=60 avg60=55.00 avg300=1 total=0')).toBe('critical');
	});

	it('reads a footprint on macOS and a PSS on Linux', () => {
		expect(parseFootprint(fixture('footprint.txt'))).toBe(612 * 1024 ** 2);
		expect(parseFootprint('Footprint: 2961 KB')).toBe(2961 * 1024);
		expect(parseFootprint('')).toBeNull();
		expect(parseSmapsRollup(fixture('smaps_rollup.txt'))).toBe(480000 * 1024);
	});
});

describe('disks', () => {
	it('keeps the disks that hold files, once per pool of free space', () => {
		expect(parseDf(fixture('df-darwin.txt'))).toEqual([
			{ mount: '/', sizeBytes: 971350180 * 1024, availBytes: 68350104 * 1024 },
			{ mount: '/Volumes/Backup', sizeBytes: 1953514584 * 1024, availBytes: 53514584 * 1024 }
		]);
	});
});

describe('listening ports', () => {
	it('reads lsof, once per program and port', () => {
		expect(parseLsofListen(fixture('lsof-listen.txt'))).toEqual([
			{ pid: 515, name: 'ControlCenter', port: 7000 },
			{ pid: 733, name: 'node', port: 5173 },
			{ pid: 545, name: 'rapportd', port: 631 }
		]);
	});

	it('reads ss, skipping ports with no program of the user’s', () => {
		expect(parseSs(fixture('ss-listen.txt'))).toEqual([
			{ pid: 3100, name: 'node', port: 5173 },
			{ pid: 3222, name: 'python3', port: 8000 }
		]);
	});

	it('knows a development server by its program', () => {
		expect(devServerName('node')).toBe(true);
		expect(devServerName('python3.12')).toBe(true);
		expect(devServerName('ControlCenter')).toBe(false);
	});
});

describe('systemd', () => {
	it('reads restart counts, exit codes and programs for each unit', () => {
		const units = parseSystemctlShow(fixture('systemctl-show.txt'));
		expect(units).toHaveLength(3);
		expect(units[0]).toEqual({
			label: 'claw.service',
			runs: 4211,
			lastExit: 1,
			pid: null,
			state: 'activating / auto-restart',
			program: '/usr/local/bin/claw --config /home/sam/.claw/config.json',
			periodic: false
		});
		expect(units[1].periodic).toBe(true);
		expect(units[2].pid).toBe(1888);
	});
});
