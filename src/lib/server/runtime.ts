import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { version } from '../../../package.json';
import { createScriptAdapter, type FirstmateAdapter } from './firstmate/adapter';
import { EvidenceReader } from './firstmate/evidence';
import { killAllRunning } from './firstmate/exec';
import {
	checkCompatibility,
	MESSAGING_PURPOSE,
	resolveInstall,
	type Compatibility,
	type FirstmateInstall
} from './firstmate/install';
import { LedgerReader } from './firstmate/ledger';
import { parseProjectsRegistry } from './firstmate/model';
import { Collector } from './collector/collector';
import { Messenger } from './store/messenger';
import { defaultStateDir, isInside, MessageStore, storeFileFor } from './store/store';
import type { FleetView, Health, MessagesView } from '../types';

/**
 * Process-wide wiring: one adapter, one collector, one evidence reader and one
 * messenger. The CLI passes the resolved Firstmate paths through
 * WHEELHOUSE_FIRSTMATE_DIR and WHEELHOUSE_HOME, and the message store's
 * directory through WHEELHOUSE_STATE_DIR; in development the same variables
 * can be set by hand.
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
			messenger: Messenger | null;
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
	const messaging = await createMessenger(install, compatibility, adapter, env);
	const collector = new Collector({
		adapter,
		compatibility,
		install,
		version,
		evidence,
		ledger: new LedgerReader(path.join(install.homeDir, 'state', 'fleet-ledger.jsonl')),
		registry: async (dataDir) =>
			parseProjectsRegistry(await readFile(path.join(dataDir, 'projects.md'), 'utf8')),
		messenger: messaging.messenger,
		messagingUnavailable: messaging.reason ?? undefined
	});
	collector.start();
	return {
		configured: true,
		install,
		adapter,
		collector,
		evidence,
		messenger: messaging.messenger
	};
}

/**
 * The message store lives in Wheelhouse's own state directory. Wheelhouse never
 * writes into the Firstmate home except through `fm-inbox.sh note`, so a state
 * directory inside the home is refused.
 */
async function createMessenger(
	install: FirstmateInstall,
	compatibility: Compatibility,
	adapter: FirstmateAdapter,
	env: NodeJS.ProcessEnv
): Promise<{ messenger: Messenger | null; reason: string | null }> {
	const stateDir = defaultStateDir(env);
	if (isInside(stateDir, install.homeDir)) {
		return {
			messenger: null,
			reason: `The Wheelhouse state directory ${stateDir} is inside the Firstmate home; choose one outside it with --state-dir.`
		};
	}
	let store: MessageStore;
	try {
		store = await MessageStore.open(storeFileFor(stateDir, install.homeDir), install.homeDir);
	} catch (e) {
		return {
			messenger: null,
			reason: `Wheelhouse could not read its message store in ${stateDir}: ${(e as Error).message}`
		};
	}
	const inbox = compatibility.scripts.find((s) => s.purpose === MESSAGING_PURPOSE);
	const unavailable = inbox?.ok
		? null
		: `This Firstmate’s inbox does not support Wheelhouse messages: ${
				inbox?.problem ?? 'fm-inbox.sh was not checked'
			}`;
	return { messenger: new Messenger({ adapter, store, unavailable }), reason: null };
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
		ledger: { available: false, reason: null },
		messaging: { available: false, reason: error, store: null }
	};
}

export function unavailableMessages(reason: string): MessagesView {
	return {
		schema: 'wheelhouse-messages.v1',
		available: false,
		reason,
		messages: [],
		receiptsAt: null,
		receiptsError: null
	};
}

export async function currentMessages(): Promise<MessagesView> {
	const r = await getRuntime();
	if (!r.configured) return unavailableMessages(r.error);
	return r.messenger
		? r.messenger.view()
		: unavailableMessages(r.collector.health().messaging.reason ?? 'Messaging is not set up.');
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
