import { describe, expect, it } from 'vitest';
import { EnvFileBackend } from './env-file';
import { KeychainBackend } from './keychain';
import { LOCKED, SecretServiceBackend } from './secret-service';
import { ENV_FILE_HINT, platformBackends } from './select';

describe('platformBackends', () => {
	it('gives a Mac the login Keychain and nothing else, whatever the vault file records', () => {
		const b = platformBackends('darwin');
		expect(b.primary).toBeInstanceOf(KeychainBackend);
		expect(b.ids).toEqual(['keychain']);
		expect(b.make('env-file', '/v')).toBe(b.primary);
		expect(b.make('secret-service', '/v')).toBe(b.primary);
		expect(b.hint(b.primary, 'anything')).toBeNull();
		expect(b.primary.where).toBe('the macOS login Keychain');
		expect(b.primary.short).toBe('the Keychain');
	});

	it('keeps the Keychain on any other platform but Linux, as before', () => {
		for (const p of ['win32', 'freebsd'] as NodeJS.Platform[]) {
			expect(platformBackends(p).primary).toBeInstanceOf(KeychainBackend);
			expect(platformBackends(p).ids).toEqual(['keychain']);
		}
	});

	it('gives Linux the Secret Service, and the env file only when the vault file records it', () => {
		const b = platformBackends('linux');
		expect(b.primary).toBeInstanceOf(SecretServiceBackend);
		expect(b.ids).toEqual(['secret-service', 'env-file']);
		expect(b.make('secret-service', '/v')).toBe(b.primary);
		const env = b.make('env-file', '/v');
		expect(env).toBeInstanceOf(EnvFileBackend);
		expect((env as EnvFileBackend).file).toBe('/v/values.env');
		// A backend this computer lacks is not swapped for the env file.
		expect(b.make('keychain', '/v')).toBe(b.primary);
	});

	it('offers the env file when there is no keyring, not when the keyring is locked', () => {
		const b = platformBackends('linux');
		expect(b.hint(b.primary, 'secret-tool is not installed')).toBe(ENV_FILE_HINT);
		expect(b.hint(b.primary, LOCKED)).toBeNull();
		expect(b.hint(b.make('env-file', '/v'), 'anything')).toBeNull();
	});
});
