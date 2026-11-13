import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { which } from '../sessions/tmux';
import {
	checkTools,
	commonTools,
	detectPlatform,
	oneClickSteps,
	parseBootstrap,
	remedy,
	stepsFor,
	systemInstall
} from './deps';

/** What Firstmate's fm-bootstrap.sh prints, line for line (see its header). */
const OUTPUT = [
	"MISSING: tmux (install: brew install tmux  # or the platform's package manager)",
	'MISSING: treehouse (install: curl -fsSL https://kunchenguid.github.io/treehouse/install.sh | sh)',
	'MISSING: gh-axi (install: npm install -g gh-axi && gh-axi setup hooks)',
	'MISSING: tasks-axi (install: npm install -g tasks-axi)',
	'MISSING_MANUAL: herdr (instructions: https://herdr.dev)',
	'OUTDATED: no-mistakes (installed: 1.40.0; requires 1.46.0; upgrade: no-mistakes update)',
	'PRESENTATION_UNAVAILABLE: lavish-axi (requires >=0.1.77; install: npm install -g lavish-axi && lavish-axi setup hooks) - nonvisual work may proceed with plain-text decisions and reports; install or upgrade before using Lavish',
	'NEEDS_GH_AUTH',
	'TANGLE: primary checkout on feature branch',
	'MISSING: contribution observation could not be armed; coverage is unconfirmed',
	''
].join('\n');

describe('parseBootstrap', () => {
	it('reads every line shape Firstmate prints, keeping the rest as it was', () => {
		const { findings, other } = parseBootstrap(OUTPUT);
		expect(findings).toEqual([
			{
				kind: 'missing',
				tool: 'tmux',
				command: "brew install tmux  # or the platform's package manager"
			},
			{
				kind: 'missing',
				tool: 'treehouse',
				command: 'curl -fsSL https://kunchenguid.github.io/treehouse/install.sh | sh'
			},
			{ kind: 'missing', tool: 'gh-axi', command: 'npm install -g gh-axi && gh-axi setup hooks' },
			{ kind: 'missing', tool: 'tasks-axi', command: 'npm install -g tasks-axi' },
			{ kind: 'manual', tool: 'herdr', url: 'https://herdr.dev' },
			{
				kind: 'outdated',
				tool: 'no-mistakes',
				installed: '1.40.0',
				requires: '1.46.0',
				command: 'no-mistakes update'
			},
			{
				kind: 'optional',
				tool: 'lavish-axi',
				requires: '>=0.1.77',
				command: 'npm install -g lavish-axi && lavish-axi setup hooks',
				why: expect.stringMatching(/^nonvisual work/)
			},
			{ kind: 'gh-auth' }
		]);
		expect(other).toEqual([
			'TANGLE: primary checkout on feature branch',
			'MISSING: contribution observation could not be armed; coverage is unconfirmed'
		]);
	});

	it('reads the universal tool list from the script itself', () => {
		expect(commonTools('x\nCOMMON_TOOLS="node git gh"\ny')).toEqual(['node', 'git', 'gh']);
		expect(commonTools(null)).toContain('no-mistakes');
	});
});

describe('one click', () => {
	const npm = { packageManager: null, npmWritable: true };
	const brew = { packageManager: 'brew' as const, npmWritable: true };

	it('runs only npm or Homebrew installs, and the package’s own setup hooks', () => {
		expect(oneClickSteps('npm install -g tasks-axi', npm)).toEqual([
			['npm', 'install', '-g', 'tasks-axi']
		]);
		expect(oneClickSteps('npm install -g @anthropic-ai/claude-code', npm)).toEqual([
			['npm', 'install', '-g', '@anthropic-ai/claude-code']
		]);
		expect(oneClickSteps('npm install -g gh-axi && gh-axi setup hooks', npm)).toEqual([
			['npm', 'install', '-g', 'gh-axi'],
			['gh-axi', 'setup', 'hooks']
		]);
		expect(oneClickSteps('brew install tmux', brew)).toEqual([['brew', 'install', 'tmux']]);
		expect(oneClickSteps('brew install --cask cmux', brew)).toEqual([
			['brew', 'install', '--cask', 'cmux']
		]);
	});

	it('never runs a script, sudo, a shell, another package’s step or Homebrew where there is none', () => {
		for (const cmd of [
			'curl -fsSL https://kunchenguid.github.io/treehouse/install.sh | sh',
			'sudo apt-get install -y tmux',
			'npm install -g tasks-axi; rm -rf ~',
			'npm install -g $(evil)',
			'npm install -g gh-axi && other setup hooks',
			'npm install -g gh-axi && gh-axi setup hooks --force',
			'npm install -g a b',
			'no-mistakes update',
			'bin/fm-install-hc.sh <dir>'
		]) {
			expect(oneClickSteps(cmd, brew), cmd).toBeNull();
		}
		expect(oneClickSteps('brew install tmux', npm)).toBeNull();
		expect(
			oneClickSteps('npm install -g tasks-axi', { packageManager: null, npmWritable: false })
		).toBeNull();
	});

	it('turns Firstmate’s brew line into this computer’s package manager, for the terminal', () => {
		const apt = { packageManager: 'apt' as const, npmWritable: true };
		expect(remedy('tmux', "brew install tmux  # or the platform's package manager", apt)).toEqual({
			oneClick: null,
			terminal: ['sudo apt-get install -y tmux'],
			note: null
		});
		expect(
			remedy('tmux', "brew install tmux  # or the platform's package manager", brew)
		).toMatchObject({
			oneClick: { command: 'brew install tmux' }
		});
		expect(systemInstall('gh', 'pacman')).toBe('sudo pacman -S --needed github-cli');
		expect(systemInstall('gh', 'apt')).toBeNull();
		expect(remedy('gh', 'brew install gh  # or …', apt)).toMatchObject({
			terminal: [],
			note: expect.any(String)
		});
		expect(remedy('treehouse', 'curl -fsSL https://x/install.sh | sh', apt)).toMatchObject({
			oneClick: null,
			terminal: ['curl -fsSL https://x/install.sh | sh']
		});
		expect(
			remedy('tasks-axi', 'npm install -g tasks-axi', { packageManager: null, npmWritable: false })
		).toMatchObject({
			oneClick: null,
			terminal: ['npm install -g tasks-axi'],
			note: expect.stringMatching(/sudo/)
		});
	});

	it('names the platform and its package manager', () => {
		const has = (names: string[]) => (n: string) => (names.includes(n) ? `/usr/bin/${n}` : null);
		expect(detectPlatform('darwin', has(['brew']))).toEqual({
			os: 'macos',
			label: 'macOS (brew)',
			packageManager: 'brew'
		});
		expect(detectPlatform('linux', has(['apt-get']))).toMatchObject({
			os: 'linux',
			packageManager: 'apt'
		});
		expect(detectPlatform('linux', has([]))).toMatchObject({
			label: 'Linux',
			packageManager: null
		});
	});
});

describe.skipIf(!which('bash', process.env.PATH))('checkTools', () => {
	let fm: string;
	let bin: string;
	beforeEach(() => {
		fm = mkdtempSync(path.join(tmpdir(), 'wh-deps-'));
		bin = path.join(fm, 'fakebin');
		mkdirSync(path.join(fm, 'bin'), { recursive: true });
		mkdirSync(bin);
	});
	afterEach(() => rmSync(fm, { recursive: true, force: true }));

	const script = (file: string, body: string) => {
		writeFileSync(file, `#!/usr/bin/env bash\n${body}\n`);
		chmodSync(file, 0o755);
	};

	it('runs Firstmate’s check detect-only and lists what it found and what it did not', async () => {
		script(
			path.join(fm, 'bin', 'fm-bootstrap.sh'),
			[
				'COMMON_TOOLS="node git tasks-axi"',
				'[ "$FM_BOOTSTRAP_DETECT_ONLY" = 1 ] || { echo "NOT DETECT ONLY"; exit 1; }',
				'echo "MISSING: tasks-axi (install: npm install -g tasks-axi)"',
				'echo "NEEDS_GH_AUTH"',
				'echo "BOOTSTRAP_INFO: home=$FM_HOME"'
			].join('\n')
		);
		script(
			path.join(fm, 'bin', 'fm-backend.sh'),
			'fm_backend_name() { printf tmux; }\nfm_backend_required_tools() { printf "tmux treehouse"; }'
		);
		for (const t of ['node', 'git', 'tmux', 'treehouse', 'gh'])
			script(path.join(bin, t), `echo "${t} 1.2.3"`);
		script(path.join(bin, 'npm'), `echo "${fm}/npm-prefix"`);
		mkdirSync(path.join(fm, 'npm-prefix', 'lib', 'node_modules'), { recursive: true });
		const env = { ...process.env, PATH: `${bin}:${process.env.PATH}` };
		const r = await checkTools({
			firstmateDir: fm,
			homeDir: '/the/home',
			env,
			platform: { os: 'linux', label: 'Linux', packageManager: null }
		});
		expect(r.error).toBeNull();
		expect(r.backend).toBe('tmux');
		const by = Object.fromEntries(r.items.map((i) => [i.tool, i]));
		expect(Object.keys(by)).toEqual(['tmux', 'treehouse', 'node', 'git', 'tasks-axi', 'gh']);
		expect(by.node).toMatchObject({ status: 'ok', detail: 'node 1.2.3' });
		expect(by['tasks-axi']).toMatchObject({
			status: 'missing',
			oneClick: { command: 'npm install -g tasks-axi' }
		});
		expect(by.gh).toMatchObject({ status: 'needs-auth', terminal: ['gh auth login'] });
		expect(r.notes).toEqual(['BOOTSTRAP_INFO: home=/the/home']);
		expect(stepsFor(r, 'tasks-axi', { packageManager: null, npmWritable: true })).toEqual({
			command: 'npm install -g tasks-axi',
			steps: [['npm', 'install', '-g', 'tasks-axi']]
		});
		expect(stepsFor(r, 'gh', { packageManager: null, npmWritable: true })).toBeNull();
	});

	it('needs herdr at the minimum version instead of tmux when herdr runs the session', async () => {
		script(path.join(fm, 'bin', 'fm-bootstrap.sh'), 'COMMON_TOOLS="node"');
		script(
			path.join(fm, 'bin', 'fm-backend.sh'),
			'fm_backend_name() { printf herdr; }\nfm_backend_required_tools() { printf "herdr jq"; }'
		);
		for (const t of ['node', 'jq']) script(path.join(bin, t), `echo "${t} 1.2.3"`);
		// Only the fake bin: no tmux, herdr or npm from this computer.
		const env = { ...process.env, PATH: `${bin}:/usr/bin:/bin` };
		const find = (n: string) =>
			['bash', 'sh'].includes(n) ? which(n, process.env.PATH) : which(n, bin);
		const check = () =>
			checkTools({
				firstmateDir: fm,
				homeDir: fm,
				env,
				find,
				platform: { os: 'linux', label: 'Linux', packageManager: null },
				sessionBackend: 'herdr'
			});
		let by = Object.fromEntries((await check()).items.map((i) => [i.tool, i]));
		expect(by.tmux).toBeUndefined();
		expect(by.herdr).toMatchObject({ status: 'missing', required: true });
		expect(by.herdr.detail).toMatch(/0\.7\.4/);

		script(path.join(bin, 'herdr'), 'echo "herdr 0.7.3"');
		by = Object.fromEntries((await check()).items.map((i) => [i.tool, i]));
		expect(by.herdr).toMatchObject({ status: 'outdated' });
		expect(by.herdr.detail).toMatch(/0\.7\.3 installed.*0\.7\.4/);

		script(path.join(bin, 'herdr'), 'echo "herdr 0.9.1"');
		by = Object.fromEntries((await check()).items.map((i) => [i.tool, i]));
		expect(by.herdr).toMatchObject({ status: 'ok', detail: 'herdr 0.9.1' });
		expect(Object.keys(by)[0]).toBe('herdr');
	});

	it('says when Firstmate’s check is not there', async () => {
		const r = await checkTools({
			firstmateDir: fm,
			homeDir: fm,
			env: process.env,
			platform: { os: 'linux', label: 'Linux', packageManager: null }
		});
		expect(r.error).toMatch(/fm-bootstrap\.sh is missing/);
	});
});
