import { execFileSync } from 'node:child_process';
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	symlinkSync,
	writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { defaultDeps, plainOutput, type CheckDeps } from './checks';
import { ConsentStore, consentFileFor } from './consent';
import { readEditorFile, writeEditorFile } from './editor';
import { commandsDigest, PassageService } from './service';
import { digestOf } from './sources';
import type { StageFacts } from '../firstmate/stages';
import type { RunOptions, RunResult } from '../firstmate/exec';

const root = mkdtempSync(path.join(tmpdir(), 'wh-editor-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));

const sh = (cwd: string, ...a: string[]) =>
	execFileSync('git', a, {
		cwd,
		encoding: 'utf8',
		env: {
			...process.env,
			GIT_AUTHOR_NAME: 'T',
			GIT_AUTHOR_EMAIL: 't@x',
			GIT_COMMITTER_NAME: 'T',
			GIT_COMMITTER_EMAIL: 't@x'
		}
	}).trim();

const DEPLOY = `version: 1
checks:
  local:
    type: command
    label: Local deploy
    run: [pnpm, "deploy:local"]
    timeout: 20m
    env: [KUBECONFIG]
stages:
  - id: local-deploy
    label: Local deploy
    after: landed
    reached_when: local.passed
    failed_when: local.failed
    evidence: ['check:local']
`;

/** A Firstmate home whose project clone has `file` on origin's main. */
function makeHome(name: string, file: string | null) {
	const base = path.join(root, name);
	const origin = path.join(base, 'origin.git');
	const work = path.join(base, 'work');
	const home = path.join(base, 'home');
	mkdirSync(work, { recursive: true });
	sh(base, 'init', '-q', '--bare', '-b', 'main', origin);
	sh(work, 'init', '-q', '-b', 'main');
	sh(work, 'remote', 'add', 'origin', origin);
	writeFileSync(path.join(work, 'README.md'), 'hi\n');
	if (file !== null) writeFileSync(path.join(work, '.wheelhouse.yaml'), file);
	sh(work, 'add', '-A');
	sh(work, 'commit', '-qm', 'main');
	sh(work, 'push', '-q', 'origin', 'main');
	mkdirSync(path.join(home, 'projects'), { recursive: true });
	const clone = path.join(home, 'projects', 'web');
	sh(home, 'clone', '-q', origin, clone);
	return { base, home, clone };
}

const facts = (o: Partial<StageFacts> = {}): StageFacts => ({
	track: 'ship',
	backlogState: 'done',
	live: false,
	crewState: null,
	crewSource: null,
	mode: null,
	yolo: null,
	prUrl: null,
	prReady: false,
	merged: true,
	reportPresent: false,
	captainHold: false,
	taskId: 'web-task',
	landedAt: Date.now(),
	preview: null,
	...o
});

const flush = () => new Promise((r) => setTimeout(r, 30));

async function start(name: string, file: string | null, run: CheckDeps['run'], env = {}) {
	const h = makeHome(name, file);
	const configDir = path.join(h.base, 'config');
	const consent = await ConsentStore.open(
		consentFileFor(path.join(h.base, 'state'), h.home),
		h.home
	);
	const s = new PassageService({
		homeDir: h.home,
		firstmateDir: path.join(h.base, 'fm'),
		configDir,
		consent,
		deps: { ...defaultDeps({ PATH: process.env.PATH, HOME: '/home/captain', ...env }), run },
		ignore: ['unassigned']
	});
	await s.load('web');
	return { s, h, configDir };
}

async function round(s: PassageService, f: StageFacts) {
	s.stagesFor('web').passage(f);
	s.endRound(['web']);
	await flush();
	await flush();
	return s.stagesFor('web').passage(f);
}

function recorder(result: Partial<RunResult> = {}) {
	const calls: { file: string; args: readonly string[]; opts: RunOptions }[] = [];
	const run = async (file: string, args: readonly string[], opts: RunOptions) => {
		calls.push({ file, args, opts });
		return {
			ok: true,
			stdout: '\x1b[32mdeployed\x1b[0m\nwaiting 1/3\rwaiting 3/3\n',
			stderr: '',
			durationMs: 134_000,
			...result
		} as RunResult;
	};
	return { calls, run };
}

describe('command checks', { timeout: 20_000 }, () => {
	it('stay off until the captain allows exactly these commands, then run once and pass', async () => {
		const { calls, run } = recorder();
		const { s } = await start('cmd-consent', DEPLOY, run, { KUBECONFIG: '/k', SECRET: 'x' });
		let p = await round(s, facts());
		expect(p.checks[0]).toMatchObject({
			state: 'off',
			command: 'pnpm deploy:local',
			summary: 'Off until you allow this project’s command checks on its passage page.'
		});
		expect(calls).toEqual([]);
		expect(s.summary('web')).toMatchObject({ needsConsent: true });

		const v = await s.view('web');
		expect(v.commands.list).toEqual([
			{
				id: 'local',
				label: 'Local deploy',
				origin: 'project',
				run: ['pnpm', 'deploy:local'],
				line: 'pnpm deploy:local',
				cwd: '.',
				timeout: '20m',
				env: ['KUBECONFIG'],
				ref: null,
				interval: '10m'
			}
		]);
		expect(v.passages[0].checks[0]).toMatchObject({ command: true, enabled: false });
		// Allowing the project file's network checks does not allow its commands.
		await s.setConsent('web', digestOf(DEPLOY));
		await round(s, facts({ landedAt: Date.now() + 1000 }));
		expect(calls).toEqual([]);

		expect(await s.setCommandConsent('web', 'a'.repeat(64))).toMatchObject({ status: 409 });
		expect(await s.setCommandConsent('web', v.commands.digest)).toEqual({ ok: true });
		p = await round(s, facts({ landedAt: Date.now() + 1000 }));
		expect(calls).toHaveLength(1);
		expect(calls[0].file).toBe('pnpm');
		expect(calls[0].args).toEqual(['deploy:local']);
		expect(calls[0].opts.cwd).toBe(
			execFileSync('realpath', [path.join(s['opts'].homeDir, 'projects', 'web')], {
				encoding: 'utf8'
			}).trim()
		);
		expect(calls[0].opts.timeoutMs).toBe(20 * 60_000);
		expect(calls[0].opts.env).toEqual({
			PATH: process.env.PATH,
			HOME: '/home/captain',
			KUBECONFIG: '/k',
			WHEELHOUSE_TASK_ID: 'web-task',
			WHEELHOUSE_PROJECT: 'web'
		});
		expect(p.steps[p.current]).toMatchObject({ key: 'local-deploy', failed: false });
		expect(p.checks[0]).toMatchObject({
			state: 'observed',
			outcome: 'passed',
			summary: 'Passed in 2 min 14 s.',
			output: 'deployed\nwaiting 3/3\n'
		});
		// A pass is final for the task: it never runs again.
		await round(s, facts({ landedAt: Date.now() + 1000 }));
		expect(calls).toHaveLength(1);
		expect((await s.view('web')).commands.enabled).toBe(true);
	});

	it('never run for a task that landed before they were allowed', async () => {
		const { calls, run } = recorder();
		const { s } = await start('cmd-old', DEPLOY, run);
		const v = await s.view('web');
		await s.setCommandConsent('web', v.commands.digest);
		const p = await round(s, facts({ landedAt: Date.now() - 60_000 }));
		expect(calls).toEqual([]);
		expect(p.checks[0]).toMatchObject({
			state: 'gave-up',
			summary: 'Not run: it landed before you allowed command checks.'
		});
	});

	it('turn off again when a command changes', async () => {
		const { run } = recorder();
		const { s, configDir } = await start('cmd-change', DEPLOY, run);
		const before = (await s.view('web')).commands.digest;
		await s.setCommandConsent('web', before);
		mkdirSync(path.join(configDir, 'projects'), { recursive: true });
		writeFileSync(
			path.join(configDir, 'projects', 'web.yaml'),
			'version: 1\nchecks:\n  local: { type: command, run: [pnpm, "deploy:local", "--force"] }\n'
		);
		await s.load('web');
		const v = await s.view('web');
		expect(v.commands.digest).not.toBe(before);
		expect(v.commands.enabled).toBe(false);
		expect(commandsDigest(v.commands.list)).toBe(v.commands.digest);
	});

	it('report failures, time-outs and programs that cannot start in plain words', async () => {
		for (const [r, outcome, summary] of [
			[
				{ ok: false, kind: 'exit', code: 2, signal: null, message: '' },
				'failed',
				'Failed: it exited with code 2 after 2 min 14 s.'
			],
			[
				{ ok: false, kind: 'timeout', code: null, signal: 'SIGKILL', message: '' },
				'failed',
				'Failed: it did not finish within 20m.'
			],
			[
				{ ok: false, kind: 'spawn-error', code: null, signal: null, message: 'spawn pnpm ENOENT' },
				null,
				'Pnpm was not found on the PATH Wheelhouse runs with.'
			]
		] as const) {
			const { run } = recorder({ stderr: '', ...r } as Partial<RunResult>);
			const { s } = await start(`cmd-${r.kind}`, DEPLOY, run);
			await s.setCommandConsent('web', (await s.view('web')).commands.digest);
			const p = await round(s, facts({ landedAt: Date.now() + 1000 }));
			expect(p.checks[0]).toMatchObject({ outcome, summary });
			if (outcome === 'failed')
				expect(p.steps[p.current]).toMatchObject({ key: 'local-deploy', failed: true });
		}
	});

	it('run only inside the project clone', async () => {
		const { calls, run } = recorder();
		const h = await start(
			'cmd-escape',
			DEPLOY.replace('timeout: 20m', 'timeout: 20m\n    cwd: out'),
			run
		);
		symlinkSync(h.h.base, path.join(h.h.clone, 'out'));
		await h.s.setCommandConsent('web', (await h.s.view('web')).commands.digest);
		const p = await round(h.s, facts({ landedAt: Date.now() + 1000 }));
		expect(calls).toEqual([]);
		expect(p.checks[0]).toMatchObject({
			state: 'unknown',
			summary: 'The folder out leads outside the project clone.'
		});
	});

	it('really run the program, without a shell', async () => {
		const h = makeHome('cmd-real', null);
		const consent = await ConsentStore.open(
			consentFileFor(path.join(h.base, 'state'), h.home),
			h.home
		);
		const configDir = path.join(h.base, 'config');
		mkdirSync(path.join(configDir, 'projects'), { recursive: true });
		writeFileSync(
			path.join(configDir, 'projects', 'web.yaml'),
			'version: 1\nchecks:\n  c: { type: command, run: [/bin/echo, "a; touch pwned", "$HOME"] }\nstages:\n  - { id: ran, label: Ran, after: landed, reached_when: c.passed }\n'
		);
		const s = new PassageService({
			homeDir: h.home,
			firstmateDir: h.base,
			configDir,
			consent,
			deps: defaultDeps({ PATH: process.env.PATH })
		});
		await s.load('web');
		await s.setCommandConsent('web', (await s.view('web')).commands.digest);
		s.stagesFor('web').passage(facts({ landedAt: Date.now() + 1000 }));
		s.endRound(['web']);
		await new Promise((r) => setTimeout(r, 400));
		const p = s.stagesFor('web').passage(facts({ landedAt: Date.now() + 1000 }));
		expect(p.checks[0]).toMatchObject({ outcome: 'passed', output: 'a; touch pwned $HOME\n' });
		expect(existsSync(path.join(h.clone, 'pwned'))).toBe(false);
	});
});

describe('plain output', () => {
	it('drops colour codes and keeps the last redraw of a line', () => {
		expect(plainOutput('\x1b[1;31mred\x1b[0m\n10%\r50%\r100%\r\n\x07done')).toBe('red\n100%\ndone');
	});
});

describe('the passage editor', { timeout: 20_000 }, () => {
	it('reads and writes the project file in the clone, refusing a stale save', async () => {
		const { s, h } = await start('edit-project', DEPLOY, recorder().run);
		const e = await s.editorFile('web', 'project');
		expect(e.file).toMatchObject({ exists: true, text: DEPLOY, digest: digestOf(DEPLOY) });
		expect(e.inEffect).toBe(true);
		expect(e.targets.project.available).toBe(true);
		expect(e.below.ship.steps.map((x) => x.id)).toEqual([
			'queued',
			'building',
			'checks',
			'pr',
			'review',
			'landed'
		]);

		const edited = DEPLOY.replace(
			'label: Local deploy\n    run',
			'label: Deploy to the local cluster\n    run'
		);
		expect(await s.saveFile('web', 'project', edited, 'b'.repeat(64))).toMatchObject({
			ok: false,
			status: 409
		});
		expect(await s.saveFile('web', 'project', 'version: 2\n', digestOf(DEPLOY))).toMatchObject({
			ok: false,
			status: 422,
			errors: ['version: must be 1']
		});
		expect(await s.saveFile('web', 'project', edited, digestOf(DEPLOY))).toEqual({
			ok: true,
			digest: digestOf(edited)
		});
		expect(readFileSync(path.join(h.clone, '.wheelhouse.yaml'), 'utf8')).toBe(edited);
		// Saved in the working tree, but Wheelhouse applies the default branch's version.
		const after = await s.editorFile('web', 'project');
		expect(after.inEffect).toBe(false);
		expect(after.defaultRef).toBe('origin/main');
	});

	it('creates the captain-owned file, and builds on the project file below it', async () => {
		const { s, configDir } = await start('edit-captain', DEPLOY, recorder().run);
		const e = await s.editorFile('web', 'captain');
		expect(e.file).toMatchObject({ exists: false, text: '', digest: null });
		expect(e.below.ship.steps.at(-1)).toEqual({
			id: 'local-deploy',
			label: 'Local deploy',
			origin: 'project'
		});
		const text = 'version: 1\nstages:\n  - { id: local-deploy, label: Deployed locally }\n';
		expect(s.draft('web', 'captain', text)).toEqual({ errors: [], commands: expect.any(Array) });
		expect(await s.saveFile('web', 'captain', text, null)).toMatchObject({ ok: true });
		expect(readFileSync(path.join(configDir, 'projects', 'web.yaml'), 'utf8')).toBe(text);
		const v = await s.view('web');
		expect(v.passages[0].steps.at(-1)).toMatchObject({
			label: 'Deployed locally',
			changedBy: ['captain']
		});
	});

	it('reports reference problems as the file would apply', async () => {
		const { s } = await start('edit-draft', null, recorder().run);
		expect(
			s.draft(
				'web',
				'project',
				'version: 1\nstages:\n  - { id: x, label: X, reached_when: nope.passed }\n'
			).errors
		).toEqual(["x.reached_when: unknown reference 'nope.passed'"]);
	});

	it('never writes through a link', async () => {
		const dir = path.join(root, 'link');
		mkdirSync(dir, { recursive: true });
		const target = path.join(dir, 'elsewhere.txt');
		writeFileSync(target, 'keep\n');
		const file = path.join(dir, '.wheelhouse.yaml');
		symlinkSync(target, file);
		const r = await readEditorFile('project', file);
		expect(r.problem).toMatch(/not a plain file/);
		expect(await writeEditorFile('project', file, 'version: 1\n', null)).toMatchObject({
			ok: false,
			status: 409
		});
		expect(readFileSync(target, 'utf8')).toBe('keep\n');
	});

	it('tests an edited file against a task, running commands only when asked', async () => {
		const { calls, run } = recorder();
		const { s } = await start('edit-test', null, run);
		s.stagesFor('web').passage(facts());
		expect(s.testable('web')).toEqual(['web-task']);
		const off = await s.dryRun('web', 'project', DEPLOY, 'web-task', { runCommands: false });
		expect(off.ok && off.passage.checks[0]).toMatchObject({
			state: 'off',
			summary: 'Not run in this test.'
		});
		expect(calls).toEqual([]);
		const on = await s.dryRun('web', 'project', DEPLOY, 'web-task', { runCommands: true });
		expect(calls).toHaveLength(1);
		expect(on.ok && on.passage.steps[on.passage.current]).toMatchObject({ key: 'local-deploy' });
		expect(on.ok && on.ran).toEqual(['local']);
		expect(await s.dryRun('web', 'project', DEPLOY, 'other', { runCommands: false })).toMatchObject(
			{
				ok: false,
				message: 'Wheelhouse has not seen that task in this project recently.'
			}
		);
		const scout = await s.dryRun('web', 'project', 'version: 1\nextends: scout\n', 'web-task', {
			runCommands: false
		});
		expect(scout).toMatchObject({ ok: false });
	});
});
