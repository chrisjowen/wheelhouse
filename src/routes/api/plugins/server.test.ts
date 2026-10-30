import { beforeEach, describe, expect, it, vi } from 'vitest';

/** The plugin update and install routes, with the update service stood in. */

const COMMIT = 'a'.repeat(40);
const svc = vi.hoisted(() => ({
	calls: [] as unknown[][],
	inspected: { ok: true, preview: { id: 'links' } } as
		{ ok: true; preview: { id: string } } | { ok: false; error: string },
	changed: { ok: true, restarting: true } as
		{ ok: true; restarting: boolean } | { ok: false; error: string }
}));
vi.mock('$lib/server/upgrade/service', () => ({
	updateService: () => ({
		plugins: async () => ({ plugins: [] }),
		checkPlugins: async () => svc.calls.push(['check']),
		inspectInstall: async (...a: unknown[]) => (svc.calls.push(['inspect', ...a]), svc.inspected),
		inspectUpdate: async (...a: unknown[]) => (
			svc.calls.push(['inspect-update', ...a]),
			svc.inspected
		),
		installPlugin: async (o: unknown) => (svc.calls.push(['install', o]), svc.changed),
		updatePlugin: async (id: string, o: unknown) => (
			svc.calls.push(['update', id, o]),
			svc.changed
		),
		loadPlugin: async (id: string) => (svc.calls.push(['load', id]), svc.changed)
	})
}));

/** A plugin's page as the runtime gives it, and the changes asked of the plugins file. */
const rt = vi.hoisted(() => ({
	changes: [] as unknown[][],
	changed: { ok: true } as { ok: true } | { ok: false; error: string },
	view: {
		schema: 'wheelhouse-plugin.v1',
		plugin: {
			id: 'github-issues',
			settings: [
				{ key: 'labels', title: 'Labels', description: null, type: 'list', required: false },
				{ key: 'assignee', title: 'Assigned to', description: null, type: 'text', required: false },
				{
					key: 'mode',
					title: 'Mode',
					description: null,
					type: 'text',
					required: false,
					options: [
						{ value: 'list', label: 'Just list it' },
						{ value: 'bell', label: 'Ring' }
					]
				}
			]
		},
		enabled: null,
		on: false,
		projects: [{ id: 'lumen', name: 'lumen', enabled: null, defaultOn: false, on: false }],
		settings: [],
		configError: null
	}
}));
vi.mock('$lib/server/runtime', () => ({
	currentPluginPage: async (id: string) => (id === rt.view.plugin.id ? rt.view : null),
	changePluginConfig: async (id: string, c: unknown) => {
		rt.changes.push([id, c]);
		return rt.changed.ok ? { ok: true, view: rt.view } : rt.changed;
	}
}));

const updates = await import('./updates/+server');
const inspect = await import('./inspect/+server');
const install = await import('./install/+server');
const update = await import('./[plugin]/update/+server');
const config = await import('./[plugin]/config/+server');
const loadRoute = await import('./[plugin]/load/+server');

// Each route types its own event; the handlers only read params and request.
type Ev = never;
const post = (body: unknown, params: Record<string, string> = {}) =>
	({
		params,
		request: new Request('http://127.0.0.1:4310/', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: typeof body === 'string' ? body : JSON.stringify(body)
		})
	}) as unknown as Ev;

beforeEach(() => {
	svc.calls = [];
	svc.inspected = { ok: true, preview: { id: 'links' } };
	svc.changed = { ok: true, restarting: true };
	rt.changes = [];
	rt.changed = { ok: true };
});

describe('/api/plugins/updates', () => {
	it('GET answers with the last check; POST checks now', async () => {
		expect((await updates.GET({} as Ev)).status).toBe(200);
		expect(svc.calls).toEqual([]);
		expect((await updates.POST({} as Ev)).status).toBe(200);
		expect(svc.calls).toEqual([['check']]);
	});
});

describe('POST /api/plugins/inspect', () => {
	it('looks up a repository at an optional ref', async () => {
		const res = await inspect.POST(post({ repo: 'acme/links.git', ref: ' v1.0.0 ' }));
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ id: 'links' });
		expect(svc.calls).toEqual([['inspect', 'acme/links', 'v1.0.0']]);
	});

	it('looks up the update for an installed plugin', async () => {
		await inspect.POST(post({ id: 'links', ref: '' }));
		expect(svc.calls).toEqual([['inspect-update', 'links', null]]);
	});

	it.each([
		[{ repo: 'just-a-name' }, /org\/repo/],
		[{ repo: 'acme/links', ref: '--upload-pack=x' }, /not a tag, branch or commit/],
		[{ repo: '-x/links' }, /org\/repo/]
	])('refuses %j with 400', async (body, why) => {
		const res = await inspect.POST(post(body));
		expect(res.status).toBe(400);
		expect((await res.json()).message).toMatch(why);
		expect(svc.calls).toEqual([]);
	});

	it('answers 422 with why the repository is not a plugin', async () => {
		svc.inspected = { ok: false, error: 'it has no .wheelhouse-plugin/plugin.json' };
		const res = await inspect.POST(post({ repo: 'acme/links' }));
		expect(res.status).toBe(422);
		expect((await res.json()).message).toBe('It has no .wheelhouse-plugin/plugin.json.');
	});

	it('refuses a body that is not JSON', async () => {
		expect((await inspect.POST(post('nope'))).status).toBe(400);
	});
});

describe('POST /api/plugins/install', () => {
	it('installs the commit the look-up showed, with its settings', async () => {
		const res = await install.POST(
			post({ repo: 'acme/links', ref: null, commit: COMMIT, settings: { token: 'abc' } })
		);
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ ok: true, restarting: true });
		expect(svc.calls).toEqual([
			['install', { repo: 'acme/links', ref: null, commit: COMMIT, settings: { token: 'abc' } }]
		]);
	});

	it.each([
		[{ repo: 'acme/links' }, /look it up first/],
		[{ repo: 'acme/links', commit: 'abc' }, /look it up first/],
		[{ repo: 'acme/links', commit: COMMIT, settings: { 'bad key': 'x' } }, /not a setting key/],
		[{ repo: 'acme/links', commit: COMMIT, settings: { token: 1 } }, /must be text/],
		[{ repo: 'acme/links', commit: COMMIT, settings: ['x'] }, /object/]
	])('refuses %j with 400', async (body, why) => {
		const res = await install.POST(post(body));
		expect(res.status).toBe(400);
		expect((await res.json()).message).toMatch(why);
		expect(svc.calls).toEqual([]);
	});

	it('answers 409 with why it was not installed', async () => {
		svc.changed = {
			ok: false,
			error: 'acme/links is at bbbbbbb now, not aaaaaaa as when you looked; look it up again'
		};
		const res = await install.POST(post({ repo: 'acme/links', commit: COMMIT }));
		expect(res.status).toBe(409);
		expect((await res.json()).message).toMatch(/^Acme\/links is at .* look it up again\.$/);
	});
});

describe('POST /api/plugins/[plugin]/update', () => {
	it('updates the plugin to the commit the look-up showed, at a new ref', async () => {
		const res = await update.POST(
			post({ ref: 'v0.3.0', commit: COMMIT, settings: {} }, { plugin: 'links' })
		);
		expect(res.status).toBe(200);
		expect(svc.calls).toEqual([
			['update', 'links', { ref: 'v0.3.0', commit: COMMIT, settings: {} }]
		]);
	});

	it('refuses without the commit the look-up showed', async () => {
		const res = await update.POST(post({}, { plugin: 'links' }));
		expect(res.status).toBe(400);
	});
});

describe('POST /api/plugins/<id>/config', () => {
	const gi = { plugin: 'github-issues' };

	it('turns a plugin on or off for every project, or back to its default', async () => {
		for (const enabled of [true, false, null]) {
			const res = await config.POST(post({ enabled }, gi));
			expect(res.status).toBe(200);
			expect((await res.json()).schema).toBe('wheelhouse-plugin.v1');
		}
		expect(rt.changes).toEqual([
			['github-issues', { enabled: true }],
			['github-issues', { enabled: false }],
			['github-issues', { enabled: null }]
		]);
	});

	it('turns it on or off for one project it knows', async () => {
		expect((await config.POST(post({ project: 'lumen', enabled: true }, gi))).status).toBe(200);
		const res = await config.POST(post({ project: '../etc', enabled: true }, gi));
		expect(res.status).toBe(400);
		expect((await res.json()).message).toBe('Wheelhouse knows no such project.');
		expect(rt.changes).toEqual([['github-issues', { project: 'lumen', enabled: true }]]);
	});

	it('saves the settings it declares, read from the form’s answers', async () => {
		const res = await config.POST(
			post({ settings: { labels: 'bug, ready-for-pr', mode: '' } }, gi)
		);
		expect(res.status).toBe(200);
		expect(rt.changes).toEqual([
			['github-issues', { settings: { labels: ['bug', 'ready-for-pr'], mode: undefined } }]
		]);
	});

	it.each([
		[{ enabled: 'yes' }, /Say whether it is on/],
		[{ settings: { colour: 'red' } }, /^There is no setting "colour"\.$/],
		[{ settings: { mode: 'auto' } }, /Mode must be one of Just list it, Ring/],
		[{ settings: { labels: 5 } }, /must be text/],
		[
			{ settings: { assignee: '@octocat' } },
			/^"@octocat" is not a GitHub login: write a login without @/
		],
		[{ settings: { labels: `bug, ${'x'.repeat(51)}` } }, /is not a label GitHub issues can watch/]
	])('refuses %j with 400, changing nothing', async (body, why) => {
		const res = await config.POST(post(body, gi));
		expect(res.status).toBe(400);
		expect((await res.json()).message).toMatch(why);
		expect(rt.changes).toEqual([]);
	});

	it('saves a GitHub login or @me as the assignee, and empty for none', async () => {
		for (const assignee of ['octocat', '@me', '']) {
			expect((await config.POST(post({ settings: { assignee } }, gi))).status).toBe(200);
		}
		expect(rt.changes.map((c) => (c[1] as { settings: object }).settings)).toEqual([
			{ assignee: 'octocat' },
			{ assignee: '@me' },
			{ assignee: '' }
		]);
	});

	it('knows no other plugin, and says why a change was not saved', async () => {
		expect((await config.POST(post({ enabled: true }, { plugin: 'nope' }))).status).toBe(404);
		expect((await config.GET({ params: { plugin: 'nope' } } as Ev)).status).toBe(404);
		rt.changed = { ok: false, error: 'Wheelhouse could not save that.' };
		const res = await config.POST(post({ enabled: true }, gi));
		expect(res.status).toBe(409);
		expect((await res.json()).message).toBe('Wheelhouse could not save that.');
	});
});

describe('POST /api/plugins/<id>/load', () => {
	it('turns an installed plugin back on and restarts, or says why not', async () => {
		const res = await loadRoute.POST({ params: { plugin: 'docket' } } as Ev);
		expect(await res.json()).toEqual({ ok: true, restarting: true });
		expect(svc.calls).toEqual([['load', 'docket']]);
		svc.changed = { ok: false, error: 'docket is not installed' };
		const no = await loadRoute.POST({ params: { plugin: 'docket' } } as Ev);
		expect(no.status).toBe(409);
		expect((await no.json()).message).toBe('Docket is not installed.');
	});
});
