import { describe, expect, it } from 'vitest';
import { DEFAULT_VOICE_SETTINGS, effectiveVoice, parseVoiceSettings } from './settings';

describe('voice settings', () => {
	it('keeps only known providers and sane voice ids', () => {
		expect(
			parseVoiceSettings({ speak: 'elevenlabs', voice: 'abc_1', hear: 'nobody' }, ['elevenlabs'])
		).toEqual({
			speak: 'elevenlabs',
			voice: 'abc_1',
			hear: 'browser'
		});
		expect(parseVoiceSettings('nonsense', ['elevenlabs'])).toEqual(DEFAULT_VOICE_SETTINGS);
		expect(parseVoiceSettings({ voice: '../../etc' }, []).voice).toBeNull();
	});

	it('falls back to the browser when the chosen provider has no key', () => {
		const settings = { speak: 'elevenlabs', voice: 'v1', hear: 'elevenlabs' };
		expect(effectiveVoice(settings, [{ id: 'elevenlabs', hasKey: false, canHear: true }])).toEqual({
			speak: 'browser',
			hear: 'browser',
			voice: null
		});
		expect(effectiveVoice(settings, [{ id: 'elevenlabs', hasKey: true, canHear: true }])).toEqual({
			speak: 'elevenlabs',
			hear: 'elevenlabs',
			voice: 'v1'
		});
	});
});
