import { readFile } from 'node:fs/promises';
import path from 'node:path';

/**
 * The background health check's thresholds (see monitor.ts). Every one has a
 * default here and can be changed in `health.json` in Wheelhouse's config
 * directory (WHEELHOUSE_CONFIG_DIR, else ~/.config/wheelhouse): a JSON object
 * with any of these keys, in the units their names say. A key that is missing,
 * or not a positive number, keeps its default; `"enabled": false` turns the
 * checks off (the process block in /api/health stays).
 *
 * Nothing here names a host, a path or a person: the checks look only at
 * Wheelhouse's own process, this computer's load, and the folders the
 * Firstmate home and Wheelhouse's state directory already have.
 */
export interface HealthConfig {
	enabled: boolean;
	/** How often the process is sampled and the checks run. */
	sampleSeconds: number;
	/** The fleet snapshot takes longer than this ... */
	snapshotLagSeconds: number;
	/** ... for this long: the bell says the fleet view lags (notify only). */
	snapshotLagMinutes: number;
	/** The event loop's p99 delay is over this ... */
	eventLoopP99Ms: number;
	/** ... for this long: the bell rings and the heap and handle counts are logged. */
	eventLoopMinutes: number;
	/** Post-GC heap over this: restart Wheelhouse's own server once nothing is in progress. */
	heapMb: number;
	/** Or post-GC heap grew by this much ... */
	heapGrowthMb: number;
	/** ... within this many hours. */
	heapGrowthHours: number;
	/** A restart for memory waits for this much uptime, so it can never loop. */
	restartMinUptimeMinutes: number;
	/** A chat follower nobody listens to that still watches its file this long is closed. */
	orphanFeedMinutes: number;
	/** The 1-minute load average is over this many times the CPU count ... */
	loadPerCpu: number;
	/** ... for this long: the bell names the heaviest processes (notify only). */
	loadMinutes: number;
	/** A remote second mate whose reads' median takes longer than this shows "remote host slow". */
	remoteReadP50Seconds: number;
	/** How often the history folders are measured (walking them costs disk reads). */
	historyCheckHours: number;
	/** The Firstmate home's data/ folder over this proposes archiving (never acts). */
	dataMb: number;
	/** Handled inbox notes over this many propose archiving (never acts). */
	handledNotes: number;
	/** The chat archive over this proposes archiving (never acts). */
	chatArchiveMb: number;
}

export const DEFAULT_HEALTH_CONFIG: HealthConfig = {
	enabled: true,
	sampleSeconds: 30,
	snapshotLagSeconds: 15,
	snapshotLagMinutes: 10,
	eventLoopP99Ms: 200,
	eventLoopMinutes: 5,
	heapMb: 400,
	heapGrowthMb: 100,
	heapGrowthHours: 6,
	restartMinUptimeMinutes: 60,
	orphanFeedMinutes: 10,
	loadPerCpu: 2,
	loadMinutes: 10,
	remoteReadP50Seconds: 3,
	historyCheckHours: 6,
	dataMb: 4096,
	handledNotes: 5000,
	chatArchiveMb: 1024
};

export const HEALTH_FILE = 'health.json';

/** The config from a parsed `health.json` (anything unusable keeps its default). Pure. */
export function parseHealthConfig(raw: unknown): HealthConfig {
	const out = { ...DEFAULT_HEALTH_CONFIG };
	if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
	const r = raw as Record<string, unknown>;
	if (typeof r.enabled === 'boolean') out.enabled = r.enabled;
	for (const key of Object.keys(DEFAULT_HEALTH_CONFIG) as (keyof HealthConfig)[]) {
		if (key === 'enabled') continue;
		const v = r[key];
		if (typeof v === 'number' && Number.isFinite(v) && v > 0) out[key] = v;
	}
	return out;
}

/** Read `<configDir>/health.json`; the defaults when it is missing or not JSON. */
export async function readHealthConfig(configDir: string): Promise<HealthConfig> {
	try {
		return parseHealthConfig(JSON.parse(await readFile(path.join(configDir, HEALTH_FILE), 'utf8')));
	} catch {
		return { ...DEFAULT_HEALTH_CONFIG };
	}
}
