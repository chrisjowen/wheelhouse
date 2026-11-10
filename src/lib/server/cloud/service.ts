import type { RelaySession } from '../../cloud';
import { Connector, type ConnectorState } from './connector';
import type { RelayContext } from './relay';
import { alive, CloudSettings, type CloudStatus } from './settings';

/**
 * Keeps this machine's connector running while Wheelhouse Cloud is turned on
 * and the machine is paired, and stopped otherwise. It reads the settings
 * every few seconds, so `wheelhouse remote connect`, `off` or `disconnect`,
 * and Settings → Cloud, take effect in a running Wheelhouse on their own. It
 * writes the connector's status (online since, last heard from the gateway,
 * the relay sessions seen) for those to show.
 *
 * Only one connector may hold a device's socket (the gateway closes the older
 * with 4409), so a service whose status file names another live process
 * leaves the socket to it.
 */

export interface CloudServiceOptions {
	settings: CloudSettings;
	version: string;
	/** The local Wheelhouse's port. */
	appPort: () => number;
	/** The ports Wheelhouse reports as previews. */
	previewPorts: () => Promise<Set<number>>;
	log: (line: string) => void;
	pollMs?: number;
	pid?: number;
	now?: () => number;
}

const POLL_MS = 3_000;
const SEEN_WRITE_MS = 15_000;
const MAX_SESSIONS = 20;
const HOLDER_FRESH_MS = 3 * 60_000;

export class CloudService {
	private connector: Connector | null = null;
	/** The device and gateway the connector was started for, and the settings stamp then. */
	private running: { deviceId: string; gateway: string } | null = null;
	private stamp = '';
	private timer: ReturnType<typeof setInterval> | null = null;
	private enabled = false;
	private status: CloudStatus | null = null;
	private writing: Promise<void> = Promise.resolve();
	private lastSeenWrite = 0;
	/** Why the connector stopped by itself; it stays stopped until the settings change. */
	private halted = false;
	private sessions = new Map<string, RelaySession>();
	private readonly pid: number;
	private readonly now: () => number;
	private ticking = false;
	/** Stopped: a look still in flight must not start a connector. */
	private closed = false;

	constructor(private opts: CloudServiceOptions) {
		this.pid = opts.pid ?? process.pid;
		this.now = opts.now ?? Date.now;
	}

	/** Start watching the settings; resolves after the first look. */
	async start(): Promise<void> {
		this.closed = false;
		await this.tick();
		this.timer = setInterval(() => void this.tick(), this.opts.pollMs ?? POLL_MS);
		this.timer.unref?.();
	}

	/** Close the socket and stop watching; the status says the connector stopped. */
	async stop(): Promise<void> {
		this.closed = true;
		if (this.timer) clearInterval(this.timer);
		this.timer = null;
		this.halt();
		await this.writing;
	}

	get state(): ConnectorState | 'idle' {
		return this.connector?.state ?? 'idle';
	}

	private halt(): void {
		const c = this.connector;
		this.connector = null;
		this.running = null;
		c?.stop();
		if (this.status && this.status.pid === this.pid) {
			this.write({ ...this.status, state: 'stopped', reason: null, since: null });
		}
	}

	private write(s: CloudStatus): void {
		this.status = s;
		const next = { ...s, updatedAt: new Date(this.now()).toISOString() };
		this.writing = this.writing
			.then(() => this.opts.settings.writeStatus(next))
			.catch((e) =>
				this.opts.log(`Wheelhouse Cloud could not write its status: ${(e as Error).message}`)
			);
	}

	/** Another live process holds the device's socket. */
	private async heldElsewhere(deviceId: string): Promise<number | null> {
		const s = await this.opts.settings.readStatus();
		if (!s || s.pid === this.pid || s.deviceId !== deviceId || s.state === 'stopped') return null;
		// A live connector rewrites its status at least every minute or so (state changes, heartbeats);
		// an older one is from a process that is gone, whatever now has its pid.
		const fresh = this.now() - Date.parse(s.updatedAt) < HOLDER_FRESH_MS;
		return fresh && alive(s.pid) ? s.pid : null;
	}

	private async tick(): Promise<void> {
		if (this.ticking || this.closed) return;
		this.ticking = true;
		try {
			await this.look();
		} finally {
			this.ticking = false;
		}
	}

	private async look(): Promise<void> {
		const stamp = await this.opts.settings.stamp();
		const changed = stamp !== this.stamp;
		this.stamp = stamp;
		if (changed) this.halted = false;
		const { settings } = await this.opts.settings.read();
		this.enabled = settings.enabled;
		const device = settings.enabled ? settings.device : null;
		if (!device || this.halted) {
			if (this.connector) {
				if (!device) this.opts.log('Wheelhouse Cloud is off or not paired here; disconnected.');
				this.halt();
			}
			return;
		}
		const same =
			this.running &&
			this.running.deviceId === device.id &&
			this.running.gateway === device.gateway;
		if (same) return;
		if (this.connector) this.halt();
		const holder = await this.heldElsewhere(device.id);
		if (holder) {
			if (changed) {
				this.opts.log(
					`Wheelhouse Cloud is already connected by process ${holder}; leaving it to that one.`
				);
			}
			return;
		}
		const found = await this.opts.settings.findKey();
		if (this.closed) return;
		if (!found) {
			if (changed)
				this.opts.log(
					'Wheelhouse Cloud: this machine’s device key is missing. Pair it again: wheelhouse remote connect.'
				);
			return;
		}
		// The sessions seen before (newest first in the file), oldest first here.
		const before = await this.opts.settings.readStatus();
		if (this.closed) return;
		const seen = before?.deviceId === device.id ? [...before.sessions].reverse() : [];
		this.sessions = new Map(seen.map((s) => [s.id, s]));
		this.running = { deviceId: device.id, gateway: device.gateway };
		const base: CloudStatus = {
			pid: this.pid,
			state: 'connecting',
			reason: null,
			gateway: device.gateway,
			deviceId: device.id,
			since: null,
			lastSeen: null,
			updatedAt: '',
			sessions: [...this.sessions.values()].reverse()
		};
		this.status = base;
		const connector = new Connector({
			gateway: device.gateway,
			deviceId: device.id,
			key: found.key,
			version: this.opts.version,
			targets: {
				appPort: this.opts.appPort,
				previewPorts: this.opts.previewPorts,
				enabled: () => this.enabled
			},
			events: {
				state: (state, reason) => {
					if (this.connector !== connector) return;
					const at = new Date(this.now()).toISOString();
					const was = this.status?.state;
					this.write({
						...this.status!,
						state,
						reason,
						since: state === 'online' ? at : null,
						lastSeen: state === 'online' ? at : this.status!.lastSeen
					});
					if (state === 'online' && was !== 'online') {
						this.opts.log(`Wheelhouse Cloud: connected to ${device.gateway} as ${device.name}.`);
					}
					if (state === 'stopped' && reason) {
						// It stays stopped, with its reason on record, until the settings change.
						this.halted = true;
						this.running = null;
						this.connector = null;
						this.opts.log(`Wheelhouse Cloud stopped: ${reason}`);
					}
				},
				seen: () => {
					if (this.connector !== connector || !this.status) return;
					const now = this.now();
					this.status.lastSeen = new Date(now).toISOString();
					if (now - this.lastSeenWrite >= SEEN_WRITE_MS) {
						this.lastSeenWrite = now;
						this.write(this.status);
					}
				},
				relayed: (r) => this.relayed(r),
				revoked: () => {
					void this.opts.settings.forget().catch(() => {});
				},
				log: (line) => this.opts.log(`Wheelhouse Cloud: ${line}`)
			}
		});
		this.connector = connector;
		this.write(base);
		connector.start();
	}

	/** §6.4: a local log of each relay session, without paths, bodies or header values. */
	private relayed(r: RelayContext): void {
		const at = new Date(this.now()).toISOString();
		const had = this.sessions.get(r.sessionId);
		if (!had) {
			this.opts.log(
				`Wheelhouse Cloud: relay session ${r.sessionId.slice(0, 8)} opened by ${r.user.name || r.user.id}.`
			);
		}
		const s: RelaySession = had
			? { ...had, lastAt: at, requests: had.requests + 1 }
			: { id: r.sessionId, user: r.user.name || r.user.id, firstAt: at, lastAt: at, requests: 1 };
		this.sessions.delete(r.sessionId);
		this.sessions.set(r.sessionId, s);
		while (this.sessions.size > MAX_SESSIONS)
			this.sessions.delete(this.sessions.keys().next().value!);
		if (!this.status) return;
		this.status.sessions = [...this.sessions.values()].reverse();
		// A new session is written at once; counts ride along with the next write.
		if (!had) this.write(this.status);
	}
}
