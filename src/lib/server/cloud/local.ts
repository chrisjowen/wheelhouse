import { macKeychain, type Keychain } from '../keychain';
import { defaultConfigDir } from '../plugins/config';
import { FleetSync } from './fleet';
import { cloudDir, CloudSettings, CLOUD_KEYCHAIN_SERVICE } from './settings';

/** Where the device key is kept first: the macOS Keychain (service `wheelhouse-cloud`); elsewhere its file. */
export function cloudKeychain(): Keychain | null {
	return process.platform === 'darwin' ? macKeychain(CLOUD_KEYCHAIN_SERVICE) : null;
}

/** This Wheelhouse's cloud settings, in its config directory. */
export function cloudSettings(env: NodeJS.ProcessEnv = process.env): CloudSettings {
	return new CloudSettings(cloudDir(defaultConfigDir(env)), cloudKeychain());
}

const FLEET = Symbol.for('wheelhouse.fleet-sync');
const g = globalThis as unknown as Record<symbol, { dir: string; sync: FleetSync } | undefined>;

/** This process's view of this Wheelhouse's fleet (one per process, so asks are not doubled). */
export function localFleet(env: NodeJS.ProcessEnv = process.env): FleetSync {
	const settings = cloudSettings(env);
	if (g[FLEET]?.dir !== settings.dir)
		g[FLEET] = { dir: settings.dir, sync: new FleetSync(settings) };
	return g[FLEET].sync;
}
