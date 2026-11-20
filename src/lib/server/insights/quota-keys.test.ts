import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseQuotaKeys } from '$lib/quota-keys';
import { QUOTA_KEYS_FILE, QuotaKeys } from './quota-keys';

let dir = '';
afterEach(async () => {
	if (dir) await rm(dir, { recursive: true, force: true });
	dir = '';
});

const vault = (values: Record<string, string>) => ({
	names: async () => Object.keys(values).sort(),
	get: vi.fn(async (name: string) => values[name] ?? null)
});

describe('parseQuotaKeys', () => {
	it('keeps only known providers mapped to valid secret names', () => {
		expect(
			parseQuotaKeys({
				elevenlabs: 'ELEVEN_LABS_KEY',
				openrouter: 'bad name',
				deepseek: 42,
				nope: 'X'
			})
		).toEqual({ elevenlabs: 'ELEVEN_LABS_KEY' });
		expect(parseQuotaKeys(null)).toEqual({});
	});
});

describe('QuotaKeys', () => {
	it('maps ElevenLabs to the Voice key by default and sets it as ELEVENLABS_API_KEY', async () => {
		dir = await mkdtemp(path.join(os.tmpdir(), 'wh-quota-keys-'));
		const secrets = vault({ ELEVEN_LABS_KEY: 'xi-secret', OPENROUTER_TOKEN: 'or-secret' });
		const keys = new QuotaKeys({ configDir: dir, secrets });
		expect(await keys.env()).toEqual({ ELEVENLABS_API_KEY: 'xi-secret' });
		// Other providers are read only when mapped.
		expect(secrets.get).toHaveBeenCalledTimes(1);
		const view = await keys.view();
		expect(view.providers.find((p) => p.id === 'elevenlabs')).toMatchObject({
			secret: 'ELEVEN_LABS_KEY',
			env: 'ELEVENLABS_API_KEY',
			inVault: true
		});
		expect(view.vaultNames).toEqual(['ELEVEN_LABS_KEY', 'OPENROUTER_TOKEN']);
		expect(JSON.stringify(view)).not.toMatch(/xi-secret|or-secret/);
	});

	it('saves names only and uses an explicit mapping for other providers', async () => {
		dir = await mkdtemp(path.join(os.tmpdir(), 'wh-quota-keys-'));
		const keys = new QuotaKeys({
			configDir: dir,
			secrets: vault({ ELEVEN_LABS_KEY: 'xi-secret', OPENROUTER_TOKEN: 'or-secret' })
		});
		const view = await keys.save({ openrouter: 'OPENROUTER_TOKEN', minimax: 'MISSING' });
		const saved = await readFile(path.join(dir, QUOTA_KEYS_FILE), 'utf8');
		expect(JSON.parse(saved)).toEqual({ openrouter: 'OPENROUTER_TOKEN', minimax: 'MISSING' });
		expect(saved).not.toContain('secret');
		expect(view.providers.find((p) => p.id === 'elevenlabs')?.secret).toBeNull();
		expect(view.providers.find((p) => p.id === 'minimax')).toMatchObject({ inVault: false });
		// A saved mapping replaces the default; a missing secret is left out.
		expect(await keys.env()).toEqual({ OPENROUTER_API_KEY: 'or-secret' });
	});

	it('maps nothing when the saved file cannot be read as JSON', async () => {
		dir = await mkdtemp(path.join(os.tmpdir(), 'wh-quota-keys-'));
		await writeFile(path.join(dir, QUOTA_KEYS_FILE), '{oops');
		const keys = new QuotaKeys({ configDir: dir, secrets: vault({ ELEVEN_LABS_KEY: 'x' }) });
		expect(await keys.env()).toEqual({});
	});
});
