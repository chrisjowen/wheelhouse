import { describe, expect, it, vi } from 'vitest';
import type { SecondMate } from '../../types';
import type { RunOptions, RunResult } from './exec';
import { connectorFromConfig, MateLinks, parseMachine, shellWords } from './matelink';

const ID = '0f6c2a9e-5b1d-4c3e-9a7f-2d8e1b4c6a01';

/** `whc-connector machine status` output, as its cli.ts showMachine prints it. */
const line = (state: string, ssh: string, name = 'mate-demo') =>
	`${name.padEnd(24)} ${'fy-mate-demo'.padEnd(26)} ${state.padEnd(12)} ${ssh.padEnd(22)} ${ID}\n`;

const CONFIG = [
	'host fy-mate-demo',
	'user captain',
	'hostname 0f6c2a9e-5b1d-4c3e-9a7f-2d8e1b4c6a01',
	'identityfile ~/.ssh/fy-mates',
	'proxycommand env WHC_CONNECTOR_DIR="/Users/c/my 100%% dir" "/usr/local/bin/node" "/Users/c/whc/dist/connector/cli.js" dial %h',
	''
].join('\n');

describe('Fleetyard’s connector, as the alias runs it', () => {
	it('splits the ProxyCommand line as the shell does', () => {
		expect(shellWords(`env A="x y" "/a b/node" 'c d' e\\ f dial %h`)).toEqual([
			'env',
			'A=x y',
			'/a b/node',
			'c d',
			'e f',
			'dial',
			'%h'
		]);
		expect(shellWords('"open')).toBeNull();
	});

	it('finds the connector before `dial`, with its environment and the alias’s key', () => {
		expect(connectorFromConfig(CONFIG, '/Users/c')).toEqual({
			command: '/usr/local/bin/node',
			args: ['/Users/c/whc/dist/connector/cli.js'],
			env: { WHC_CONNECTOR_DIR: '/Users/c/my 100% dir' },
			identityFile: '/Users/c/.ssh/fy-mates'
		});
		expect(connectorFromConfig('host tokyo-box\nproxycommand none\n', '/h')).toBeNull();
		expect(connectorFromConfig('host x\nproxycommand nc %h %p\n', '/h')).toBeNull();
	});

	it('reads a machine line, and the refusal line after it', () => {
		expect(parseMachine(line('reachable', 'ssh ready'))).toEqual({
			name: 'mate-demo',
			slug: 'mate-demo',
			id: ID,
			state: 'running',
			reachable: true,
			ssh: true,
			keysReady: true,
			matesRefused: null
		});
		expect(parseMachine(line('stopped', '', 'Mate Demo'))).toMatchObject({
			name: 'Mate Demo',
			state: 'stopped',
			reachable: false,
			ssh: null
		});
		expect(
			parseMachine(
				line('reachable', 'ssh: refused your list') +
					'  mate-demo refused your latest approval: not signed by a trusted passkey\n'
			)
		).toMatchObject({ keysReady: false, matesRefused: 'not signed by a trusted passkey' });
		expect(parseMachine('No hosted machines.\n')).toBeNull();
	});
});

const mate: SecondMate = {
	id: 'fleetyard-demo-mate',
	where: 'remote',
	host: 'fy-mate-demo',
	link: { via: 'fleetyard', machine: 'mate-demo', status: null },
	home: '/home/captain/fm-home'
} as SecondMate;

const ok = (stdout: string, durationMs = 80): RunResult => ({
	ok: true,
	stdout,
	stderr: '',
	durationMs
});
const fail = (code: number, stderr: string): RunResult => ({
	ok: false,
	kind: 'exit',
	code,
	signal: null,
	stdout: '',
	stderr,
	message: `exited with code ${code}`,
	durationMs: 90
});

/** A fake ssh and connector: `machine status` answers with `status`; the round trip with `trip`. */
function links(o: {
	status: RunResult;
	trip?: RunResult;
	start?: RunResult;
	stop?: RunResult;
	config?: string;
}) {
	const run = vi.fn(async (cmd: string, args: string[], _o: RunOptions): Promise<RunResult> => {
		if (cmd === 'ssh' && args[0] === '-G') return ok(o.config ?? CONFIG);
		if (cmd === 'ssh') return o.trip ?? ok('', 412);
		const verb = args.slice(1).join(' ');
		if (verb === 'status') return ok('gateway      https://fleetyard.io\ndevice       d\n');
		if (verb.startsWith('machine status')) return o.status;
		if (verb.startsWith('machine start')) return o.start ?? ok(line('starting', ''));
		if (verb.startsWith('machine stop')) return o.stop ?? ok(line('stopping', ''));
		return fail(2, 'usage');
	});
	return {
		run,
		links: new MateLinks({ run, here: 'this Mac', now: () => Date.parse('2026-11-15T13:00:00Z') })
	};
}

describe('the link’s state', () => {
	it('asks the alias’s own connector, and says linked when the machine has let this computer in', async () => {
		const { run, links: l } = links({ status: ok(line('reachable', 'ssh ready')) });
		const s = await l.status(mate);
		expect(s).toMatchObject({
			machine: 'mate-demo',
			here: 'this Mac',
			health: 'linked',
			online: true,
			approved: true,
			problem: null,
			urls: { machines: 'https://fleetyard.io/machines', approve: 'https://fleetyard.io/account' }
		});
		const asked = run.mock.calls.find(([, a]) => a.includes('machine'));
		expect(asked?.[0]).toBe('/usr/local/bin/node');
		expect(asked?.[1]).toEqual([
			'/Users/c/whc/dist/connector/cli.js',
			'machine',
			'status',
			'fy-mate-demo'
		]);
		expect(asked?.[2].env?.WHC_CONNECTOR_DIR).toBe('/Users/c/my 100% dir');
		expect(l.cached(mate.id)).toEqual(s);
	});

	it('says stopped with Wake, not approved with Approve, and not connected with Connect', async () => {
		expect((await links({ status: ok(line('stopped', '')) }).links.status(mate)).problem).toEqual({
			code: 'stopped',
			text: 'mate-demo is stopped.',
			action: 'wake'
		});
		const pending = await links({
			status: ok(line('reachable', 'ssh: keys on their way'))
		}).links.status(mate);
		expect(pending).toMatchObject({
			health: 'pending',
			approved: false,
			problem: { action: 'approve' }
		});
		const unpaired = await links({
			status: fail(1, 'whc-connector: this computer is not paired. Run `whc-connector pair` first.')
		}).links.status(mate);
		expect(unpaired).toMatchObject({
			health: 'pending',
			problem: { code: 'not-connected', action: 'connect' }
		});
	});

	it('keeps what a machine last said of this computer’s approval while it is stopped', async () => {
		let answer = ok(line('reachable', 'ssh ready'));
		const l = new MateLinks({
			run: async (cmd, args) =>
				cmd === 'ssh'
					? ok(CONFIG)
					: args.at(-1) === 'status'
						? ok('gateway https://fleetyard.io\n')
						: answer,
			here: 'this Mac'
		});
		expect((await l.status(mate, 0)).approved).toBe(true);
		answer = ok(line('stopped', ''));
		expect(await l.status(mate, 0)).toMatchObject({
			online: false,
			approved: true,
			health: 'down'
		});
	});

	it('says plainly when the alias has no Fleetyard link set up', async () => {
		const s = await links({
			status: ok(''),
			config: 'host fy-mate-demo\nproxycommand none\n'
		}).links.status(mate);
		expect(s.problem).toMatchObject({
			code: 'no-connector',
			text: 'This Mac has no Fleetyard link set up for mate-demo.'
		});
	});
});

describe('Test connection', () => {
	it('checks each leg in turn and times the round trip to the second mate’s home', async () => {
		const { run, links: l } = links({ status: ok(line('reachable', 'ssh ready'), 84) });
		const t = await l.test(mate);
		expect(t.steps.map((s) => [s.label, s.state, s.ms])).toEqual([
			['Fleetyard answers', 'ok', 84],
			['mate-demo is online', 'ok', null],
			['This Mac is approved on mate-demo', 'ok', null],
			['fleetyard-demo-mate answers', 'ok', 412]
		]);
		expect(t.roundTripMs).toBe(412);
		const trip = run.mock.calls.find(([c, a]) => c === 'ssh' && a[0] !== '-G');
		expect(trip?.[1]).toContain('BatchMode=yes');
		expect(trip?.[1].at(-1)).toContain("'/home/captain/fm-home'");
	});

	it('stops at the first leg that fails, with the reason and its fix', async () => {
		const t = await links({ status: ok(line('stopped', '')) }).links.test(mate);
		expect(t.steps.map((s) => s.state)).toEqual(['ok', 'bad', 'skipped', 'skipped']);
		expect(t.steps[1].problem).toMatchObject({ text: 'mate-demo is stopped.', action: 'wake' });

		const gone = await links({
			status: fail(
				1,
				'whc-connector: Could not reach https://fleetyard.io: getaddrinfo ENOTFOUND fleetyard.io'
			)
		}).links.test(mate);
		expect(gone.steps.map((s) => s.state)).toEqual(['bad', 'skipped', 'skipped', 'skipped']);

		const noHome = await links({
			status: ok(line('reachable', 'ssh ready')),
			trip: fail(1, '')
		}).links.test(mate);
		expect(noHome.steps[3].problem?.text).toBe(
			'Reached mate-demo, but fleetyard-demo-mate’s home /home/captain/fm-home is not there.'
		);

		const cut = await links({
			status: ok(line('reachable', 'ssh ready')),
			trip: fail(
				255,
				'whc-connector: The machine went offline.\nConnection closed by UNKNOWN port 65535\n'
			)
		}).links.test(mate);
		expect(cut.steps[3].problem?.text).toBe('mate-demo went offline.');
		expect(JSON.stringify([t, gone, noHome, cut])).not.toMatch(/ssh/i);
	});
});

describe('Wake', () => {
	it('starts the machine through the connector and says it is coming up', async () => {
		const { run, links: l } = links({ status: ok(line('stopped', '')) });
		const s = await l.wake(mate);
		expect(run.mock.calls.some(([, a]) => a.join(' ').endsWith('machine start fy-mate-demo'))).toBe(
			true
		);
		expect(s).toMatchObject({ online: false, problem: { code: 'starting' } });
	});
});

describe('Stop', () => {
	it('stops the machine through the connector and says it is stopping, then Wake', async () => {
		const { run, links: l } = links({ status: ok(line('reachable', 'ssh ready')) });
		const s = await l.stop(mate);
		expect(run.mock.calls.some(([, a]) => a.join(' ').endsWith('machine stop fy-mate-demo'))).toBe(
			true
		);
		expect(s).toMatchObject({
			online: false,
			problem: { code: 'starting', text: 'mate-demo is stopping; wake it once it has stopped.' }
		});
		const stopped = await links({
			status: ok(line('stopped', '')),
			stop: ok(line('stopped', ''))
		}).links.stop(mate);
		expect(stopped.problem).toMatchObject({ code: 'stopped', action: 'wake' });
	});

	it('says why in plain words when Fleetyard refuses', async () => {
		const s = await links({
			status: ok(line('reachable', 'ssh ready')),
			stop: fail(1, 'whc-connector: no hosted machine called fy-mate-demo\n')
		}).links.stop(mate);
		expect(s.problem?.code).toBe('gone');
	});
});

describe('Approve and Connect', () => {
	it('offers this computer’s key for the machine and names the page and code to check', async () => {
		let finish: (r: RunResult) => void = () => {};
		const run = vi.fn((cmd: string, args: string[], o: RunOptions): Promise<RunResult> => {
			if (cmd === 'ssh') return Promise.resolve(ok(CONFIG));
			if (args.includes('ssh-setup')) {
				o.onStdout?.(
					Buffer.from(
						"\n  Approve this computer for mate-demo with your passkey, on https://fleetyard.io/account/mate-keys/k1\n  Check the page shows this computer's SSH key:  SHA256:abcd\n"
					)
				);
				return new Promise((r) => (finish = r));
			}
			if (args.at(-1) === 'status') return Promise.resolve(ok('gateway https://fleetyard.io\n'));
			return Promise.resolve(ok(line('reachable', 'ssh ready')));
		});
		const l = new MateLinks({ run, here: 'this Mac' });
		const job = await l.start(mate, 'approve');
		const call = run.mock.calls.find(([, a]) => a.includes('ssh-setup'));
		expect(call?.[1].slice(1)).toEqual([
			'ssh-setup',
			'fy-mate-demo',
			'--key',
			`${process.env.HOME}/.ssh/fy-mates`
		]);
		expect(job).toMatchObject({
			kind: 'approve',
			state: 'running',
			url: 'https://fleetyard.io/account/mate-keys/k1',
			code: 'SHA256:abcd'
		});
		expect(await l.start(mate, 'approve')).toBe(job);
		finish(ok(''));
		await vi.waitFor(() => expect(l.view(mate.id).job?.state).toBe('done'));
		expect(l.view(mate.id).job?.message).toBe('This Mac is approved for mate-demo.');
	});

	it('pairs this computer, naming the code to type on Fleetyard', async () => {
		const run = vi.fn((cmd: string, args: string[], o: RunOptions): Promise<RunResult> => {
			if (cmd === 'ssh') return Promise.resolve(ok(CONFIG));
			o.onStdout?.(
				Buffer.from(
					'13:00:00 pair this machine: open https://fleetyard.io/pair, type code WXYZ-1234, pick fingerprint ab:cd (expires in 10 min)\n'
				)
			);
			return Promise.resolve(fail(1, 'whc-connector: pairing expired'));
		});
		const l = new MateLinks({ run, here: 'this Mac' });
		const job = await l.start(mate, 'connect');
		expect(run.mock.calls.find(([c]) => c !== 'ssh')?.[1].at(-1)).toBe('pair');
		expect(job).toMatchObject({ url: 'https://fleetyard.io/pair', code: 'WXYZ-1234' });
		await vi.waitFor(() => expect(l.view(mate.id).job?.state).toBe('failed'));
	});
});
