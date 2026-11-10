import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readRemembered, rememberedFile, writeRemembered } from './remembered';

let dir: string;
beforeEach(() => {
	dir = mkdtempSync(path.join(tmpdir(), 'wh-remember-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('the remembered Firstmate', () => {
	it('is none until setup writes one', () => {
		expect(readRemembered(dir)).toBeNull();
	});

	it('round-trips, making the config directory', () => {
		const config = path.join(dir, 'config', 'wheelhouse');
		writeRemembered(config, { firstmate: '/opt/firstmate', home: '/opt/firstmate' });
		expect(readRemembered(config)).toEqual({ firstmate: '/opt/firstmate', home: '/opt/firstmate' });
		expect(JSON.parse(readFileSync(rememberedFile(config), 'utf8'))).toEqual({
			firstmate: '/opt/firstmate',
			home: '/opt/firstmate'
		});
	});

	it('ignores a file that is not one', () => {
		for (const body of [
			'nope',
			'[]',
			'{"firstmate":"relative/path"}',
			'{"firstmate":"/a","home":3}'
		]) {
			writeFileSync(rememberedFile(dir), body);
			expect(readRemembered(dir)).toBeNull();
		}
	});
});
