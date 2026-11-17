import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { bigLogs, logFolders, probe, type ProbeDeps } from './probe';

const fixture = (name: string) =>
	readFileSync(path.join(import.meta.dirname, 'fixtures', name), 'utf8');

/** A computer made of saved output: each command answers from a fixture, or not at all. */
function deps(platform: NodeJS.Platform, answers: Record<string, string | null>): ProbeDeps {
	const files: Record<string, string> = {
		'/proc/meminfo': fixture('meminfo.txt'),
		'/proc/pressure/memory': fixture('psi-memory.txt'),
		'/proc/4242/smaps_rollup': fixture('smaps_rollup.txt')
	};
	return {
		platform,
		run: async (file, args) => answers[[file, ...args].join(' ')] ?? null,
		readFile: async (file) => files[file] ?? null,
		list: async (dir) =>
			dir === '/Users/sam/Library/Logs'
				? [
						{ name: 'claw.log', dir: false, bytes: 3 * 1024 ** 3 },
						{ name: 'small.log', dir: false, bytes: 1024 },
						{ name: 'Nested', dir: true, bytes: 0 }
					]
				: dir === '/Users/sam/Library/Logs/Nested'
					? [{ name: 'deep.log', dir: false, bytes: 80 * 1024 ** 2 }]
					: null,
		home: platform === 'darwin' ? '/Users/sam' : '/home/sam',
		uid: 501,
		cpus: 8,
		totalMem: 16 * 1024 ** 3,
		load: () => [2.5, 2, 1.5],
		now: () => Date.parse('2026-11-17T12:00:00Z')
	};
}

const PS = 'ps -A -o pid=,ppid=,pcpu=,rss=,etime=,time=,args=';

describe('probe on macOS', () => {
	const mac = deps('darwin', {
		[PS]: fixture('ps-darwin.txt'),
		vm_stat: fixture('vm_stat.txt'),
		'sysctl -n kern.memorystatus_vm_pressure_level': '2',
		'sysctl -n vm.swapusage': 'total = 2048.00M  used = 1024.00M  free = 1024.00M',
		'launchctl list': fixture('launchctl-list.txt'),
		'launchctl print gui/501/com.example.claw': fixture('launchctl-print-crashing.txt'),
		'launchctl print gui/501/com.example.hourly': fixture('launchctl-print-periodic.txt'),
		'lsof -nP -iTCP -sTCP:LISTEN -Fpcn': fixture('lsof-listen.txt'),
		'df -kP': fixture('df-darwin.txt'),
		'footprint 4242': fixture('footprint.txt')
	});

	it('reads everything through the same shape', async () => {
		const s = await probe(mac, { wheelhousePid: 4242, logDirs: [] });
		expect(s.platform).toBe('darwin');
		expect(s.memory.pressure).toBe('warn');
		expect(s.memory.swapUsedBytes).toBe(1024 ** 3);
		expect(s.memory.availableBytes).toBe((219628 + 1381599 + 3450 + 2972) * 16384);
		expect(s.footprintBytes).toBe(612 * 1024 ** 2);
		expect(s.disks.map((d) => d.mount)).toEqual(['/', '/Volumes/Backup']);
		expect(s.services.find((x) => x.label === 'com.example.claw')).toMatchObject({
			runs: 123821,
			lastExit: 78,
			program: '/opt/example/bin/claw-agent'
		});
		// A job that could not be printed keeps what the list said.
		expect(s.services.find((x) => x.label === 'com.example.updater')).toMatchObject({
			runs: null,
			pid: 65612,
			lastExit: 0
		});
		expect(s.listeners.find((l) => l.port === 5173)).toMatchObject({
			pid: 733,
			name: 'node',
			dev: true,
			ageSeconds: 5 * 86400 + 3600
		});
		expect(s.logs).toEqual([
			{ path: '~/Library/Logs/claw.log', bytes: 3 * 1024 ** 3 },
			{ path: '~/Library/Logs/Nested/deep.log', bytes: 80 * 1024 ** 2 }
		]);
		expect(s.gaps).toEqual([]);
	});

	it('keeps command lines masked and without the home folder', async () => {
		const s = await probe(mac, { wheelhousePid: null, logDirs: [] });
		const claw = s.processes.find((p) => p.pid === 412)!;
		expect(claw.name).toBe('claw-agent');
		expect(claw.command).toBe(
			'/opt/example/bin/claw-agent --config ~/.claw/config.json --token=•••'
		);
		expect(JSON.stringify(s)).not.toContain('abcd1234');
		expect(JSON.stringify(s)).not.toContain('/Users/sam');
	});

	it('notes what it could not read and carries on', async () => {
		const s = await probe(deps('darwin', {}), { wheelhousePid: 1, logDirs: [] });
		expect(s.processes).toEqual([]);
		expect([...s.gaps].sort()).toEqual([
			'background services (launchctl)',
			'disks (df)',
			'listening ports',
			'memory pressure (sysctl)',
			'the process list (ps)'
		]);
	});
});

describe('probe on Linux', () => {
	it('reads systemd, /proc and ss behind the same shape', async () => {
		const linux = deps('linux', {
			[PS]: fixture('ps-linux.txt'),
			'systemctl --user list-units --type=service --all --no-legend --plain':
				'claw.service loaded activating auto-restart Claw\nbackup.service loaded inactive dead Backup\npipewire.service loaded active running PipeWire\n',
			'systemctl --user show --property=Id,NRestarts,ExecMainStatus,MainPID,ActiveState,SubState,ExecStart,Type claw.service backup.service pipewire.service':
				fixture('systemctl-show.txt'),
			'ss -ltnpH': fixture('ss-listen.txt'),
			'df -kP':
				'Filesystem 1024-blocks Used Available Capacity Mounted on\n/dev/nvme0n1p2 487652560 470000000 17652560 97% /\n'
		});
		const s = await probe(linux, { wheelhousePid: 4242, logDirs: [] });
		expect(s.platform).toBe('linux');
		expect(s.memory).toEqual({
			totalBytes: 16303428 * 1024,
			availableBytes: 612340 * 1024,
			pressure: 'warn',
			swapUsedBytes: (4194300 - 1048576) * 1024
		});
		expect(s.services[0]).toMatchObject({ label: 'claw.service', runs: 4211, lastExit: 1 });
		expect(s.services[0].program).toBe('/usr/local/bin/claw --config ~/.claw/config.json');
		expect(s.listeners.map((l) => [l.name, l.port, l.dev])).toEqual([
			['node', 5173, true],
			['python3', 8000, true]
		]);
		expect(s.disks).toEqual([
			{ mount: '/', sizeBytes: 487652560 * 1024, availBytes: 17652560 * 1024 }
		]);
		expect(s.footprintBytes).toBe(480000 * 1024);
	});
});

describe('log folders', () => {
	it('adds the captain’s own folders, with ~ for home', () => {
		expect(logFolders('darwin', '/Users/sam', ['~/svc/logs', '/var/tmp/x'])).toEqual([
			'/Users/sam/Library/Logs',
			'/Library/Logs',
			'/Users/sam/.npm/_logs',
			'/Users/sam/.pm2/logs',
			'/Users/sam/svc/logs',
			'/var/tmp/x'
		]);
	});

	it('lists only large files', async () => {
		const logs = await bigLogs(deps('darwin', {}), ['/Users/sam/Library/Logs', '/nowhere']);
		expect(logs.map((l) => l.path)).toEqual([
			'~/Library/Logs/claw.log',
			'~/Library/Logs/Nested/deep.log'
		]);
	});
});
