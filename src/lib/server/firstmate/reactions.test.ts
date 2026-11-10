import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ReactionStore } from './reactions';

let dir: string;
let file: string;
beforeEach(() => {
	dir = mkdtempSync(path.join(tmpdir(), 'wh-reactions-'));
	file = path.join(dir, 'state', 'chat-reactions.json');
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('ReactionStore', () => {
	it('keeps marks across a restart, and forgets a taken-back one', async () => {
		const a = await ReactionStore.open(file, '/home/fm');
		await a.set('a1-t', true);
		await a.set('b2-t', true);
		await a.set('a1-t', false);
		const b = await ReactionStore.open(file, '/home/fm');
		expect(b.list()).toEqual(['b2-t']);
	});

	it('marks a message once however often it is marked', async () => {
		const s = await ReactionStore.open(file, '/home/fm');
		await s.set('a1-t', true);
		await s.set('a1-t', true);
		expect(s.list()).toEqual(['a1-t']);
	});

	it('forgets the oldest marks past its bound', async () => {
		const s = await ReactionStore.open(file, '/home/fm', 2);
		for (const id of ['m1', 'm2', 'm3']) await s.set(id, true);
		expect((await ReactionStore.open(file, '/home/fm', 2)).list()).toEqual(['m2', 'm3']);
	});

	it('refuses an id that cannot name a message, and reads an unreadable file as nothing marked', async () => {
		const s = await ReactionStore.open(file, '/home/fm');
		await s.set('../etc/passwd', true);
		await s.set('', true);
		expect(s.list()).toEqual([]);
		const bad = path.join(dir, 'bad.json');
		writeFileSync(bad, '{not json');
		expect((await ReactionStore.open(bad, '/home/fm')).list()).toEqual([]);
	});
});
