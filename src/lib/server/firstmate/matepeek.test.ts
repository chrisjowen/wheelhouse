import { describe, expect, it, vi } from 'vitest';
import type { AdapterResult, PeekOutput } from './adapter';
import { MatePeeks } from './matepeek';
import type { SecondMate } from '../../types';

const mate = (o: Partial<SecondMate> = {}): SecondMate =>
	({
		id: 'tokyo',
		where: 'remote',
		host: 'tokyo-box',
		peek: { available: true, reason: null },
		...o
	}) as SecondMate;

const ok = (lines: string[]): AdapterResult<PeekOutput> => ({
	ok: true,
	value: { lines, requested: lines.length },
	observedAt: '2026-10-11T05:41:00Z',
	durationMs: 5
});

describe('a look at a second mate', () => {
	it('reads a remote one on its host and a local one as a worker, each bounded', async () => {
		const adapter = {
			peek: vi.fn(async () => ok(['here'])),
			remotePeek: vi.fn(async () => ok(['there']))
		};
		const peeks = new MatePeeks(adapter);
		expect((await peeks.look(mate(), 500)).lines).toEqual(['there']);
		expect(adapter.remotePeek).toHaveBeenCalledWith('tokyo', 100);
		expect((await peeks.look(mate({ id: 'near', where: 'local' }), 500)).lines).toEqual(['here']);
		expect(adapter.peek).toHaveBeenCalledWith('near', 200);
	});

	it('reads an unreachable host (exit 255) as offline, without trying again', async () => {
		const adapter = {
			peek: vi.fn(),
			remotePeek: vi.fn(async (): Promise<AdapterResult<PeekOutput>> => ({
				ok: false,
				observedAt: 'x',
				error: { kind: 'exit', script: 'fm-on.sh', message: 'exited with code 255', exitCode: 255 }
			}))
		};
		const r = await new MatePeeks(adapter).look(mate(), 40);
		expect(r).toMatchObject({ available: false, offline: true });
		expect(r.reason).toContain('could not reach tokyo-box');
		expect(adapter.remotePeek).toHaveBeenCalledTimes(1);
	});

	it('shares one look between asks that come together, so clicks cannot stack calls', async () => {
		let release: (v: AdapterResult<PeekOutput>) => void = () => {};
		const adapter = {
			peek: vi.fn(),
			remotePeek: vi.fn(() => new Promise<AdapterResult<PeekOutput>>((r) => (release = r)))
		};
		let t = 0;
		const peeks = new MatePeeks(adapter, () => t);
		const a = peeks.look(mate(), 40);
		const b = peeks.look(mate(), 20);
		release(ok(['x']));
		expect(await a).toEqual(await b);
		t = 1_000;
		await peeks.look(mate(), 40);
		expect(adapter.remotePeek).toHaveBeenCalledTimes(1);
		t = 10_000;
		const c = peeks.look(mate(), 40);
		release(ok(['y']));
		expect((await c).lines).toEqual(['y']);
		expect(adapter.remotePeek).toHaveBeenCalledTimes(2);
	});

	it('runs nothing for a second mate whose terminal cannot be read', async () => {
		const adapter = { peek: vi.fn(), remotePeek: vi.fn() };
		const r = await new MatePeeks(adapter).look(
			mate({ where: 'local', peek: { available: false, reason: 'No terminal.' } }),
			40
		);
		expect(r).toMatchObject({ available: false, offline: false, reason: 'No terminal.' });
		expect(adapter.peek).not.toHaveBeenCalled();
	});
});
