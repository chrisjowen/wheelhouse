import { beforeEach, describe, expect, it, vi } from 'vitest';

/** The Wheelhouse update routes, with the update service stood in. */

const svc = vi.hoisted(() => ({
	view: {
		schema: 'wheelhouse-self-update.v1',
		check: null,
		checking: false,
		job: null,
		source: 'published',
		installKind: 'npm',
		mismatch: false
	},
	start: { ok: true } as { ok: true } | { ok: false; error: string },
	set: { ok: true } as { ok: true } | { ok: false; error: string },
	calls: [] as string[]
}));
vi.mock('$lib/server/upgrade/service', () => ({
	updateService: () => ({
		wheelhouse: async () => svc.view,
		checkWheelhouseNow: async () => svc.calls.push('check'),
		startUpgrade: async () => (svc.calls.push('upgrade'), svc.start),
		setSource: async (s: string) => (svc.calls.push('set:' + s), svc.set)
	})
}));

const update = await import('./update/+server');
const upgrade = await import('./upgrade/+server');
const sourceMod = await import('./source/+server');
// Each route types its own event; these handlers read nothing from it.
const event = {} as never;

beforeEach(() => {
	svc.calls = [];
	svc.start = { ok: true };
	svc.set = { ok: true };
});

describe('/api/wheelhouse/update', () => {
	it('GET answers with the last check, uncached', async () => {
		const res = await update.GET(event);
		expect(res.status).toBe(200);
		expect(res.headers.get('cache-control')).toBe('no-store');
		expect(await res.json()).toEqual(svc.view);
		expect(svc.calls).toEqual([]);
	});

	it('POST checks now', async () => {
		const res = await update.POST(event);
		expect(res.status).toBe(200);
		expect(svc.calls).toEqual(['check']);
	});
});

describe('/api/wheelhouse/upgrade', () => {
	it('starts the upgrade and answers 202 with its state', async () => {
		const res = await upgrade.POST(event);
		expect(res.status).toBe(202);
		expect(svc.calls).toEqual(['upgrade']);
	});

	it('answers 409 with why when it cannot start', async () => {
		svc.start = { ok: false, error: 'Wait for the Wheelhouse upgrade to finish.' };
		const res = await upgrade.POST(event);
		expect(res.status).toBe(409);
		expect((await res.json()).message).toBe('Wait for the Wheelhouse upgrade to finish.');
	});
});

describe('/api/wheelhouse/source', () => {
	const post = (body: unknown) =>
		sourceMod.POST({ request: { json: async () => body } } as never) as Promise<Response>;

	it('switches to the source the body names and answers with the view', async () => {
		const res = await post({ source: 'github' });
		expect(res.status).toBe(200);
		expect(svc.calls).toEqual(['set:github']);
		expect(await res.json()).toEqual(svc.view);
	});

	it('answers 400 for a source that is neither published nor github, switching nothing', async () => {
		const res = await post({ source: 'npm' });
		expect(res.status).toBe(400);
		expect(svc.calls).toEqual([]);
	});

	it('answers 409 with the reason when the switch cannot start', async () => {
		svc.set = { ok: false, error: 'Wait for the Wheelhouse upgrade to finish.' };
		const res = await post({ source: 'published' });
		expect(res.status).toBe(409);
		expect((await res.json()).message).toBe('Wait for the Wheelhouse upgrade to finish.');
	});
});
