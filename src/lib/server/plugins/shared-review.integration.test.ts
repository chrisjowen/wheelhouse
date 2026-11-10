import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import net from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * Shared review's commands as Firstmate and workers run them, each a real
 * process: a review server (`serve`, standing in for a deployed one, on
 * loopback), the desk pointed at it with the owner token in its environment,
 * and a stand-in dev server. A live app is started as a local preview, put
 * live, reached by a reviewer through the review server and the desk's
 * tunnel, and closed, its comments coming back as the bundle.
 */

const MAIN = path.resolve('plugins/shared-review/review/main.mjs');
const LIVE_APP = path.resolve('plugins/shared-review/demo/live-app.mjs');
const TOKEN = 'integration-owner-token-0123456789abcdef';
const run = promisify(execFile);

let root: string;
let state: string;
const children: ChildProcess[] = [];

async function freePort(): Promise<number> {
	const s = net.createServer();
	await new Promise<void>((r) => s.listen(0, '127.0.0.1', r));
	const port = (s.address() as net.AddressInfo).port;
	await new Promise((r) => s.close(r));
	return port;
}

/** Start a process and wait for a line of its output to match. */
function start(argv: string[], env: NodeJS.ProcessEnv, ready: RegExp): Promise<RegExpExecArray> {
	const child = spawn(process.execPath, argv, {
		env: { ...process.env, ...env },
		stdio: ['ignore', 'pipe', 'pipe']
	});
	children.push(child);
	let out = '';
	return new Promise((resolve, reject) => {
		const timer = setTimeout(
			() => reject(new Error(`no ready line from ${argv.join(' ')}:\n${out}`)),
			15_000
		);
		const on = (d: Buffer) => {
			out += d.toString();
			const m = ready.exec(out);
			if (m) {
				clearTimeout(timer);
				resolve(m);
			}
		};
		child.stdout!.on('data', on);
		child.stderr!.on('data', on);
		child.on('exit', (code) => reject(new Error(`${argv.join(' ')} exited ${code}:\n${out}`)));
	});
}

const cli = async (...args: string[]) => {
	const r = await run(process.execPath, [MAIN, ...args, '--state', state], {
		env: { ...process.env, FM_TASK_ID: '' }
	});
	return r.stdout;
};

let server: string;
let desk: string;
let app: string;

beforeAll(async () => {
	root = mkdtempSync(path.join(tmpdir(), 'wh-shared-review-int-'));
	state = path.join(root, 'desk');
	const port = await freePort();
	server = `http://127.0.0.1:${port}`;
	await start(
		[MAIN, 'serve'],
		{
			REVIEW_PUBLIC_URL: server,
			REVIEW_LISTEN: `127.0.0.1:${port}`,
			REVIEW_OWNER_TOKEN: TOKEN,
			REVIEW_DATA_DIR: path.join(root, 'server')
		},
		/listening on/
	);
	desk = (
		await start(
			[
				MAIN,
				'desk',
				'--port',
				'0',
				'--state',
				state,
				'--remote',
				server,
				'--token-env',
				'REVIEWS_OWNER'
			],
			{ REVIEWS_OWNER: TOKEN },
			/review desk at (http:\/\/127\.0\.0\.1:\d+)/
		)
	)[1];
	app = (await start([LIVE_APP], {}, /(http:\/\/127\.0\.0\.1:\d+\/)/))[1];
}, 60_000);

afterAll(() => {
	for (const c of children) c.kill('SIGKILL');
	rmSync(root, { recursive: true, force: true });
});

async function signIn(link: string, passcode: string, name: string) {
	const u = new URL(link);
	const r = await fetch(`${link}/signin`, {
		method: 'POST',
		redirect: 'manual',
		headers: { 'content-type': 'application/x-www-form-urlencoded', origin: u.origin },
		body: new URLSearchParams({ method: 'passcode', name, passcode })
	});
	expect(r.status).toBe(303);
	const cookie = r.headers
		.getSetCookie()
		.map((c) => c.split(';')[0])
		.join('; ');
	return (p: string, init: RequestInit = {}) =>
		fetch(new URL(p, u.origin), {
			...init,
			headers: { ...init.headers, cookie, origin: u.origin }
		});
}

describe('shared review, from the command line', () => {
	it('starts a live app as a local preview, puts it live, and closes it into a bundle', async () => {
		const started = JSON.parse(
			await cli('start', '--live', app, '--task', 'tides-1', '--title', 'Tide tables', '--json')
		);
		expect(started).toMatchObject({
			task: 'tides-1',
			where: 'local',
			state: 'open',
			source: { kind: 'live', url: app.replace(/\/$/, '') }
		});
		expect(started.link.startsWith(`${desk}/_review/`)).toBe(true);

		const local = await signIn(started.link, started.passcode, 'Ana');
		const rid = new URL(started.link).pathname.split('/')[2];
		await local(started.link);
		const page = await (await local('/')).text();
		expect(page).toContain('<h1>Tide tables</h1>');
		const posted = await local(`/_review/${rid}/api/comments`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({
				body: 'Show the date',
				anchor: { path: '/', selector: '#place', at: { x: 0.1, y: 0.5 }, label: 'the place' }
			})
		});
		expect(posted.status).toBe(201);

		const listed = JSON.parse(await cli('list', '--json'));
		expect(listed.remote).toMatchObject({ url: server, state: 'ready' });

		const live = JSON.parse(await cli('go-live', started.id, '--json'));
		expect(live).toMatchObject({
			where: 'remote',
			server,
			state: 'open',
			comments: [expect.objectContaining({ author: 'Ana', body: 'Show the date' })]
		});
		expect(live.link.startsWith(`${server}/_review/`)).toBe(true);
		expect((await fetch(started.link)).status).toBe(404);

		// A reviewer on the review server reaches the dev server through the desk's tunnel.
		const ben = await signIn(live.link, live.passcode, 'Ben');
		await ben(live.link);
		let api: { place?: string } = {};
		for (let i = 0; i < 40 && !api.place; i++) {
			const r = await ben('/api/tides');
			if (r.ok) api = await r.json();
			else await new Promise((res) => setTimeout(res, 250));
		}
		expect(api.place).toBe('Harbour mouth');
		const liveRid = new URL(live.link).pathname.split('/')[2];
		await ben(`/_review/${liveRid}/api/comments`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({
				body: 'Heights to one decimal',
				anchor: { path: '/', label: 'the “Height” heading' }
			})
		});

		const bundle = JSON.parse(await cli('close', started.id, '--json'));
		expect(bundle).toMatchObject({
			schema: 'shared-review-bundle.v1',
			review: { id: started.id, title: 'Tide tables', task: 'tides-1', where: 'remote' },
			people: [
				{ name: 'Ana', comments: 1 },
				{ name: 'Ben', comments: 1 }
			]
		});
		expect(bundle.comments.map((c: { body: string }) => c.body)).toEqual([
			'Show the date',
			'Heights to one decimal'
		]);
		expect((await fetch(live.link)).status).toBe(404);
		expect((await ben('/api/tides')).status).toBe(404);
		const after = JSON.parse(await cli('list', '--json'));
		expect(after.reviews[0]).toMatchObject({
			id: started.id,
			state: 'delivered',
			link: null,
			passcode: null
		});
		const file = path.join(state, 'bundles', `${started.id}.json`);
		expect(existsSync(file)).toBe(true);
		expect(JSON.parse(readFileSync(file, 'utf8')).comments).toHaveLength(2);
	}, 60_000);

	it('says what to do when the desk is not running', async () => {
		const r = await run(process.execPath, [
			MAIN,
			'list',
			'--state',
			path.join(root, 'nowhere')
		]).catch((e) => e);
		expect(r.code).toBe(2);
		expect(r.stderr).toContain('The review desk is not running');
		const status = JSON.parse(
			(
				await run(process.execPath, [
					MAIN,
					'status',
					'--json',
					'--state',
					path.join(root, 'nowhere')
				])
			).stdout
		);
		expect(status).toMatchObject({ desk: null, problem: 'not running' });
	});
});
