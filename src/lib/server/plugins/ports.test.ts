import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ServicePorts } from './ports';

let dir: string;
let base: number;
beforeAll(async () => {
	dir = mkdtempSync(path.join(tmpdir(), 'wh-ports-'));
	// A port the system says is free, as the start of a run of ports to hand out.
	base = await new Promise<number>((resolve) => {
		const s = createServer();
		s.listen(0, '127.0.0.1', () => {
			const port = (s.address() as { port: number }).port;
			s.close(() => resolve(port));
		});
	});
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const listen = (port: number) =>
	new Promise<Server>((resolve) => {
		const s = createServer();
		s.listen(port, '127.0.0.1', () => resolve(s));
	});

describe('ServicePorts', () => {
	it('keeps each service’s port, and frees it only when its project leaves the fleet', async () => {
		const file = path.join(dir, 'a', 'service-ports.json');
		const ports = new ServicePorts(file);
		const fleet = ['a', 'b'];
		expect(await ports.port('x/v/a', 'a', base, [], fleet)).toBe(base);
		// Another service wanting the same port gets the next free one; a port to avoid is skipped too.
		expect(await ports.port('x/v/b', 'b', base, [base + 1], fleet)).toBe(base + 2);
		expect(await ports.port('x/v/a', 'a', base + 100, [], fleet)).toBe(base);
		// Read back by a fresh start, from the store file.
		expect(JSON.parse(readFileSync(file, 'utf8')).ports['x/v/b']).toEqual({
			project: 'b',
			port: base + 2
		});
		expect(await new ServicePorts(file).port('x/v/b', 'b', base, [], fleet)).toBe(base + 2);
		// A port setting that now names a kept port moves the service off it.
		expect(await ports.port('x/v/b', 'b', base, [base + 2], fleet)).toBe(base + 1);
		// Once project a leaves, its port is free for another.
		expect(await ports.port('x/v/c', 'c', base, [], ['b', 'c'])).toBe(base);
	});

	it('never hands out a port something already listens on, but keeps a stored one', async () => {
		const ports = new ServicePorts(path.join(dir, 'busy.json'));
		const busy = await listen(base + 10);
		try {
			expect(await ports.port('x/v/a', 'a', base + 10, [], ['a', 'b'])).toBe(base + 11);
			// Its own service now listening on the stored port does not move it.
			const own = await listen(base + 11);
			expect(await ports.port('x/v/a', 'a', base + 10, [], ['a', 'b'])).toBe(base + 11);
			own.close();
			// Two services asking at once get different ports.
			const [b, c] = await Promise.all([
				ports.port('x/v/b', 'b', base + 10, [], ['a', 'b', 'c']),
				ports.port('x/v/c', 'c', base + 10, [], ['a', 'b', 'c'])
			]);
			expect(new Set([b, c, base + 10, base + 11]).size).toBe(4);
		} finally {
			busy.close();
		}
	});

	it('starts afresh from a file it cannot read', async () => {
		const file = path.join(dir, 'bad.json');
		writeFileSync(file, 'not json');
		expect(await new ServicePorts(file).port('x/v', null, base + 50, [], [])).toBe(base + 50);
	});
});
