import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { defaultConfigDir } from './plugins/config';
import { isCloudMachine } from './setup/cloud';

export const FEATURE_FLAGS = ['events', 'remotes'] as const;
export type FeatureFlag = (typeof FEATURE_FLAGS)[number];
export type FeatureSettings = Record<FeatureFlag, boolean>;

/** Remotes start on only for a machine the cloud product made, which is reached through them. */
export const defaultFeatures = (configDir: string): FeatureSettings => ({
	events: false,
	remotes: isCloudMachine(configDir)
});

/** Feature-owned pages and APIs return 404 while their feature is disabled. */
export function featureForPath(pathname: string): FeatureFlag | null {
	if (
		pathname === '/events' ||
		pathname.startsWith('/events/') ||
		pathname === '/settings/events' ||
		pathname.startsWith('/settings/events/') ||
		pathname === '/api/wh-events'
	)
		return 'events';
	if (
		pathname === '/remotes' ||
		pathname.startsWith('/remotes/') ||
		pathname === '/settings/cloud' ||
		pathname.startsWith('/settings/cloud/') ||
		pathname === '/settings/gateway' ||
		pathname.startsWith('/settings/gateway/') ||
		pathname === '/api/cloud' ||
		pathname.startsWith('/api/cloud/')
	)
		return 'remotes';
	return null;
}

export function parseFeatureList(value: string): FeatureFlag[] {
	const names = value
		.split(',')
		.map((name) => name.trim())
		.filter(Boolean);
	const unknown = names.find((name) => !FEATURE_FLAGS.includes(name as FeatureFlag));
	if (unknown)
		throw new Error(`Unknown feature "${unknown}". Choose: ${FEATURE_FLAGS.join(', ')}.`);
	return [...new Set(names as FeatureFlag[])];
}

/** Read saved experimental flags, then add any explicit launch-time enables. */
export async function featureSettings(
	env: NodeJS.ProcessEnv = process.env,
	configDir = defaultConfigDir(env)
): Promise<FeatureSettings> {
	const saved = await readSavedFeatures(configDir);
	let forced: FeatureFlag[] = [];
	try {
		forced = parseFeatureList(env.WHEELHOUSE_ENABLE_FEATURES ?? '');
	} catch {
		// Invalid environment configuration fails closed rather than enabling anything unexpectedly.
	}
	return {
		events: saved.events || forced.includes('events'),
		remotes: saved.remotes || forced.includes('remotes')
	};
}

/** Saved experimental flags; a flag never saved takes this machine's default. */
export async function readSavedFeatures(configDir: string): Promise<FeatureSettings> {
	const defaults = defaultFeatures(configDir);
	try {
		const raw: unknown = JSON.parse(await readFile(path.join(configDir, 'features.json'), 'utf8'));
		if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return defaults;
		const record = raw as Record<string, unknown>;
		return {
			events: typeof record.events === 'boolean' ? record.events : defaults.events,
			remotes: typeof record.remotes === 'boolean' ? record.remotes : defaults.remotes
		};
	} catch {
		return defaults;
	}
}

/** Persist the user's choices without touching any feature-owned data. */
export async function saveFeatureSettings(
	configDir: string,
	settings: FeatureSettings
): Promise<void> {
	await mkdir(configDir, { recursive: true });
	const target = path.join(configDir, 'features.json');
	const temporary = `${target}.${randomUUID()}.tmp`;
	try {
		await writeFile(temporary, `${JSON.stringify(settings, null, 2)}\n`, { mode: 0o600 });
		await rename(temporary, target);
	} catch (error) {
		await unlink(temporary).catch(() => {});
		throw error;
	}
}
