import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
	defaultDeps,
	getBounded,
	pointer,
	readTaskRefs,
	repoOfPr,
	repoOfRemote,
	runCheck,
	statusNote,
	tagMatches,
	type CheckContext,
	type CheckDeps
} from './checks';
import type { RunResult } from '../firstmate/exec';
import type { CheckSpec } from './schema';

const MERGE = 'a'.repeat(40);
const HEAD = 'b'.repeat(40);
const NOW = Date.parse('2026-10-11T12:00:00Z');

const ok = (stdout: unknown): RunResult => ({
	ok: true,
	stdout: typeof stdout === 'string' ? stdout : JSON.stringify(stdout),
	stderr: '',
	durationMs: 1
});
const fail = (stderr: string, kind: 'exit' | 'spawn-error' | 'timeout' = 'exit'): RunResult => ({
	ok: false,
	kind,
	code: kind === 'exit' ? 1 : null,
	signal: null,
	stdout: '',
	stderr,
	message: 'failed',
	durationMs: 1
});

/** gh answers by the API path (the argument after the Accept header). */
function ghFrom(routes: Record<string, RunResult>, calls: string[][] = []) {
	return async (args: string[]) => {
		calls.push(args);
		const pathArg = args[0] === 'api' ? args[3] : args.join(' ');
		const hit = Object.keys(routes).find((k) => pathArg.startsWith(k));
		return hit ? routes[hit] : fail('HTTP 404: Not Found');
	};
}

function fetchFrom(routes: Record<string, () => Response>, calls: string[] = []): typeof fetch {
	return (async (input: string | URL | Request) => {
		const url = String(input);
		calls.push(url);
		const r = routes[url];
		if (!r) throw new TypeError('fetch failed');
		return r();
	}) as typeof fetch;
}

function deps(o: Partial<CheckDeps> = {}): CheckDeps {
	return {
		gh: ghFrom({}),
		git: async () => fail('no git here'),
		fetch: fetchFrom({}),
		env: {},
		now: () => NOW,
		npmRegistry: 'https://registry.test',
		...o
	};
}

const ctx = (o: Partial<CheckContext> = {}): CheckContext => ({
	taskId: 'fix-login',
	refs: { mergeCommit: MERGE, prHead: HEAD },
	repo: 'acme/web',
	clone: null,
	firstmateRoot: '/fm',
	releaseTag: null,
	...o
});

const run = (spec: CheckSpec, d: CheckDeps, c: CheckContext = ctx()) => runCheck(spec, c, d);

describe('github.deployment', () => {
	const spec: CheckSpec = {
		type: 'github.deployment',
		environment: 'Production',
		ref: 'merge.commit'
	};
	const list = `repos/acme/web/deployments?sha=${MERGE}&environment=Production`;

	it('reports success with the live URL, as a terminal result', async () => {
		const calls: string[][] = [];
		const r = await run(
			spec,
			deps({
				gh: ghFrom(
					{
						[list]: ok([{ id: 7 }]),
						'repos/acme/web/deployments/7/statuses': ok({
							state: 'success',
							environment_url: 'https://docs.example.dev',
							target_url: 'https://vercel.com/logs'
						})
					},
					calls
				)
			})
		);
		expect(r).toMatchObject({
			outcome: 'success',
			outcomes: ['success'],
			url: 'https://docs.example.dev',
			terminal: true,
			summary: 'Production deployment of aaaaaaa succeeded.'
		});
		// The commit is Wheelhouse's own validated value, passed as one argument; gh is called with argv only.
		expect(calls[0]).toEqual([
			'api',
			'-H',
			'Accept: application/vnd.github+json',
			`${list}&per_page=5`,
			'--jq',
			'[.[] | {id}]'
		]);
	});

	it('maps failure, pending and absent', async () => {
		const status = (state: string | null) =>
			run(
				spec,
				deps({
					gh: ghFrom({
						[list]: ok([{ id: 7 }]),
						'repos/acme/web/deployments/7/statuses': ok(state === null ? 'null' : { state })
					})
				})
			);
		expect((await status('failure')).outcome).toBe('failure');
		expect((await status('error')).outcome).toBe('failure');
		expect((await status('queued')).outcome).toBe('in_progress');
		expect((await status(null)).outcome).toBe('in_progress');
		expect((await status('inactive')).outcome).toBe('inactive');
		expect((await status('failure')).terminal).toBe(false);
		const none = await run(spec, deps({ gh: ghFrom({ [list]: ok([]) }) }));
		expect(none).toMatchObject({
			outcome: 'absent',
			summary: 'No Production deployment for aaaaaaa yet.'
		});
	});

	it('is unknown, never "absent", when GitHub cannot be read', async () => {
		const r = await run(spec, deps({ gh: ghFrom({ [list]: fail('HTTP 502: Bad Gateway') }) }));
		expect(r).toMatchObject({ outcome: null, outcomes: [], summary: 'GitHub answered 502.' });
		const missing = await run(spec, deps({ gh: async () => fail('', 'spawn-error') }));
		expect(missing.summary).toBe('The GitHub CLI (gh) is not installed.');
	});

	it('is unknown until the commit it needs is known', async () => {
		const r = await run(spec, deps(), ctx({ refs: { mergeCommit: null, prHead: HEAD } }));
		expect(r).toMatchObject({ outcome: null, summary: 'The merge commit is not known.' });
		const bad = await run(
			spec,
			deps(),
			ctx({ refs: { mergeCommit: 'main; rm -rf /', prHead: null } })
		);
		expect(bad.outcome).toBeNull();
	});

	it('uses the check’s own repo when it names one', async () => {
		const calls: string[][] = [];
		await run({ ...spec, repo: 'acme/site' }, deps({ gh: ghFrom({}, calls) }));
		expect(calls[0][3]).toMatch(/^repos\/acme\/site\/deployments/);
		const none = await run(spec, deps(), ctx({ repo: null }));
		expect(none.summary).toBe('The GitHub repository is not known (set repo: owner/name).');
	});
});

describe('github.workflow', () => {
	const spec: CheckSpec = {
		type: 'github.workflow',
		workflow: 'deploy.yml',
		ref: 'merge.commit',
		event: 'push'
	};
	const runs = `repos/acme/web/actions/workflows/deploy.yml/runs?head_sha=${MERGE}&per_page=1&event=push`;
	const with_ = (v: unknown) => run(spec, deps({ gh: ghFrom({ [runs]: ok(v) }) }));

	it('maps a run to success, failure, in progress or absent', async () => {
		expect(
			await with_({
				status: 'completed',
				conclusion: 'success',
				html_url: 'https://github.com/acme/web/actions/runs/1'
			})
		).toMatchObject({
			outcome: 'success',
			terminal: true,
			url: 'https://github.com/acme/web/actions/runs/1'
		});
		expect((await with_({ status: 'completed', conclusion: 'failure' })).outcome).toBe('failure');
		expect((await with_({ status: 'completed', conclusion: 'cancelled' })).summary).toBe(
			'The deploy.yml workflow ended cancelled for aaaaaaa.'
		);
		expect((await with_({ status: 'in_progress', conclusion: null })).outcome).toBe('in_progress');
		expect((await with_(null)).outcome).toBe('absent');
	});
});

describe('github.release', () => {
	const spec: CheckSpec = { type: 'github.release', contains: 'merge.commit', tag_pattern: 'v*' };
	const releases = ok([
		{ tag: 'v1.3.0', url: 'https://github.com/acme/web/releases/tag/v1.3.0', draft: false },
		{ tag: 'v1.3.0-draft', url: 'x', draft: true },
		{ tag: 'nightly', url: 'x', draft: false },
		{ tag: 'v1.2.0', url: 'https://github.com/acme/web/releases/tag/v1.2.0', draft: false },
		{ tag: 'v1.1.0', url: 'https://github.com/acme/web/releases/tag/v1.1.0', draft: false }
	]);
	const compare = (tag: string, status: string) => ({
		[`repos/acme/web/compare/${MERGE}...${tag}`]: ok(JSON.stringify(status))
	});

	it('finds the earliest release that contains the commit', async () => {
		const r = await run(
			spec,
			deps({
				gh: ghFrom({
					'repos/acme/web/releases': releases,
					...compare('v1.3.0', 'ahead'),
					...compare('v1.2.0', 'identical'),
					...compare('v1.1.0', 'behind')
				})
			})
		);
		expect(r).toMatchObject({
			outcome: 'included',
			fields: { tag: 'v1.2.0' },
			url: 'https://github.com/acme/web/releases/tag/v1.2.0',
			terminal: true
		});
	});

	it('says not yet when the newest matching release does not contain it', async () => {
		const r = await run(
			spec,
			deps({
				gh: ghFrom({ 'repos/acme/web/releases': releases, ...compare('v1.3.0', 'diverged') })
			})
		);
		expect(r).toMatchObject({
			outcome: 'not_yet',
			summary: 'aaaaaaa is not in a release yet (latest: v1.3.0).'
		});
		const none = await run(spec, deps({ gh: ghFrom({ 'repos/acme/web/releases': ok([]) }) }));
		expect(none).toMatchObject({ outcome: 'not_yet', summary: 'No release matching v* yet.' });
	});

	it('matches tag patterns with * only', () => {
		expect(tagMatches('v*', 'v1.2.0')).toBe(true);
		expect(tagMatches('v*', 'release-1')).toBe(false);
		expect(tagMatches('docket@*', 'docket@0.4.0')).toBe(true);
		expect(tagMatches('v1.2', 'v1x2')).toBe(false);
		expect(tagMatches(undefined, 'anything')).toBe(true);
	});
});

describe('npm.published', () => {
	const spec: CheckSpec = {
		type: 'npm.published',
		package: '@chrisjowen/docket',
		version_from: 'release'
	};
	const reg = 'https://registry.test';
	const json =
		(v: unknown, status = 200) =>
		() =>
			new Response(JSON.stringify(v), { status });

	it('reports published and latest from the registry, for the release’s version', async () => {
		const calls: string[] = [];
		const r = await run(
			spec,
			deps({
				fetch: fetchFrom(
					{
						[`${reg}/@chrisjowen%2fdocket/0.5.0`]: json({ version: '0.5.0' }),
						[`${reg}/-/package/@chrisjowen%2fdocket/dist-tags`]: json({ latest: '0.5.0' })
					},
					calls
				)
			}),
			ctx({ releaseTag: 'v0.5.0' })
		);
		expect(r).toMatchObject({
			outcome: 'published',
			outcomes: ['published', 'latest'],
			terminal: true,
			url: 'https://www.npmjs.com/package/@chrisjowen/docket/v/0.5.0',
			summary: '@chrisjowen/docket@0.5.0 is on npm as latest.'
		});
		expect(calls).toHaveLength(2);
	});

	it('is published but not latest while another version is latest', async () => {
		const r = await run(
			spec,
			deps({
				fetch: fetchFrom({
					[`${reg}/@chrisjowen%2fdocket/0.5.0`]: json({}),
					[`${reg}/-/package/@chrisjowen%2fdocket/dist-tags`]: json({ latest: '0.4.0' })
				})
			}),
			ctx({ releaseTag: 'v0.5.0' })
		);
		expect(r).toMatchObject({
			outcomes: ['published'],
			terminal: false,
			summary: '@chrisjowen/docket@0.5.0 is on npm (latest is 0.4.0).'
		});
	});

	it('is absent on a 404, and unknown without a release version', async () => {
		const r = await run(
			spec,
			deps({ fetch: fetchFrom({ [`${reg}/@chrisjowen%2fdocket/0.5.0`]: json({}, 404) }) }),
			ctx({ releaseTag: 'v0.5.0' })
		);
		expect(r.outcome).toBe('absent');
		expect((await run(spec, deps())).summary).toBe(
			'The version is not known until release finds a release.'
		);
		expect((await run(spec, deps(), ctx({ releaseTag: 'nightly' }))).summary).toBe(
			'Release tag nightly is not a version.'
		);
	});
});

describe('http', () => {
	const url = 'https://docs.example.dev/api/version';
	const spec: CheckSpec = {
		type: 'http',
		url,
		expect: { status: 200, json_pointer: '/build/commit', equals: 'merge.commit' }
	};
	const body =
		(v: unknown, status = 200, headers: Record<string, string> = {}) =>
		() =>
			new Response(typeof v === 'string' ? v : JSON.stringify(v), { status, headers });

	it('compares a JSON value with the merge commit (full or abbreviated)', async () => {
		const full = await run(
			spec,
			deps({ fetch: fetchFrom({ [url]: body({ build: { commit: MERGE } }) }) })
		);
		expect(full).toMatchObject({ outcome: 'ok', terminal: true });
		const shortSha = await run(
			spec,
			deps({ fetch: fetchFrom({ [url]: body({ build: { commit: 'aaaaaaa' } }) }) })
		);
		expect(shortSha.outcome).toBe('ok');
		const other = await run(
			spec,
			deps({ fetch: fetchFrom({ [url]: body({ build: { commit: 'c'.repeat(40) } }) }) })
		);
		expect(other).toMatchObject({ outcome: 'mismatch', terminal: false });
		const missing = await run(spec, deps({ fetch: fetchFrom({ [url]: body({}) }) }));
		expect(missing).toMatchObject({
			outcome: 'mismatch',
			summary: 'docs.example.dev has no /build/commit.'
		});
	});

	it('reports an unexpected status as error, and a network failure as unknown', async () => {
		expect(
			(await run(spec, deps({ fetch: fetchFrom({ [url]: body('down', 503) }) }))).outcome
		).toBe('error');
		const down = await run(spec, deps());
		expect(down).toMatchObject({
			outcome: null,
			summary: 'docs.example.dev could not be reached.'
		});
		const notJson = await run(spec, deps({ fetch: fetchFrom({ [url]: body('<html>') }) }));
		expect(notJson).toMatchObject({
			outcome: null,
			summary: 'docs.example.dev did not answer with JSON.'
		});
	});

	it('follows at most three http(s) redirects and never another scheme', async () => {
		const hop = (to: string) => () =>
			new Response(null, { status: 302, headers: { location: to } });
		const r = await run(
			{ type: 'http', url },
			deps({ fetch: fetchFrom({ [url]: hop('/v2'), 'https://docs.example.dev/v2': body('ok') }) })
		);
		expect(r.outcome).toBe('ok');
		const loop = await run({ type: 'http', url }, deps({ fetch: fetchFrom({ [url]: hop(url) }) }));
		expect(loop.summary).toBe('More than 3 redirects.');
		const file = await run(
			{ type: 'http', url },
			deps({ fetch: fetchFrom({ [url]: hop('file:///etc/passwd') }) })
		);
		expect(file.summary).toBe('Only http(s) URLs are checked.');
	});

	it('caps the body it reads', async () => {
		const big = await run(spec, deps({ fetch: fetchFrom({ [url]: body('x'.repeat(70 * 1024)) }) }));
		expect(big.summary).toBe('The response is larger than 64 KiB.');
	});

	it('sends credentials only from named environment variables', async () => {
		let sent: Headers | null = null;
		const f = (async (_u: unknown, init?: RequestInit) => {
			sent = new Headers(init?.headers);
			return new Response('{}');
		}) as typeof fetch;
		const h: CheckSpec = { type: 'http', url, headers_from_env: { Authorization: 'STATUS_TOKEN' } };
		expect((await run(h, deps({ fetch: f, env: {} }))).summary).toBe(
			'The environment variable STATUS_TOKEN is not set.'
		);
		await run(h, deps({ fetch: f, env: { STATUS_TOKEN: 'Bearer s3cret' } }));
		expect(sent!.get('authorization')).toBe('Bearer s3cret');
	});

	it('reads RFC 6901 JSON pointers', () => {
		const doc = { a: { 'b/c': [1, { '~d': 'x' }] } };
		expect(pointer(doc, '/a/b~1c/1/~0d')).toEqual({ found: true, value: 'x' });
		expect(pointer(doc, '/a/missing')).toEqual({ found: false, value: undefined });
		expect(pointer(doc, '/a/b~1c/9')).toEqual({ found: false, value: undefined });
	});

	it('times out', async () => {
		const slow = (async (_u: unknown, init?: RequestInit) =>
			new Promise((_, reject) => {
				init?.signal?.addEventListener('abort', () =>
					reject(Object.assign(new Error('timeout'), { name: 'TimeoutError' }))
				);
			})) as typeof fetch;
		const d = deps({ fetch: slow, httpTimeoutMs: 50 });
		const p = getBounded(d, url, 'GET', {}).catch((e: Error) => e.message);
		expect(await p).toBe('docs.example.dev did not answer within 0.05 s');
	});
});

describe('git.contains', () => {
	const dir = mkdtempSync(path.join(tmpdir(), 'wh-git-'));
	const git = (...a: string[]) =>
		execFileSync('git', ['-C', dir, ...a], { encoding: 'utf8' }).trim();
	git('init', '-q', '-b', 'main');
	git('config', 'user.email', 't@example.com');
	git('config', 'user.name', 'T');
	writeFileSync(path.join(dir, 'a'), '1');
	git('add', 'a');
	git('commit', '-qm', 'one');
	const first = git('rev-parse', 'HEAD');
	git('checkout', '-qb', 'side');
	writeFileSync(path.join(dir, 'b'), '2');
	git('add', 'b');
	git('commit', '-qm', 'two');
	const second = git('rev-parse', 'HEAD');
	git('checkout', '-q', 'main');
	afterAll(() => rmSync(dir, { recursive: true, force: true }));

	const spec: CheckSpec = { type: 'git.contains', repo: 'firstmate-root', commit: 'merge.commit' };
	const real = defaultDeps({ PATH: process.env.PATH, HOME: process.env.HOME });
	const at = (sha: string, o: Partial<CheckSpec> = {}) =>
		runCheck(
			{ ...spec, ...o } as CheckSpec,
			ctx({ firstmateRoot: dir, refs: { mergeCommit: sha, prHead: null } }),
			real
		);

	it('answers yes when the ref contains the commit, and no when it does not', async () => {
		expect(await at(first)).toMatchObject({ outcome: 'yes', terminal: true });
		expect(await at(second)).toMatchObject({ outcome: 'no', terminal: false });
		expect(await at(second, { ref: 'side' })).toMatchObject({ outcome: 'yes' });
	});

	it('answers no for a commit this checkout has not fetched yet', async () => {
		expect((await at('d'.repeat(40))).outcome).toBe('no');
	});

	it('is unknown for a missing ref or a missing clone', async () => {
		expect((await at(first, { ref: 'nope' })).outcome).toBeNull();
		const r = await runCheck({ ...spec, repo: 'project-clone' }, ctx({ clone: null }), real);
		expect(r.summary).toBe('This project has no Firstmate clone.');
	});
});

describe('status.note and pull request lookups', () => {
	it('reports the preview a worker announced', () => {
		expect(
			statusNote({ url: 'https://p.example.dev', at: '2026-10-11T10:00:00Z' }, NOW)
		).toMatchObject({
			outcome: 'present',
			url: 'https://p.example.dev'
		});
		expect(statusNote(null, NOW).outcome).toBe('absent');
	});

	it('reads a PR’s head and merge commits', async () => {
		const d = deps({
			gh: async (args) =>
				args[0] === 'pr'
					? ok({ headRefOid: HEAD, mergeCommit: { oid: MERGE }, state: 'MERGED' })
					: fail('')
		});
		expect(await readTaskRefs('https://github.com/acme/web/pull/7', d)).toEqual({
			refs: { prHead: HEAD, mergeCommit: MERGE },
			merged: true,
			problem: null
		});
		expect((await readTaskRefs('https://gitlab.com/acme/web/-/merge_requests/7', d)).problem).toBe(
			'the pull request is not on GitHub'
		);
	});

	it('finds the GitHub repository of a PR or a remote', () => {
		expect(repoOfPr('https://github.com/acme/web/pull/12')).toBe('acme/web');
		expect(repoOfPr('https://example.com/acme/web/pull/12')).toBeNull();
		expect(repoOfRemote('git@github.com:acme/web.git')).toBe('acme/web');
		expect(repoOfRemote('https://github.com/chrisjowen/wheelhouse.git\n')).toBe(
			'chrisjowen/wheelhouse'
		);
		expect(repoOfRemote('https://gitlab.com/a/b')).toBeNull();
	});
});
