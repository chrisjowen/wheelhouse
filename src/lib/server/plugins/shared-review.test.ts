/* eslint-disable @typescript-eslint/no-explicit-any -- the plugin and its desk are plain JavaScript, loaded by path */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { taskSummary } from '../../../../tests/helpers/task-summary';
import type { Project, TaskSummary } from '../../types';
import type { SlotEntry } from '../../plugins/types';
import { sendPluginFeedback } from './feedback';
import { loadBundledPlugins, type LoadedPlugins } from './loader';
import type { PluginConfig } from './config';
import { PluginRegistry } from './registry';

/**
 * The bundled Shared review plugin, loaded from `plugins/` as the server loads
 * it: its Reviews page and task section read the review desk through
 * `review/main.mjs status`, its desk service resolves to that same program on
 * loopback, and a closed review's comments reach Firstmate through
 * Wheelhouse's own feedback path as one note about the task.
 */

const PLUGIN = path.resolve('plugins/shared-review');
const BUNDLED = path.resolve('plugins');

let bundled: LoadedPlugins;
let root: string;
let worktree: string;
let state: string;
let Desk: any;
let server: any;
let desk: any;
const savedState = process.env.WH_REVIEW_STATE;

const fleet = { projects: [] as Project[], tasks: [] as TaskSummary[] };
let settings: Record<string, unknown> = {};
let enabled = true;

function registry() {
	return new PluginRegistry(
		[],
		{
			fleet: () => fleet,
			worktree: (id) => (id === 'wh-1' ? worktree : null),
			home: () => root,
			config: async () => ({
				config: {
					plugins: {
						'shared-review': { enabled, settings },
						'project-links': { enabled: false },
						vault: { enabled: false }
					}
				} as PluginConfig,
				error: null
			})
		},
		{ plugins: bundled.installed, problems: bundled.problems }
	);
}

const ours = (entries: SlotEntry[]) => entries.filter((e) => e.pluginId === 'shared-review');
const value = (e: SlotEntry | undefined) => (e?.content as { available: true; value: any }).value;

beforeAll(async () => {
	bundled = await loadBundledPlugins(BUNDLED);
	root = mkdtempSync(path.join(tmpdir(), 'wh-shared-review-plugin-'));
	worktree = path.join(root, 'worktree');
	mkdirSync(path.join(worktree, 'dist'), { recursive: true });
	state = path.join(root, 'state');
	process.env.WH_REVIEW_STATE = state;
	fleet.projects.push({
		id: 'lumen',
		name: 'Lumen',
		description: null,
		posture: null,
		registered: true,
		path: root,
		passage: null
	});
	fleet.tasks.push(
		taskSummary('wh-1', 'working', {
			title: 'lumen: Checkout page',
			shortTitle: 'Checkout page',
			preview: { url: 'http://127.0.0.1:5173/checkout', reportedAt: '2026-11-09T10:00:00Z' }
		}),
		taskSummary('wh-2', 'working', { title: 'lumen: No preview' })
	);
	Desk = (await import(pathToFileURL(path.join(PLUGIN, 'review/desk.mjs')).href)).Desk;
	server = await import(pathToFileURL(path.join(PLUGIN, 'wheelhouse/server/index.js')).href);
});

afterAll(async () => {
	await desk?.stop();
	rmSync(root, { recursive: true, force: true });
	if (savedState === undefined) delete process.env.WH_REVIEW_STATE;
	else process.env.WH_REVIEW_STATE = savedState;
});

describe('the bundled Shared review plugin', () => {
	it('loads as built in, off by default, with its page, task section, preview button, feedback and desk', () => {
		expect(bundled.problems).toEqual([]);
		const status = registry()
			.status()
			.find((p) => p.id === 'shared-review');
		expect(status).toMatchObject({
			state: 'loaded',
			source: 'builtin',
			enabledByDefault: false,
			slots: ['nav.page', 'task.section', 'preview.action'],
			capabilities: ['feedback'],
			hostRoutes: [],
			addressRewrites: []
		});
		expect(status!.settings.map((s) => s.key)).toEqual([
			'reviewServer',
			'ownerToken',
			'signIn',
			'invite',
			'reviewHost',
			'emailFrom',
			'smtpUrl'
		]);
	});

	it('shows nothing while it is off', async () => {
		enabled = false;
		try {
			const reg = registry();
			expect(ours((await reg.slots({ scope: 'fleet' })).entries)).toEqual([]);
			expect(ours((await reg.slots({ scope: 'task', taskId: 'wh-1' })).entries)).toEqual([]);
		} finally {
			enabled = true;
		}
	});

	it('offers to launch the desk, and a task section only where there is something to share', async () => {
		const reg = registry();
		const [page, share] = ours((await reg.slots({ scope: 'fleet' })).entries);
		// Share for review on every live preview, from the same value as the page.
		expect(share).toMatchObject({
			slot: 'preview.action',
			title: 'Share for review',
			render: { element: 'shared-review-share' }
		});
		expect(value(share)).toMatchObject({ desk: null, service: 'desk', reviews: [] });
		expect(page).toMatchObject({
			slot: 'nav.page',
			title: 'Reviews',
			render: { element: 'shared-review-page' }
		});
		expect(page.icon).toMatch(/^\/api\/plugins\/shared-review\/icon\/reviews\.svg/);
		expect(value(page)).toMatchObject({
			desk: null,
			deskProblem: null,
			service: 'desk',
			reviews: []
		});
		expect(value(page).cli).toBe(path.join(PLUGIN, 'review/main.mjs'));

		const [section] = ours((await reg.slots({ scope: 'task', taskId: 'wh-1' })).entries);
		expect(section).toMatchObject({
			slot: 'task.section',
			title: 'Shared review',
			render: { element: 'shared-review-task' }
		});
		expect(value(section).task).toEqual({
			id: 'wh-1',
			title: 'lumen: Checkout page',
			project: 'lumen',
			preview: 'http://127.0.0.1:5173/checkout',
			worktree
		});
		expect(ours((await reg.slots({ scope: 'task', taskId: 'wh-2' })).entries)).toEqual([]);
	});

	it('reads the running desk’s reviews, and hands its elements the desk’s address and key', async () => {
		desk = await new Desk({ dir: state, port: 0, log: () => {} }).start();
		writeFileSync(path.join(worktree, 'dist', 'index.html'), '<h1>Pricing</h1>');
		const r = await fetch(`${desk.url}/_review/desk/reviews`, {
			method: 'POST',
			headers: { 'x-review-desk-key': desk.key, 'content-type': 'application/json' },
			body: JSON.stringify({
				task: 'wh-2',
				title: 'Pricing',
				source: { kind: 'static', root: worktree, dir: 'dist' }
			})
		});
		expect(r.status).toBe(201);
		const reg = registry();
		const [page] = ours((await reg.slots({ scope: 'fleet' })).entries);
		expect(value(page).desk).toMatchObject({
			url: desk.url,
			key: desk.key,
			remote: { state: 'off' }
		});
		expect(value(page).reviews).toEqual([
			expect.objectContaining({ task: 'wh-2', title: 'Pricing', where: 'local', state: 'open' })
		]);
		expect(value(page).tasks).toEqual({ 'wh-2': 'lumen: No preview' });
		// Now that wh-2 has a review, its section shows, with that review only.
		const [section] = ours((await reg.slots({ scope: 'task', taskId: 'wh-2' })).entries);
		expect(value(section).reviews.map((x: any) => x.title)).toEqual(['Pricing']);
		const [other] = ours((await reg.slots({ scope: 'task', taskId: 'wh-1' })).entries);
		expect(value(other).reviews).toEqual([]);
	});

	it('resolves its desk to the review program on loopback, with the review server from its settings', async () => {
		settings = {};
		const plain = await registry().service('shared-review', 'desk', null);
		expect(plain?.resolution.available).toBe(true);
		const spec = (plain!.resolution as any).spec;
		expect(spec.argv).toEqual([
			process.execPath,
			path.join(PLUGIN, 'review/main.mjs'),
			'desk',
			'--port',
			'4317',
			'--state',
			state
		]);
		expect(spec).toMatchObject({
			url: 'http://127.0.0.1:4317/_review/',
			health: 'http://127.0.0.1:4317/_review/health',
			identity: { path: ['service'], value: 'wheelhouse-shared-review-desk' },
			binds: 'loopback'
		});
		settings = { reviewServer: 'https://review.example.com/', ownerToken: 'REVIEWS_TOKEN' };
		try {
			const remote = (await registry().service('shared-review', 'desk', null))!.resolution as any;
			// No vault grant here, so the desk starts without the token and says so itself.
			expect(remote.spec.argv.slice(2)).toEqual([
				'desk',
				'--port',
				'4317',
				'--state',
				state,
				'--remote',
				'https://review.example.com',
				'--token-env',
				'REVIEWS_TOKEN'
			]);
			expect(remote.hint).toContain('wh-vault run --only REVIEWS_TOKEN -- node');
		} finally {
			settings = {};
		}
	});

	it('sends a closed review’s comments to Firstmate as one note about the task', async () => {
		const sent: any[] = [];
		const reg = registry();
		const list = {
			subject: 'the shared review “Checkout” (2 comments from Ana and Ben)',
			items: [
				{
					text: 'Ana: Make the button bigger — Ben replied: Agreed',
					points: 'the “Pay now” button on /checkout (62% across, 40% down it)'
				}
			]
		};
		const r = await sendPluginFeedback(
			{
				sender: (p, t) => reg.feedbackSender(p, t),
				send: async (input) => (sent.push(input), { ok: true, created: true, message: {} as never })
			},
			'shared-review',
			'req-1',
			{ taskId: 'wh-1', ...list }
		);
		expect(r.ok).toBe(true);
		expect(sent).toHaveLength(1);
		expect(sent[0].taskId).toBe('wh-1');
		expect(sent[0].text).toBe(
			[
				'Feedback for wh-1 (Checkout page), sent together from the “Shared review” plugin (shared-review), about the shared review “Checkout” (2 comments from Ana and Ben):',
				'1. Ana: Make the button bigger — Ben replied: Agreed',
				'   Points at: the “Pay now” button on /checkout (62% across, 40% down it)',
				'',
				'Firstmate: pass these to this task’s worker, the same task (start no new one). You may add notes of your own, marked as yours.'
			].join('\n')
		);
	});
});

describe('its settings', () => {
	it('keep nothing of anyone’s own setup: the deploy commands use the settings, or placeholders', () => {
		const empty = server.deployCommands(server.readSettings({}));
		expect(empty.ssh).toContain(
			'REVIEW_SSH_HOST=deploy@review-host.example.com REVIEW_PUBLIC_URL=https://review.example.com'
		);
		expect(empty.ssh).toMatch(/^wh-vault run --only SHARED_REVIEW_OWNER_TOKEN -- env /);
		const set = server.readSettings({
			reviewServer: 'https://reviews.acme.test',
			reviewHost: 'ops@box.acme.test',
			signIn: 'both',
			emailFrom: 'Acme Reviews <reviews@acme.test>',
			ownerToken: 'ACME_OWNER',
			smtpUrl: 'ACME_SMTP'
		});
		expect(set.problems).toEqual([]);
		expect(server.deployCommands(set).ssh).toBe(
			`wh-vault run --only ACME_OWNER,ACME_SMTP -- env REVIEW_SSH_HOST=ops@box.acme.test REVIEW_PUBLIC_URL=https://reviews.acme.test REVIEW_OWNER_TOKEN_NAME=ACME_OWNER REVIEW_EMAIL_FROM='Acme Reviews <reviews@acme.test>' REVIEW_SMTP_URL_NAME=ACME_SMTP ${path.join(PLUGIN, 'deploy/ssh-deploy.sh')}`
		);
	});

	it('refuse a review server reached without TLS, and names that are not vault names', () => {
		expect(server.readSettings({ reviewServer: 'http://review.example.com' })).toMatchObject({
			reviewServer: null,
			problems: ['The review server address must use https, so sign-ins are not sent in the clear.']
		});
		expect(server.readSettings({ reviewServer: 'http://127.0.0.1:8080' }).reviewServer).toBe(
			'http://127.0.0.1:8080'
		);
		expect(server.readSettings({ ownerToken: 'not a name; rm -rf' })).toMatchObject({
			ownerToken: 'SHARED_REVIEW_OWNER_TOKEN',
			problems: ['not a name; rm -rf is not a wh-vault name (letters, digits and underscores).']
		});
	});

	it('fill in no review server or reviewer email sender when none is set', async () => {
		expect(server.readSettings({})).toMatchObject({
			reviewServer: null,
			reviewHost: null,
			emailFrom: null,
			problems: []
		});
		const lone = new Desk({ dir: mkdtempSync(path.join(root, 'no-remote-')), log: () => {} });
		expect(await lone.remote(true)).toMatchObject({ url: null, state: 'off', signIn: [] });
	});
});
