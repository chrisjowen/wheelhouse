import { statSync } from 'node:fs';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { defaultConfigDir } from './plugins/config';
import { isCloudMachine } from './setup/cloud';
import { answersFile } from './setup/answers';

export const FEATURE_FLAGS = [
	'events',
	'remotes',
	'hosted-second-mates',
	'discussion',
	'lanes',
	'livereview'
] as const;
export const FEATURE_SETTINGS = [...FEATURE_FLAGS, 'automaticProviderSwitching'] as const;
export type FeatureFlag = (typeof FEATURE_SETTINGS)[number];
export type FeatureSettings = Record<FeatureFlag, boolean>;

/** Remotes start on only for a machine the cloud product made, which is reached through them. */
export const defaultFeatures = (configDir: string): FeatureSettings => ({
	events: false,
	remotes: isCloudMachine(configDir),
	'hosted-second-mates': false,
	discussion: false,
	lanes: false,
	livereview: false,
	automaticProviderSwitching: true
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
		pathname === '/second-mates/add' ||
		pathname.startsWith('/second-mates/add/') ||
		pathname === '/api/second-mate-setup' ||
		pathname.startsWith('/api/second-mate-setup/')
	)
		return 'hosted-second-mates';
	if (
		pathname === '/api/live' ||
		pathname.startsWith('/api/live/') ||
		pathname === '/settings/discussion' ||
		pathname.startsWith('/settings/discussion/')
	)
		return 'discussion';
	const taskSegment = pathname.startsWith('/tasks/')
		? pathname.split('/')[2]
		: pathname.startsWith('/api/tasks/')
			? pathname.split('/')[3]
			: null;
	if (taskSegment?.includes('@') || taskSegment?.toLowerCase().includes('%40')) return 'remotes';
	// A live review: its API (/api/tasks/<id>/livereview), the address that opens a task's
	// preview for review (/tasks/<id>/live) and the panel on the page (/live-review/<id>);
	// a second mate's task is a remote's first.
	if (/^\/api\/tasks\/[^/]+\/livereview(?:\/|$)/.test(pathname)) return 'livereview';
	if (/^\/tasks\/[^/]+\/live(?:\/|$)/.test(pathname)) return 'livereview';
	if (pathname === '/live-review' || pathname.startsWith('/live-review/')) return 'livereview';
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
	const unknown = names.find(
		(name) => !FEATURE_FLAGS.includes(name as (typeof FEATURE_FLAGS)[number])
	);
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
		remotes: saved.remotes || forced.includes('remotes'),
		'hosted-second-mates': saved['hosted-second-mates'] || forced.includes('hosted-second-mates'),
		discussion: saved.discussion || forced.includes('discussion'),
		lanes: saved.lanes || forced.includes('lanes'),
		livereview: saved.livereview || forced.includes('livereview'),
		automaticProviderSwitching: saved.automaticProviderSwitching
	};
}

/**
 * The last read of each config directory's flags, by the identity of the files
 * they come from (features.json, and the setup answers its defaults read):
 * every request asks, and re-reading and parsing them each time is wasted while
 * they have not changed. A write by anything (another Wheelhouse, by hand)
 * changes a file's size, times or inode, so the next ask reads them again.
 */
const savedCache = new Map<string, { stamp: string; value: FeatureSettings }>();

/** A file's identity, by a synchronous stat: microseconds, and never queued behind other file work. */
function stampOf(file: string): string {
	const st = statSync(file, { throwIfNoEntry: false });
	return st ? `${st.ino}:${st.size}:${st.mtimeMs}:${st.ctimeMs}` : '-';
}

/** Saved experimental flags; a flag never saved takes this machine's default. */
export async function readSavedFeatures(configDir: string): Promise<FeatureSettings> {
	let stamp: string;
	try {
		stamp = `${stampOf(path.join(configDir, 'features.json'))}|${stampOf(answersFile(configDir))}`;
	} catch {
		return readSavedFile(configDir);
	}
	const hit = savedCache.get(configDir);
	if (hit?.stamp === stamp) return { ...hit.value };
	const value = await readSavedFile(configDir);
	savedCache.set(configDir, { stamp, value });
	return { ...value };
}

async function readSavedFile(configDir: string): Promise<FeatureSettings> {
	const defaults = defaultFeatures(configDir);
	try {
		const raw: unknown = JSON.parse(await readFile(path.join(configDir, 'features.json'), 'utf8'));
		if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return defaults;
		const record = raw as Record<string, unknown>;
		return {
			events: typeof record.events === 'boolean' ? record.events : defaults.events,
			remotes: typeof record.remotes === 'boolean' ? record.remotes : defaults.remotes,
			'hosted-second-mates':
				typeof record['hosted-second-mates'] === 'boolean'
					? record['hosted-second-mates']
					: defaults['hosted-second-mates'],
			discussion: typeof record.discussion === 'boolean' ? record.discussion : defaults.discussion,
			lanes: typeof record.lanes === 'boolean' ? record.lanes : defaults.lanes,
			livereview: typeof record.livereview === 'boolean' ? record.livereview : defaults.livereview,
			automaticProviderSwitching:
				typeof record.automaticProviderSwitching === 'boolean'
					? record.automaticProviderSwitching
					: defaults.automaticProviderSwitching
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
		savedCache.delete(configDir);
	} catch (error) {
		await unlink(temporary).catch(() => {});
		throw error;
	}
}
