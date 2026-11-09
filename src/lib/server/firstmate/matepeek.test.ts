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

	const exit255 = (said: string) => ({
		peek: vi.fn(),
		remotePeek: vi.fn(async (): Promise<AdapterResult<PeekOutput>> => ({
			ok: false,
			observedAt: 'x',
			error: {
				kind: 'exit',
				script: 'fm-on.sh',
				message: `fm-on.sh exited with code 255${said ? `: ${said}` : ''}`,
				exitCode: 255
			}
		}))
	});

	it('reads a host ssh cannot connect to (exit 255) as offline, in ssh’s words, once', async () => {
		const adapter = exit255('ssh: connect to host tokyo-box port 22: Connection refused');
		const r = await new MatePeeks(adapter).look(mate(), 40);
		expect(r).toMatchObject({ available: false, offline: true });
		expect(r.reason).toBe(
			'Offline: could not connect to tokyo-box (ssh: connect to host tokyo-box port 22: Connection refused). Wheelhouse does not try again by itself.'
		);
		expect(adapter.remotePeek).toHaveBeenCalledTimes(1);
	});

	it('does not call a host offline when exit 255 says only that the end is unknown', async () => {
		const adapter = exit255('Timeout, server tokyo-box not responding.');
		const r = await new MatePeeks(adapter).look(mate(), 40);
		expect(r).toMatchObject({ available: false, offline: false });
		expect(r.reason).toContain('Could not complete the look on tokyo-box');
		expect(r.reason).toContain('Timeout, server tokyo-box not responding.');
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
