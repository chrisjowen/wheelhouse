import { randomBytes } from 'node:crypto';
import type { RelaySession } from '../../cloud';
import { Connector, type ConnectorState } from './connector';
import type { RelayContext } from './relay';
import {
	alive,
	CloudSettings,
	lapsed,
	type CloudDevice,
	type CloudStatus,
	type PinsDecision
} from './settings';

/**
 * Keeps this machine's connector running while Wheelhouse Cloud is started
 * (and on) and the machine is paired, and stopped otherwise. Started means the
 * captain pressed Start on the Remotes page and has not stopped it since; a
 * pairing, `wheelhouse remote on` or an old settings file never starts it
 * (`startedOnly: false`, for `wheelhouse remote run`, needs only on). It reads
 * the settings every few seconds, so Start and Stop, `wheelhouse remote off`
 * or `disconnect` take effect in a running Wheelhouse on their own. It
 * writes the connector's status (online since, last heard from the gateway,
 * the relay sessions seen) for those to show. It keeps the pending change of
 * pins a trusted passkey signed with the device's record, for the captain to
 * approve or reject here (the Remotes page or `wheelhouse remote pins`, in
 * whichever process), and hands their decision, or the change's lapse after
 * an hour, to the connector, which applies it and tells the gateway.
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
	/**
	 * Connect only while the captain has started remote access on the Remotes page (default),
	 * else whenever the cloud is on and paired: `wheelhouse remote run`, asked for explicitly.
	 */
	startedOnly?: boolean;
	pollMs?: number;
	pid?: number;
	now?: () => number;
}

const POLL_MS = 3_000;
const SEEN_WRITE_MS = 15_000;
const MAX_SESSIONS = 20;
const HOLDER_FRESH_MS = 3 * 60_000;

const decidedKey = (d: PinsDecision) => `${d.ref}:${d.at}`;

export class CloudService {
	private connector: Connector | null = null;
	/** The device and gateway the connector was started for, and the settings stamp then. */
	private running: { deviceId: string; gateway: string; pins: string } | null = null;
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
	/** The decisions on changes of pins already handed to a connector by this process. */
	private handed = new Set<string>();

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
		this.enabled = settings.enabled && (settings.started || this.opts.startedOnly === false);
		const device = this.enabled ? settings.device : null;
		if (!device || this.halted) {
			if (this.connector) {
				if (!device) this.opts.log('Wheelhouse Cloud is stopped or not paired here; disconnected.');
				this.halt();
			}
			return;
		}
		const pins = JSON.stringify(device.pins);
		const same =
			this.running &&
			this.running.deviceId === device.id &&
			this.running.gateway === device.gateway;
		if (same && this.connector) {
			await this.settlePins(this.connector, device);
			if (!this.running || this.running.pins === pins) return;
			// Changed some other way than a decision here: connect again trusting them.
			this.opts.log('Wheelhouse Cloud: the passkeys this machine trusts changed; reconnecting.');
		}
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
		this.running = { deviceId: device.id, gateway: device.gateway, pins };
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
			pins: device.pins,
			now: this.now,
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
				proposed: async (p) => {
					let before: { ref: string; reason: 'replaced' | 'expired' } | null = null;
					await this.opts.settings.update((x) => {
						if (x.device?.id !== device.id) throw new Error('this machine is no longer paired');
						const was = x.device.pending;
						// The newest signed change replaces one still waiting, which counts as rejected.
						if (was && was.ref !== p.ref) {
							before = { ref: was.ref, reason: lapsed(was, this.now()) ? 'expired' : 'replaced' };
						}
						// A fresh id for every change, even one sent again under the same ref.
						x.device.pending = {
							...p,
							id: randomBytes(8).toString('hex'),
							requestedAt: new Date(this.now()).toISOString()
						};
					});
					const b = before as { ref: string; reason: 'replaced' | 'expired' } | null;
					if (b) connector.decide({ ref: b.ref, approved: false, reason: b.reason });
				},
				log: (line) => this.opts.log(`Wheelhouse Cloud: ${line}`)
			}
		});
		this.connector = connector;
		this.write(base);
		connector.start();
	}

	/**
	 * The pending change of pins: one past its hour lapses (as rejected), and a
	 * decision the captain made here, in this process or another, goes to the
	 * connector once, which applies it and tells the gateway.
	 */
	private async settlePins(connector: Connector, device: CloudDevice): Promise<void> {
		if (device.pending && lapsed(device.pending, this.now())) {
			// The decision this writes is handed over on the next look.
			await this.opts.settings.expirePins(device.pending.id, this.now());
			return;
		}
		const fresh = device.undelivered.filter((d) => !this.handed.has(decidedKey(d)));
		if (!fresh.length) return;
		const pins = JSON.stringify(device.pins);
		if (pins !== this.running!.pins && device.pins?.length) {
			connector.guard.repin(device.pins);
			this.running!.pins = pins;
		}
		for (const d of fresh) {
			this.handed.add(decidedKey(d));
			connector.decide({ ref: d.ref, approved: d.approved, reason: d.reason });
			this.opts.log(
				d.approved
					? `Wheelhouse Cloud: the new passkeys were approved here; this machine trusts them now.`
					: `Wheelhouse Cloud: the change of passkeys was ${d.reason ?? 'rejected'}; this machine trusts the same passkeys as before.`
			);
		}
		const sent = new Set(fresh.map(decidedKey));
		await this.opts.settings.update((x) => {
			if (x.device?.id !== device.id) return;
			x.device.undelivered = x.device.undelivered.filter((d) => !sent.has(decidedKey(d)));
		});
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
