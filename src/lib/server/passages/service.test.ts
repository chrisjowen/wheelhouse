import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { defaultDeps, type CheckDeps } from './checks';
import { ConsentStore, consentFileFor } from './consent';
import { MAX_REACHED_TASKS, ReachedStore, reachedFileFor } from './reached';
import { CHECK_HORIZON_MS, PassageService } from './service';
import { digestOf, readCaptainFile, readClone, readProjectFile } from './sources';
import { defaultStageModel, type StageFacts } from '../firstmate/stages';
import type { RunResult } from '../firstmate/exec';

const root = mkdtempSync(path.join(tmpdir(), 'wh-passages-'));
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

const WEB = readFileSync(
	path.join(import.meta.dirname, 'testdata', 'web-app.wheelhouse.yaml'),
	'utf8'
);
const MARKER = (n: string) =>
	`version: 1\nstages:\n  - { id: ${n}, label: ${n}, after: landed, reached_when: merged }\n`;

/**
 * A Firstmate home with one project clone: origin's main has `.wheelhouse.yaml`,
 * while a pushed task branch, the clone's working tree, a local commit and a
 * task worktree all carry different versions that must never be read.
 */
function makeHome(name: string, mainFile: string | null) {
	const base = path.join(root, name);
	const origin = path.join(base, 'origin.git');
	const work = path.join(base, 'work');
	const home = path.join(base, 'home');
	mkdirSync(work, { recursive: true });
	sh(base, 'init', '-q', '--bare', '-b', 'main', origin);
	sh(work, 'init', '-q', '-b', 'main');
	sh(work, 'remote', 'add', 'origin', origin);
	writeFileSync(path.join(work, 'README.md'), 'hi\n');
	if (mainFile !== null) writeFileSync(path.join(work, '.wheelhouse.yaml'), mainFile);
	sh(work, 'add', '-A');
	sh(work, 'commit', '-qm', 'main');
	sh(work, 'push', '-q', 'origin', 'main');
	sh(work, 'checkout', '-qb', 'fm/task');
	writeFileSync(path.join(work, '.wheelhouse.yaml'), MARKER('from-task-branch'));
	sh(work, 'add', '-A');
	sh(work, 'commit', '-qm', 'task');
	sh(work, 'push', '-q', 'origin', 'fm/task');
	mkdirSync(path.join(home, 'projects'), { recursive: true });
	const clone = path.join(home, 'projects', 'web');
	sh(home, 'clone', '-q', origin, clone);
	sh(clone, 'checkout', '-q', 'fm/task');
	writeFileSync(path.join(clone, '.wheelhouse.yaml'), MARKER('from-working-tree'));
	sh(
		clone,
		'worktree',
		'add',
		'-q',
		path.join(base, 'task-worktree'),
		'-b',
		'fm/other',
		'origin/main'
	);
	writeFileSync(path.join(base, 'task-worktree', '.wheelhouse.yaml'), MARKER('from-worktree'));
	return { base, origin, work, home, clone };
}

const git = defaultDeps({ PATH: process.env.PATH, HOME: process.env.HOME }).git;

describe('reading passage files', () => {
	it('reads .wheelhouse.yaml only from the clone’s default branch', async () => {
		const h = makeHome('default-branch', WEB);
		const { clone, problem } = await readClone(h.home, 'web', { ...defaultDeps(), git });
		expect(problem).toBeNull();
		expect(clone).toMatchObject({ defaultRef: 'origin/main' });
		const src = await readProjectFile(clone!, { ...defaultDeps(), git });
		expect(src).toMatchObject({ state: 'read', text: WEB, digest: digestOf(WEB) });
		expect(src.location).toBe('.wheelhouse.yaml on origin/main of projects/web');

		// A new default-branch version is seen once the clone has fetched it (Wheelhouse never fetches).
		sh(h.work, 'checkout', '-q', 'main');
		writeFileSync(path.join(h.work, '.wheelhouse.yaml'), MARKER('newer-main'));
		sh(h.work, 'commit', '-qam', 'newer');
		sh(h.work, 'push', '-q', 'origin', 'main');
		expect((await readProjectFile(clone!, { ...defaultDeps(), git })).text).toBe(WEB);
		sh(h.clone, 'fetch', '-q', 'origin');
		expect((await readProjectFile(clone!, { ...defaultDeps(), git })).text).toBe(
			MARKER('newer-main')
		);
	});

	it('reports a project without a file, and one without a clone', async () => {
		const h = makeHome('no-file', null);
		const { clone } = await readClone(h.home, 'web', { ...defaultDeps(), git });
		expect((await readProjectFile(clone!, { ...defaultDeps(), git })).state).toBe('absent');
		expect(await readClone(h.home, 'nope', { ...defaultDeps(), git })).toEqual({
			clone: null,
			problem: 'Firstmate has no clone of this project at projects/nope.'
		});
		expect((await readClone(h.home, '../escape', { ...defaultDeps(), git })).clone).toBeNull();
	});

	it('reads the captain-owned file from the config directory', async () => {
		const dir = path.join(root, 'config-read');
		mkdirSync(path.join(dir, 'projects'), { recursive: true });
		writeFileSync(path.join(dir, 'projects', 'web.yaml'), 'version: 1\n');
		expect(await readCaptainFile(dir, 'web')).toMatchObject({
			state: 'read',
			text: 'version: 1\n'
		});
		expect((await readCaptainFile(dir, 'other')).state).toBe('absent');
		writeFileSync(path.join(dir, 'projects', 'big.yaml'), 'x'.repeat(65 * 1024));
		expect((await readCaptainFile(dir, 'big')).state).toBe('unreadable');
	});
});

const MERGE = 'a'.repeat(40);
const PR = 'https://github.com/acme/web/pull/7';
const ok = (v: unknown): RunResult => ({
	ok: true,
	stdout: JSON.stringify(v),
	stderr: '',
	durationMs: 1
});

/** gh and fetch for a merged PR whose production deployment succeeded and serves the commit. */
function world(
	o: { deploy?: string; staging?: boolean; live?: string; calls?: string[]; prOpen?: boolean } = {}
): Pick<CheckDeps, 'gh' | 'fetch'> {
	const calls = o.calls ?? [];
	return {
		gh: async (args) => {
			calls.push(args[0] === 'api' ? args[3] : args.slice(0, 3).join(' '));
			if (args[0] === 'pr' && o.prOpen)
				return ok({ headRefOid: 'b'.repeat(40), mergeCommit: null, state: 'OPEN' });
			if (args[0] === 'pr')
				return ok({ headRefOid: 'b'.repeat(40), mergeCommit: { oid: MERGE }, state: 'MERGED' });
			const p = args[3];
			if (p.includes('deployments?') && p.includes('environment=Production'))
				return ok([{ id: 9 }]);
			if (o.staging && p.includes('deployments?') && p.includes('environment=Staging'))
				return ok([{ id: 10 }]);
			if (p.includes('deployments/10/statuses')) return ok({ state: 'success' });
			if (p.includes('deployments/9/statuses')) {
				if (o.deploy === 'unreadable') {
					return {
						ok: false,
						kind: 'exit',
						code: 1,
						signal: null,
						stdout: '',
						stderr: 'HTTP 502: Bad Gateway',
						message: 'failed',
						durationMs: 1
					};
				}
				return ok({ state: o.deploy ?? 'success', environment_url: 'https://docs.example.dev' });
			}
			return ok([]);
		},
		fetch: (async () => new Response(JSON.stringify({ commit: o.live ?? MERGE }))) as typeof fetch
	};
}

const flush = async () => {
	for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 5));
};

function landed(o: Partial<StageFacts> = {}): StageFacts {
	return {
		track: 'ship',
		backlogState: 'done',
		live: false,
		crewState: null,
		crewSource: null,
		mode: null,
		yolo: null,
		prUrl: PR,
		prReady: false,
		merged: true,
		reportPresent: false,
		captainHold: false,
		taskId: 'ship-docs',
		landedAt: Date.now() - 3600_000,
		preview: null,
		...o
	};
}

async function service(
	name: string,
	mainFile: string | null,
	o: {
		captain?: string;
		deploy?: string;
		staging?: boolean;
		live?: string;
		calls?: string[];
		prOpen?: boolean;
		reached?: boolean;
		now?: () => number;
	} = {}
) {
	const h = makeHome(name, mainFile);
	return start(h, o);
}

/** A Wheelhouse process over a home; starting it again over the same home is a restart. */
async function start(
	h: ReturnType<typeof makeHome>,
	o: {
		captain?: string;
		deploy?: string;
		staging?: boolean;
		live?: string;
		calls?: string[];
		prOpen?: boolean;
		reached?: boolean;
		now?: () => number;
	} = {}
) {
	const configDir = path.join(h.base, 'config');
	if (o.captain) {
		mkdirSync(path.join(configDir, 'projects'), { recursive: true });
		writeFileSync(path.join(configDir, 'projects', 'web.yaml'), o.captain);
	}
	const consent = await ConsentStore.open(
		consentFileFor(path.join(h.base, 'state'), h.home),
		h.home
	);
	const reached = o.reached
		? await ReachedStore.open(reachedFileFor(path.join(h.base, 'state'), h.home), h.home)
		: null;
	const s = new PassageService({
		homeDir: h.home,
		firstmateDir: path.join(h.base, 'fm'),
		configDir,
		consent,
		reached,
		now: o.now,
		deps: { ...defaultDeps(), git, ...world(o) },
		ignore: ['unassigned']
	});
	await s.load('web');
	return { s, h, consent, reached };
}

/** One collector round: derive the passage, then let the scheduler run what it wanted. */
async function round(s: PassageService, f: StageFacts) {
	const p = s.stagesFor('web').passage(f);
	s.endRound(['web']);
	await flush();
	return p;
}

describe('PassageService', () => {
	it('behaves exactly like the built-ins when a project declares nothing', async () => {
		const { s } = await service('svc-none', null);
		for (const f of [
			landed(),
			landed({
				backlogState: 'in_flight',
				live: true,
				merged: false,
				crewState: 'working',
				crewSource: 'run-step'
			}),
			landed({ track: 'scout', backlogState: 'queued', merged: false })
		]) {
			expect(s.stagesFor('web').passage(f)).toEqual(defaultStageModel.passage(f));
		}
		expect(s.summary('web')).toEqual({ custom: false, problems: 0, needsConsent: false });
		const v = await s.view('web');
		expect(v.sources.map((x) => x.state)).toEqual(['absent', 'absent']);
		expect(v.passages.every((p) => !p.custom)).toBe(true);
	});

	it('adds Deployed from the project file, and runs its network checks only after consent', async () => {
		const calls: string[] = [];
		const { s } = await service('svc-web', WEB, { calls });
		let p = await round(s, landed());
		expect(p.steps.map((x) => x.key).at(-1)).toBe('deployed');
		expect(p.checks.find((c) => c.id === 'production')).toMatchObject({ state: 'off' });
		expect(p.steps.at(-1)!.note).toBe(
			'Off until you enable this project’s passage checks on its passage page.'
		);
		expect(calls).toEqual([]);
		expect(s.summary('web')).toMatchObject({ custom: true, needsConsent: true });

		const v = await s.view('web');
		expect(v.consent).toMatchObject({ needed: true, enabled: false, digest: digestOf(WEB) });
		expect(await s.setConsent('web', 'f'.repeat(64))).toMatchObject({ ok: false, status: 409 });
		expect(await s.setConsent('web', digestOf(WEB))).toEqual({ ok: true });

		p = await round(s, landed()); // looks up the merge commit
		p = await round(s, landed()); // runs the deployment and live-version checks
		p = await round(s, landed());
		expect(p.steps[p.current]).toMatchObject({ key: 'deployed', state: 'current', failed: false });
		expect(p.live).toBe(true);
		expect(p.link).toEqual({
			label: 'Open Production deployment',
			url: 'https://docs.example.dev'
		});
		expect(calls[0]).toBe('pr view https://github.com/acme/web/pull/7');
		expect(calls.some((c) => c.startsWith(`repos/acme/web/deployments?sha=${MERGE}`))).toBe(true);

		// A terminal result is cached: later rounds run nothing more.
		const before = calls.length;
		await round(s, landed());
		await round(s, landed());
		expect(calls.length).toBe(before);
		expect(s.summary('web')).toMatchObject({ needsConsent: false });
	});

	it('reaches Deployed on a deployment that was already replaced by a later one', async () => {
		const { s } = await service('svc-inactive', WEB, { deploy: 'inactive' });
		await s.setConsent('web', digestOf(WEB));
		await round(s, landed());
		await round(s, landed());
		const p = await round(s, landed());
		expect(p.steps[p.current]).toMatchObject({ key: 'deployed', state: 'current', failed: false });
		expect(p.checks.find((c) => c.id === 'production')).toMatchObject({ outcome: 'inactive' });
	});

	it('keeps a reached step after a restart, when its checks can no longer observe it', async () => {
		const first = await service('svc-restart', WEB, { reached: true });
		await first.s.setConsent('web', digestOf(WEB));
		await round(first.s, landed());
		await round(first.s, landed());
		let p = await round(first.s, landed());
		expect(p.steps[p.current].key).toBe('deployed');
		first.s.stop();
		const file = first.reached!.file;
		expect(JSON.parse(readFileSync(file, 'utf8')).tasks).toEqual([
			{ project: 'web', task: 'ship-docs', steps: ['deployed'], past: {} }
		]);

		// After the restart a newer commit is live, so live-commit reports mismatch.
		const again = await start(first.h, { reached: true, live: 'c'.repeat(40) });
		for (let i = 0; i < 3; i++) p = await round(again.s, landed());
		expect(p.checks.find((c) => c.id === 'live-commit')).toMatchObject({ outcome: 'mismatch' });
		expect(p.steps[p.current]).toMatchObject({ key: 'deployed', state: 'current' });
		expect(p.live).toBe(true);

		// Without the record the same restart falls back to Landed.
		const forgetful = await start(first.h, { live: 'c'.repeat(40) });
		for (let i = 0; i < 3; i++) p = await round(forgetful.s, landed());
		expect(p.steps[p.current].key).toBe('landed');
	});

	it('keeps a skipped step skipped once the task moves past it and its check stops', async () => {
		const captain = [
			'version: 1',
			'checks:',
			'  canary: { type: github.deployment, environment: Canary, ref: merge.commit }',
			'stages:',
			'  - id: soaked',
			'    label: Soaked',
			'    after: deployed',
			'    reached_when: hold.captain',
			'    skip_when: canary.absent',
			'    skip_note: No canary.',
			'  - id: wrapped',
			'    label: Wrapped',
			'    after: soaked',
			'    reached_when: report.present',
			''
		].join('\n');
		const first = await service('svc-past', WEB, { captain, reached: true });
		await first.s.setConsent('web', digestOf(WEB));
		let p = await round(first.s, landed());
		for (let i = 0; i < 3; i++) p = await round(first.s, landed());
		expect(p.steps.find((x) => x.key === 'soaked')).toMatchObject({ state: 'skipped' });
		const done = landed({ reportPresent: true });
		p = await round(first.s, done);
		expect(p.steps[p.current].key).toBe('wrapped');
		expect(p.steps.find((x) => x.key === 'soaked')).toMatchObject({
			state: 'skipped',
			note: 'No canary.'
		});
		first.s.stop();

		// After a restart canary is not wanted any more, so it has no result.
		const again = await start(first.h, { captain, reached: true });
		p = await round(again.s, done);
		expect(p.checks.find((c) => c.id === 'canary')?.outcome).toBeNull();
		expect(p.steps.find((x) => x.key === 'soaked')).toMatchObject({
			state: 'skipped',
			note: 'No canary.'
		});

		const forgetful = await start(first.h, { captain });
		p = await round(forgetful.s, done);
		expect(p.steps.find((x) => x.key === 'soaked')?.state).toBe('done');
	});

	it('does not freeze a step that sat below a failed later step that then recovered', async () => {
		const captain = [
			'version: 1',
			'checks:',
			'  staging: { type: github.deployment, environment: Staging, ref: merge.commit }',
			'stages:',
			'  - id: staged',
			'    label: Staged',
			'    after: landed',
			'    reached_when: hold.captain',
			'    skip_when: staging.absent',
			'    skip_note: No staging.',
			''
		].join('\n');
		let t = Date.now();
		const o: {
			captain: string;
			reached: boolean;
			now: () => number;
			deploy: string;
			staging: boolean;
		} = {
			captain,
			reached: true,
			now: () => t,
			deploy: 'failure',
			staging: false
		};
		const { s, reached } = await service('svc-recover', WEB, o);
		await s.setConsent('web', digestOf(WEB));
		let p = await round(s, landed());
		for (let i = 0; i < 4; i++) p = await round(s, landed());
		expect(p.steps.map((x) => x.key).slice(-3)).toEqual(['landed', 'staged', 'deployed']);
		expect(p.steps[p.current]).toMatchObject({ key: 'deployed', failed: true });
		expect(p.steps.find((x) => x.key === 'staged')?.state).toBe('skipped');
		expect(reached!.past('web', 'ship-docs')).toEqual({});

		// Production recovers and staging deploys, then production succeeds.
		o.deploy = 'in_progress';
		o.staging = true;
		t += 61_000;
		for (let i = 0; i < 4; i++) p = await round(s, landed());
		expect(p.steps[p.current].key).toBe('landed');
		o.deploy = 'success';
		t += 61_000;
		for (let i = 0; i < 4; i++) p = await round(s, landed());
		expect(p.steps[p.current].key).toBe('deployed');
		expect(p.steps.find((x) => x.key === 'staged')).toMatchObject({ state: 'done', note: null });
		expect(reached!.past('web', 'ship-docs')).toEqual({ staged: { skipped: false, note: null } });
	});

	it('keeps polling a step below a failed later step, so it is not settled from a stale result', async () => {
		const captain = [
			'version: 1',
			'checks:',
			'  staging: { type: github.deployment, environment: Staging, ref: merge.commit }',
			'stages:',
			'  - id: staged',
			'    label: Staged',
			'    after: landed',
			'    reached_when: hold.captain',
			'    skip_when: staging.absent',
			'    skip_note: No staging.',
			''
		].join('\n');
		let t = Date.now();
		const o: {
			captain: string;
			reached: boolean;
			now: () => number;
			deploy: string;
			staging: boolean;
		} = {
			captain,
			reached: true,
			now: () => t,
			deploy: 'failure',
			staging: false
		};
		const { s, reached } = await service('svc-stale', WEB, o);
		await s.setConsent('web', digestOf(WEB));
		let p = await round(s, landed());
		for (let i = 0; i < 4; i++) p = await round(s, landed());
		expect(p.steps[p.current]).toMatchObject({ key: 'deployed', failed: true });
		expect(p.checks.find((c) => c.id === 'staging')?.outcome).toBe('absent');

		// Staging deploys while production is still failed; production then goes straight to success.
		o.staging = true;
		t += 61_000;
		for (let i = 0; i < 4; i++) p = await round(s, landed());
		expect(p.steps[p.current]).toMatchObject({ key: 'deployed', failed: true });
		expect(p.checks.find((c) => c.id === 'staging')?.outcome).toBe('success');
		o.deploy = 'success';
		t += 61_000;
		for (let i = 0; i < 4; i++) p = await round(s, landed());
		expect(p.steps[p.current]).toMatchObject({ key: 'deployed', failed: false });
		expect(p.steps.find((x) => x.key === 'staged')).toMatchObject({ state: 'done', note: null });
		expect(reached!.past('web', 'ship-docs')).toEqual({ staged: { skipped: false, note: null } });
	});

	it('tolerates a missing or corrupt reached record, and bounds it', async () => {
		const dir = path.join(root, 'reached-store');
		mkdirSync(dir, { recursive: true });
		const file = path.join(dir, 'passage-reached.json');
		expect((await ReachedStore.open(file, '/h')).get('web', 't')).toEqual([]);
		writeFileSync(file, '{not json');
		const s = await ReachedStore.open(file, '/h', 2);
		expect(s.get('web', 't')).toEqual([]);
		await s.add('web', 'a', 'deployed');
		await s.add('web', 'b', 'deployed');
		await s.add('web', 'c', 'deployed');
		await s.add('web', 'c', 'released');
		const back = await ReachedStore.open(file, '/h', 2);
		expect(back.get('web', 'a')).toEqual([]);
		expect(back.get('web', 'b')).toEqual(['deployed']);
		expect(back.get('web', 'c')).toEqual(['deployed', 'released']);
		writeFileSync(
			file,
			JSON.stringify({
				schema: 'wheelhouse-passage-reached.v1',
				tasks: [{ project: 'web', task: 'x', steps: ['ok', 7, '../bad'] }, null, { task: 'y' }]
			})
		);
		expect((await ReachedStore.open(file, '/h')).get('web', 'x')).toEqual(['ok']);
		expect(MAX_REACHED_TASKS).toBeGreaterThan(0);
	});

	it('marks a failed deploy, without making it a "needs you" item', async () => {
		const { s } = await service('svc-fail', WEB, { deploy: 'failure' });
		await s.setConsent('web', digestOf(WEB));
		await round(s, landed());
		await round(s, landed());
		const p = await round(s, landed());
		expect(p.steps[p.current]).toMatchObject({ key: 'deployed', failed: true });
		expect(p.basis).toMatch(/^Deployed failed: /);
	});

	it('keeps a failed deploy failed while GitHub cannot be read, and says why', async () => {
		let t = Date.now();
		const o = { deploy: 'failure', now: () => t };
		const { s } = await service('svc-unknown', WEB, o);
		await s.setConsent('web', digestOf(WEB));
		await round(s, landed());
		await round(s, landed());
		let p = await round(s, landed());
		expect(p.steps[p.current]).toMatchObject({ key: 'deployed', failed: true });

		o.deploy = 'unreadable';
		t += 61_000;
		await round(s, landed());
		p = await round(s, landed());
		expect(p.checks.find((c) => c.id === 'production')).toMatchObject({
			state: 'unknown',
			outcome: 'failure',
			summary: 'GitHub answered 502.'
		});
		expect(p.steps[p.current]).toMatchObject({ key: 'deployed', failed: true });
		expect(p.steps[p.current].note).toBe("Can't tell: GitHub answered 502.");
	});

	it('runs checks that only a skip_when or a note refers to', async () => {
		const calls: string[] = [];
		const { s } = await service('svc-note', WEB, {
			calls,
			deploy: 'in_progress',
			captain: [
				'version: 1',
				'checks:',
				'  staging: { type: github.deployment, environment: Staging, ref: merge.commit }',
				'  canary: { type: github.deployment, environment: Canary, ref: merge.commit }',
				'stages:',
				'  - id: deployed',
				'    note: { when: staging.success, text: On staging. }',
				'  - id: soaked',
				'    label: Soaked',
				'    after: deployed',
				'    reached_when: report.present',
				'    skip_when: canary.absent',
				''
			].join('\n')
		});
		await s.setConsent('web', digestOf(WEB));
		await round(s, landed());
		await round(s, landed());
		await round(s, landed());
		expect(calls.some((c) => c.includes('environment=Staging'))).toBe(true);
		expect(calls.some((c) => c.includes('environment=Canary'))).toBe(true);
	});

	it('waits for the merge before checking anything that needs the merge commit', async () => {
		const calls: string[] = [];
		const { s } = await service('svc-wait', WEB, { calls });
		await s.setConsent('web', digestOf(WEB));
		const p = await round(
			s,
			landed({
				backlogState: 'in_flight',
				live: true,
				merged: false,
				prUrl: null,
				crewState: 'working',
				landedAt: null
			})
		);
		expect(p.checks.find((c) => c.id === 'production')).toMatchObject({
			state: 'waiting',
			summary: 'Waits for the merge.'
		});
		expect(calls).toEqual([]);
	});

	it('takes the merge from the pull request when the ledger has no merge record', async () => {
		const ledgerOff = landed({ merged: false });
		const open = await service('svc-pr-open', WEB, { prOpen: true });
		await open.s.setConsent('web', digestOf(WEB));
		await round(open.s, ledgerOff);
		let p = await round(open.s, ledgerOff);
		expect(p.checks.find((c) => c.id === 'production')).toMatchObject({
			state: 'waiting',
			summary: 'Waits for the merge.'
		});

		const calls: string[] = [];
		const { s } = await service('svc-pr-merged', WEB, { calls });
		await s.setConsent('web', digestOf(WEB));
		for (let i = 0; i < 4; i++) p = await round(s, ledgerOff);
		expect(calls).toContain('pr view ' + PR);
		expect(calls.some((c) => c.includes(`deployments?sha=${MERGE}`))).toBe(true);
		expect(p.steps[p.current].key).toBe('deployed');
	});

	it('does not check tasks that landed more than 30 days ago', async () => {
		const calls: string[] = [];
		const { s } = await service('svc-old', WEB, { calls });
		await s.setConsent('web', digestOf(WEB));
		const p = await round(s, landed({ landedAt: Date.now() - CHECK_HORIZON_MS - 1 }));
		expect(p.checks.find((c) => c.id === 'production')).toMatchObject({
			state: 'gave-up',
			summary: 'Not checked: it landed more than 30 days ago.'
		});
		expect(calls).toEqual([]);
	});

	it('stops checking after give_up_after, and says so', async () => {
		const { s } = await service('svc-giveup', WEB, { deploy: 'in_progress' });
		await s.setConsent('web', digestOf(WEB));
		const f = landed({ landedAt: Date.now() - 2 * 86_400_000 });
		await round(s, f);
		await round(s, f);
		const p = await round(s, f);
		expect(p.checks.find((c) => c.id === 'production')?.state).toBe('gave-up');
		expect(p.steps.find((x) => x.key === 'deployed')!.note).toBe(
			'Not reached within 24h; Wheelhouse stopped checking.'
		);
	});

	it('layers the captain config over the project file, and lists both on the panel', async () => {
		const { s } = await service('svc-captain', WEB, {
			captain: 'version: 1\nstages:\n  - id: deployed\n    label: Live\n'
		});
		const p = s.stagesFor('web').passage(landed());
		expect(p.steps.at(-1)).toMatchObject({ key: 'deployed', label: 'Live' });
		const v = await s.view('web');
		expect(v.sources.map((x) => [x.kind, x.state])).toEqual([
			['project', 'applied'],
			['captain', 'applied']
		]);
		const step = v.passages[0].steps.at(-1)!;
		expect(step).toMatchObject({
			id: 'deployed',
			origin: 'project',
			changedBy: ['captain'],
			label: 'Live'
		});
		expect(v.passages[0].checks.map((c) => [c.id, c.origin, c.enabled])).toEqual([
			['preview', 'project', false],
			['production', 'project', false],
			['live-commit', 'project', false]
		]);
	});

	it('shows validation errors honestly and falls back to the built-in passage', async () => {
		const { s } = await service('svc-bad', WEB.replace('production.success', 'production.succes'), {
			captain: 'version: 1\nchecks:\n  c: { type: command, argv: [x] }\n'
		});
		const p = s.stagesFor('web').passage(landed());
		expect(p).toEqual(defaultStageModel.passage(landed()));
		const v = await s.view('web');
		expect(v.sources.map((x) => [x.kind, x.state, x.errors])).toEqual([
			[
				'project',
				'invalid',
				[
					"deployed.reached_when: unknown reference 'production.succes' (production is a github.deployment check: success, failure, in_progress, inactive, absent)"
				]
			],
			['captain', 'invalid', ['checks.c.type: command checks are not supported yet']]
		]);
		expect(v.consent.needed).toBe(false);
		expect(s.summary('web')).toEqual({ custom: false, problems: 2, needsConsent: false });
	});

	it('asks for consent again when the project file changes', async () => {
		const { s, h } = await service('svc-reconsent', WEB);
		await s.setConsent('web', digestOf(WEB));
		expect((await s.view('web')).consent.enabled).toBe(true);
		const changed = WEB.replace('interval: 2m', 'interval: 3m');
		sh(h.work, 'checkout', '-q', 'main');
		writeFileSync(path.join(h.work, '.wheelhouse.yaml'), changed);
		sh(h.work, 'commit', '-qam', 'change');
		sh(h.work, 'push', '-q', 'origin', 'main');
		sh(h.clone, 'fetch', '-q', 'origin');
		await s.load('web');
		const v = await s.view('web');
		expect(v.consent).toMatchObject({ needed: true, enabled: false, digest: digestOf(changed) });
	});

	it('keeps consent across restarts in its own state file', async () => {
		const { h, consent } = await service('svc-persist', WEB);
		await consent.set('web', digestOf(WEB));
		const again = await ConsentStore.open(consent.file, h.home);
		expect(again.enabled('web', digestOf(WEB))).toBe(true);
		expect(again.enabled('web', digestOf('other'))).toBe(false);
		expect(consent.file.startsWith(path.join(h.base, 'state'))).toBe(true);
	});
});
