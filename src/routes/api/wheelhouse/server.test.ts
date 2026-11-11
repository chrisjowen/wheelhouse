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
		readSource: async () => 'published',
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
	it('sets source and answers with view', async () => {
		svc.calls = [];
		// simulate a request body by patching the handler to read from a plain object
		const res = await sourceMod.POST({
			request: { json: async () => ({ source: 'github' }) }
		} as any);
		expect(res.status).toBe(200);
		expect(svc.calls.some((c) => c.startsWith('set:'))).toBe(true);
	});

	it('answers 409 when setSource refuses', async () => {
		svc.set = { ok: false, error: 'busy' };
		const res = await sourceMod.POST({
			request: { json: async () => ({ source: 'published' }) }
		} as any);
		expect(res.status).toBe(409);
		expect((await res.json()).message).toBe('busy');
	});
});
