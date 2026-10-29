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
		updatePlugin: async (id: string, o: unknown) => (svc.calls.push(['update', id, o]), svc.changed)
	})
}));

const updates = await import('./updates/+server');
const inspect = await import('./inspect/+server');
const install = await import('./install/+server');
const update = await import('./[plugin]/update/+server');

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
