import { macKeychain, type Keychain } from '../gateway/keychain';
import { defaultConfigDir } from '../plugins/config';
import { cloudDir, CloudSettings, CLOUD_KEYCHAIN_SERVICE } from './settings';

/** Where the device key is kept first: the macOS Keychain (service `wheelhouse-cloud`); elsewhere its file. */
export function cloudKeychain(): Keychain | null {
	return process.platform === 'darwin' ? macKeychain(CLOUD_KEYCHAIN_SERVICE) : null;
}

/** This Wheelhouse's cloud settings, in its config directory. */
export function cloudSettings(env: NodeJS.ProcessEnv = process.env): CloudSettings {
	return new CloudSettings(cloudDir(defaultConfigDir(env)), cloudKeychain());
}
