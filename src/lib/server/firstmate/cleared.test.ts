import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ClearedStore } from './cleared';

let dir: string;
let file: string;
beforeEach(() => {
	dir = mkdtempSync(path.join(tmpdir(), 'wh-cleared-'));
	file = path.join(dir, 'state', 'chat-cleared.json');
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('ClearedStore', () => {
	it('keeps when the view was cleared across a restart', async () => {
		const a = await ClearedStore.open(file, '/home/fm');
		expect(a.clearedAt()).toBeNull();
		await a.set(new Date('2026-11-20T10:00:00Z'));
		const b = await ClearedStore.open(file, '/home/fm');
		expect(b.clearedAt()).toBe('2026-11-20T10:00:00.000Z');
	});

	it('shows everything again once unset', async () => {
		const a = await ClearedStore.open(file, '/home/fm');
		await a.set(new Date('2026-11-20T10:00:00Z'));
		await a.set(null);
		expect((await ClearedStore.open(file, '/home/fm')).clearedAt()).toBeNull();
	});

	it('reads an unreadable or foreign file as never cleared', async () => {
		mkdirSync(path.dirname(file), { recursive: true });
		writeFileSync(file, '{not json');
		expect((await ClearedStore.open(file, '/home/fm')).clearedAt()).toBeNull();
		writeFileSync(file, JSON.stringify({ schema: 'other', clearedAt: '2026-11-20T10:00:00Z' }));
		expect((await ClearedStore.open(file, '/home/fm')).clearedAt()).toBeNull();
		writeFileSync(
			file,
			JSON.stringify({ schema: 'wheelhouse-chat-cleared.v1', clearedAt: 'yesterday-ish' })
		);
		expect((await ClearedStore.open(file, '/home/fm')).clearedAt()).toBeNull();
	});
});
