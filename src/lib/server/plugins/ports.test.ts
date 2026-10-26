import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ServicePorts } from './ports';

let dir: string;
beforeAll(() => (dir = mkdtempSync(path.join(tmpdir(), 'wh-ports-'))));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe('ServicePorts', () => {
	it('keeps each service’s port, and frees it only when its project leaves the fleet', () => {
		const file = path.join(dir, 'a', 'service-ports.json');
		const ports = new ServicePorts(file);
		const fleet = ['a', 'b'];
		expect(ports.port('x/v/a', 'a', 5000, [], fleet)).toBe(5000);
		// Another service wanting the same port gets the next free one; a port to avoid is skipped too.
		expect(ports.port('x/v/b', 'b', 5000, [5001], fleet)).toBe(5002);
		expect(ports.port('x/v/a', 'a', 6000, [], fleet)).toBe(5000);
		// Read back by a fresh start.
		expect(new ServicePorts(file).port('x/v/b', 'b', 5000, [], fleet)).toBe(5002);
		// A port setting that now names a kept port moves the service off it.
		expect(ports.port('x/v/b', 'b', 5000, [5002], fleet)).toBe(5001);
		// Once project a leaves, its port is free for another.
		expect(ports.port('x/v/c', 'c', 5000, [], ['b', 'c'])).toBe(5000);
	});

	it('starts afresh from a file it cannot read', () => {
		const file = path.join(dir, 'bad.json');
		writeFileSync(file, 'not json');
		expect(new ServicePorts(file).port('x/v', null, 5100, [], [])).toBe(5100);
	});
});
