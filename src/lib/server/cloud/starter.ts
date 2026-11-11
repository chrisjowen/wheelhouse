import { version } from '../../../../package.json';
import type { CloudPairingView, CloudView } from '../../cloud';
import { cloudSettings } from './local';
import { keepDevice, machineName, pollPairing, startPairing, type PairingDeps } from './pairing';
import { fingerprint, newDeviceKey } from './protocol';
import { gatewayOrigin, type CloudSettings } from './settings';

/**
 * Start and Stop on the Remotes page. Start turns remote access on for a
 * paired machine (the `wheelhouse open` watcher's connector picks that up
 * within seconds: there is no second connection path here), and for one not
 * paired yet starts the same pairing `wheelhouse remote connect` does: a key
 * made here, a code the captain types on the gateway's own pair page and the
 * fingerprint they pick there; once approved, the machine is kept and
 * started. Stop cancels a pairing and turns remote access off. The device key
 * never leaves this process except into its store.
 */

export interface StarterDeps {
	settings: () => CloudSettings;
	pairing?: PairingDeps;
	machineName?: () => string;
	now?: () => number;
}

type Pending = CloudPairingView & { abort: AbortController | null };

export class RemoteStarter {
	private pending: Pending | null = null;

	constructor(private deps: StarterDeps) {}

	private get settings(): CloudSettings {
		return this.deps.settings();
	}

	/** A pairing waiting for approval, or why the last one ended. */
	get pairing(): CloudPairingView | null {
		const p = this.pending;
		if (!p) return null;
		return {
			gateway: p.gateway,
			verificationUri: p.verificationUri,
			userCode: p.userCode,
			fingerprint: p.fingerprint,
			expiresAt: p.expiresAt,
			error: p.error
		};
	}

	/** A pairing is waiting for approval. */
	get pairingInFlight(): boolean {
		return !!this.pending?.abort;
	}

	/** What the Remotes page shows. */
	async view(): Promise<CloudView> {
		return { ...(await this.settings.view()), pairing: this.pairing };
	}

	/** Start remote access: at once when paired, else after a pairing the captain approves. */
	async start(): Promise<{ ok: true } | { ok: false; error: string }> {
		if (this.pairingInFlight) return { ok: true };
		const settings = this.settings;
		const { settings: s } = await settings.read();
		if (s.device && (await settings.findKey())) {
			this.pending = null;
			await settings.update((x) => {
				x.enabled = true;
				x.started = true;
			});
			return { ok: true };
		}
		// A record that outlived its key cannot connect: pair again.
		if (s.device) await settings.forget();
		const gateway = gatewayOrigin(s.gateway);
		if (!gateway.ok) return { ok: false, error: gateway.error };
		const key = newDeviceKey();
		const name = (this.deps.machineName ?? machineName)();
		const started = await startPairing(
			gateway.origin,
			key,
			{ name, platform: `${process.platform}-${process.arch}`, version },
			this.deps.pairing
		);
		if (!started.ok) {
			this.pending = null;
			return { ok: false, error: started.error };
		}
		const p = started.start;
		const abort = new AbortController();
		const now = (this.deps.now ?? Date.now)();
		const pending: Pending = {
			gateway: gateway.origin,
			verificationUri: p.verificationUri,
			userCode: p.userCode,
			fingerprint: fingerprint(key.publicKey),
			expiresAt: new Date(now + p.expiresIn * 1000).toISOString(),
			error: null,
			abort
		};
		this.pending = pending;
		void (async () => {
			const outcome = await pollPairing(gateway.origin, key, p, {
				...this.deps.pairing,
				signal: abort.signal
			}).catch((e: unknown) => ({ status: 'failed' as const, reason: (e as Error).message }));
			if (this.pending !== pending || abort.signal.aborted) return;
			if (outcome.status === 'approved') {
				try {
					await keepDevice(settings, gateway.origin, key, name, outcome.device, { start: true });
					if (this.pending === pending) this.pending = null;
				} catch (e) {
					this.ended(
						pending,
						`The machine was approved but could not be kept here: ${(e as Error).message}`
					);
				}
				return;
			}
			this.ended(pending, `${outcome.reason} Nothing was paired; press Start for a new code.`);
		})();
		return { ok: true };
	}

	private ended(p: Pending, error: string) {
		if (this.pending !== p) return;
		this.pending = { ...p, userCode: '', error, abort: null };
	}

	/** Stop remote access: cancel any pairing and turn the cloud off here (the pairing is kept). */
	async stop(): Promise<void> {
		this.pending?.abort?.abort();
		this.pending = null;
		await this.settings.update((x) => {
			x.enabled = false;
			x.started = false;
		});
	}

	/** Forget a finished pairing's message (a gateway change, a disconnect). */
	clear(): void {
		if (!this.pairingInFlight) this.pending = null;
	}
}

const KEY = Symbol.for('wheelhouse.remote-starter');
const g = globalThis as unknown as Record<symbol, RemoteStarter | undefined>;

/** This process's starter (stable across module reloads), on this Wheelhouse's own settings. */
export function remoteStarter(): RemoteStarter {
	g[KEY] ??= new RemoteStarter({ settings: () => cloudSettings() });
	return g[KEY];
}
