import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { version } from '../../../package.json';
import { createScriptAdapter, type FirstmateAdapter } from './firstmate/adapter';
import { EvidenceReader } from './firstmate/evidence';
import { killAllRunning } from './firstmate/exec';
import { checkCompatibility, resolveInstall, type FirstmateInstall } from './firstmate/install';
import { LedgerReader } from './firstmate/ledger';
import { parseProjectsRegistry } from './firstmate/model';
import { Collector } from './collector/collector';
import type { FleetView, Health } from '../types';

/**
 * Process-wide wiring: one adapter, one collector, one evidence reader. The CLI
 * passes the resolved Firstmate paths through WHEELHOUSE_FIRSTMATE_DIR and
 * WHEELHOUSE_HOME; in development the same variables can be set by hand.
 * Stored on globalThis so Vite's module reloading does not start a second
 * collector, and so the CLI can shut it down.
 */

export type Runtime =
	| {
			configured: true;
			install: FirstmateInstall;
			adapter: FirstmateAdapter;
			collector: Collector;
			evidence: EvidenceReader;
	  }
	| { configured: false; error: string };

interface RuntimeHolder {
	runtime: Promise<Runtime> | null;
	shutdown: () => void;
}

const KEY = Symbol.for('wheelhouse.runtime');
const g = globalThis as unknown as Record<symbol, RuntimeHolder | undefined>;

async function create(env: NodeJS.ProcessEnv): Promise<Runtime> {
	const resolved = resolveInstall({
		firstmate: env.WHEELHOUSE_FIRSTMATE_DIR || undefined,
		home: env.WHEELHOUSE_HOME || undefined,
		cwd: process.cwd(),
		env
	});
	if (!resolved.ok) return { configured: false, error: resolved.error };
	const install = resolved.install;
	const compatibility = await checkCompatibility(install);
	const adapter = createScriptAdapter(install);
	const evidence = new EvidenceReader({
		dataDir: path.join(install.homeDir, 'data'),
		useGh: env.WHEELHOUSE_NO_GH !== '1',
		evidenceDir: env.WHEELHOUSE_NM_EVIDENCE_DIR || undefined
	});
	const collector = new Collector({
		adapter,
		compatibility,
		install,
		version,
		evidence,
		ledger: new LedgerReader(path.join(install.homeDir, 'state', 'fleet-ledger.jsonl')),
		registry: async (dataDir) =>
			parseProjectsRegistry(await readFile(path.join(dataDir, 'projects.md'), 'utf8'))
	});
	collector.start();
	return { configured: true, install, adapter, collector, evidence };
}

export function getRuntime(env: NodeJS.ProcessEnv = process.env): Promise<Runtime> {
	let holder = g[KEY];
	if (!holder) {
		holder = { runtime: null, shutdown: shutdownRuntime };
		g[KEY] = holder;
	}
	holder.runtime ??= create(env);
	return holder.runtime;
}

/** Stop polling and kill our own in-flight script runs. Firstmate is untouched. */
export function shutdownRuntime(): void {
	const holder = g[KEY];
	void holder?.runtime?.then((r) => {
		if (r.configured) r.collector.stop();
	});
	killAllRunning();
}

export function unconfiguredHealth(error: string): Health {
	return {
		schema: 'wheelhouse-health.v1',
		version,
		configured: false,
		firstmate: {
			dir: null,
			home: null,
			version: null,
			compatible: false,
			problems: [error],
			scripts: []
		},
		supervisor: {
			available: false,
			onWatch: null,
			reason: 'Wheelhouse is not connected to a Firstmate home.',
			observedAt: null,
			posture: null
		},
		collector: {
			intervalMs: 0,
			snapshotIntervalMs: 0,
			lastAttemptAt: null,
			lastSuccessAt: null,
			consecutiveFailures: 0,
			lastError: null
		},
		ledger: { available: false, reason: null }
	};
}

export function unconfiguredFleet(error: string): FleetView {
	return {
		schema: 'wheelhouse-fleet.v1',
		generatedAt: null,
		collectedAt: null,
		stale: true,
		staleReason: error,
		projects: [],
		tasks: []
	};
}

export async function currentFleet(): Promise<FleetView> {
	const r = await getRuntime();
	return r.configured ? r.collector.getFleet() : unconfiguredFleet(r.error);
}

export async function currentHealth(): Promise<Health> {
	const r = await getRuntime();
	return r.configured ? r.collector.health() : unconfiguredHealth(r.error);
}
