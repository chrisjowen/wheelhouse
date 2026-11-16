import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { elevenLabs } from './elevenlabs';
import { keyterms } from './keyterms';
import { VaultSecrets } from './secret';
import { VoiceService } from './service';

let dir = '';
afterEach(async () => {
	if (dir) await rm(dir, { recursive: true, force: true });
	dir = '';
});

describe('keyterms', () => {
	it('lists the fleet’s words once each, skipping landed work', () => {
		const terms = keyterms({
			projects: [{ id: 'docket', name: 'docket' }],
			tasks: [
				{ id: 'gw-deploy', status: 'working' },
				{ id: 'old@mate', status: 'landed' }
			]
		});
		expect(terms).toContain('Fleetyard');
		expect(terms).toContain('gw-deploy');
		expect(terms).not.toContain('old');
		expect(terms.filter((t) => t.toLowerCase() === 'docket')).toHaveLength(1);
	});
});

describe('VaultSecrets', () => {
	it('reads a key the vault holds, logs the use and keeps it a while', async () => {
		const get = vi.fn(async () => 'sk-test');
		const audit = vi.fn(async () => {});
		const secrets = new VaultSecrets({
			configDir: '/cfg',
			readVault: async () =>
				({
					schema: 'wh-vault.v1',
					backend: 'keychain',
					secrets: { ELEVEN_LABS_KEY: { projects: [] } }
				}) as never,
			backend: () => ({ get }) as never,
			audit
		});
		expect(await secrets.has('ELEVEN_LABS_KEY')).toBe(true);
		expect(await secrets.get('ELEVEN_LABS_KEY')).toBe('sk-test');
		expect(await secrets.get('ELEVEN_LABS_KEY')).toBe('sk-test');
		expect(get).toHaveBeenCalledTimes(1);
		expect(audit).toHaveBeenCalledWith(
			path.join('/cfg', 'vault'),
			expect.objectContaining({
				event: 'run',
				names: ['ELEVEN_LABS_KEY'],
				program: 'wheelhouse voice',
				outcome: 'ok'
			})
		);
		expect(await secrets.get('MISSING')).toBeNull();
	});
});

describe('VoiceService', () => {
	const fakeSecrets = (key: string | null) => ({
		has: async () => key !== null,
		get: async () => key,
		forget: () => {}
	});

	it('uses the browser until a provider with a key is chosen', async () => {
		dir = await mkdtemp(path.join(os.tmpdir(), 'wheelhouse-voice-'));
		const none = new VoiceService({ configDir: dir, secrets: fakeSecrets(null) });
		expect((await none.view()).effective).toEqual({
			speak: 'browser',
			hear: 'browser',
			voice: null
		});
		const saved = await none.save({
			speak: 'elevenlabs',
			voice: 'JBFqnCBsd6RMkjVDRZzb',
			hear: 'elevenlabs'
		});
		expect(saved.settings.speak).toBe('elevenlabs');
		expect(saved.effective.speak).toBe('browser');
		expect(await none.speak('Hello.', 1)).toBeNull();
		const keyed = new VoiceService({ configDir: dir, secrets: fakeSecrets('sk') });
		expect((await keyed.view()).effective).toEqual({
			speak: 'elevenlabs',
			hear: 'elevenlabs',
			voice: 'JBFqnCBsd6RMkjVDRZzb'
		});
	});
});

describe('ElevenLabs', () => {
	it('speaks with the chosen voice and hears with key terms, keeping only the captain’s words', async () => {
		const calls: { url: string; init: RequestInit }[] = [];
		const fetcher = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
			calls.push({ url: String(url), init: init ?? {} });
			if (String(url).includes('speech-to-text'))
				return Response.json({
					text: 'crew words then mine',
					words: [
						{ text: 'crew', start: 0.1 },
						{ text: ' words', start: 0.4 },
						{ text: 'mine', start: 2.2 }
					]
				});
			return new Response('mp3');
		}) as unknown as typeof fetch;
		const p = elevenLabs(fetcher);
		await p.speak('sk', { text: 'Hi.', voice: 'onwK4e9ZLuTAKqWW03F9', speed: 1 });
		expect(calls[0].url).toContain('/text-to-speech/onwK4e9ZLuTAKqWW03F9/stream');
		expect((calls[0].init.headers as Record<string, string>)['xi-api-key']).toBe('sk');
		expect(
			await p.hear!('sk', {
				audio: new Uint8Array(10),
				type: 'audio/webm',
				keyterms: ['Fleetyard'],
				from: 2
			})
		).toBe('mine');
		const form = calls[1].init.body as FormData;
		expect(form.getAll('keyterms')).toEqual(['Fleetyard']);
	});
});
