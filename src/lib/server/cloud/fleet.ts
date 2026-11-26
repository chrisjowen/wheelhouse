import { randomBytes } from 'node:crypto';
import { readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { DEFAULT_GATEWAY, type CloudPairingView, type CloudView } from '../../cloud';
import {
	FLEET_FEATURES,
	FLEET_REASONS,
	type FleetFeatureView,
	type FleetReason,
	type FleetView
} from '../../fleet';
import { b64u, fleetSig, type DeviceKey } from './protocol';
import { writeAtomic, type CloudSettings } from './settings';

/**
 * The fleet this ship has joined (wheelhouse-cloud docs/protocol.md §6.11):
 * `GET /v1/fleet`, signed with the device key, answers which fleet the ship is
 * in, the captain's role there and which features they may use, with why any
 * are off. The last answer is kept in `<config-dir>/cloud/fleet.json` (no
 * secrets: the document carries none) so both processes read it: the
 * connector's (`wheelhouse open`) asks again when the gateway sends
 * `fleet.changed`, and Settings → Fleet asks when the answer is older than
 * the gateway's `refresh_after_s`. While the gateway cannot be reached the
 * last answer stays, with why. A gateway that answers 404 has no fleets (an
 * older or self-hosted one): nothing changes for it. The document is only for
 * showing; the gateway checks every call that uses a feature again.
 */

export const FLEET_SCHEMA = 'fleetyard-fleet.v1';
export const FLEET_CACHE_SCHEMA = 'wheelhouse-fleet-cache.v1';

/** The fleet document as this Wheelhouse keeps it: the gateway's, checked and trimmed. */
export interface FleetDocument {
	schema: typeof FLEET_SCHEMA;
	version: string;
	issued_at: number;
	refresh_after_s: number;
	gateway: { url: string; modules: string[] };
	org: { id: string; slug: string; name: string; kind: 'personal' | 'company'; plan: string };
	me: {
		id: string;
		name: string;
		login: string | null;
		org_role: string | null;
		teams: { slug: string; name: string; role: string }[];
	};
	ship: { id: string; name: string; kind: 'computer' | 'hosted' };
	features: Record<string, FleetFeature>;
}

export interface FleetFeature {
	on: boolean;
	reason?: FleetReason;
	by?: string | null;
	why?: string;
	limits: Record<string, number | string[] | null>;
	teams?: string[];
}

/**
 *   ok       the gateway answered with the document
 *   none     the gateway has no fleets (404)
 *   refused  the gateway no longer knows or allows this ship (401, 403)
 *   error    it could not be asked, or its answer could not be read; the last document is kept
 */
export type FleetOutcome = 'ok' | 'none' | 'refused' | 'error';

export interface FleetCache {
	deviceId: string;
	gateway: string;
	checkedAt: string;
	outcome: FleetOutcome;
	error: string | null;
	document: FleetDocument | null;
}

type Fetched =
	| { outcome: 'ok'; document: FleetDocument }
	| { outcome: 'none' }
	| { outcome: 'refused' | 'error'; error: string };

/** The most of an answer read: a document is a few kilobytes. */
const MAX_BODY = 256 * 1024;
const TIMEOUT_MS = 10_000;
/** How long each kind of answer is good for before Settings → Fleet asks again. */
const NONE_MS = 60 * 60_000;
const REFUSED_MS = 5 * 60_000;
const ERROR_MS = 60_000;
/** Check now asks at most this often, well inside the gateway's 120 asks in 10 minutes. */
const FORCE_MS = 5_000;

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Text from the gateway as it may be shown: one line, no control characters, at most `max` long. */
function clean(v: unknown, max = 120): string | null {
	if (typeof v !== 'string') return null;
	// eslint-disable-next-line no-control-regex
	const s = v.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]+/g, ' ').trim();
	return s ? s.slice(0, max) : null;
}

const strings = (v: unknown, max = 64, count = 64): string[] =>
	Array.isArray(v)
		? v
				.map((x) => clean(x, max))
				.filter((x): x is string => x !== null)
				.slice(0, count)
		: [];

function parseLimits(v: unknown): FleetFeature['limits'] {
	const out: FleetFeature['limits'] = {};
	if (!isObj(v)) return out;
	for (const [k, x] of Object.entries(v).slice(0, 32)) {
		if (!/^[a-z0-9_.]{1,40}$/.test(k)) continue;
		if (x === null || (typeof x === 'number' && Number.isFinite(x))) out[k] = x;
		else if (Array.isArray(x)) out[k] = strings(x, 40, 32);
	}
	return out;
}

function parseFeature(v: unknown): FleetFeature | null {
	if (!isObj(v) || typeof v.on !== 'boolean') return null;
	const reason = FLEET_REASONS.includes(v.reason as FleetReason)
		? (v.reason as FleetReason)
		: undefined;
	const f: FleetFeature = { on: v.on, limits: parseLimits(v.limits) };
	if (!v.on) f.reason = reason;
	if (v.by !== undefined) f.by = clean(v.by, 80);
	const why = clean(v.why, 300);
	if (why) f.why = why;
	if (Array.isArray(v.teams)) f.teams = strings(v.teams);
	return f;
}

/**
 * A fleet document from the gateway (or this Wheelhouse's own copy), checked
 * and trimmed to what may be shown, or null when it is not one. Features it
 * does not know are kept for later readers; Settings → Fleet shows only those
 * it names (FLEET_FEATURES).
 */
export function parseFleetDocument(v: unknown): FleetDocument | null {
	if (!isObj(v) || v.schema !== FLEET_SCHEMA) return null;
	const version = clean(v.version, 128);
	if (!version || !isObj(v.org) || !isObj(v.ship) || !isObj(v.features)) return null;
	const org = v.org;
	const ship = v.ship;
	const me = isObj(v.me) ? v.me : {};
	const gateway = isObj(v.gateway) ? v.gateway : {};
	const shipId = clean(ship.id, 64);
	if (!shipId) return null;
	const features: Record<string, FleetFeature> = {};
	for (const [key, raw] of Object.entries(v.features).slice(0, 100)) {
		if (!/^[a-z0-9_.]{1,64}$/.test(key)) continue;
		const f = parseFeature(raw);
		if (f) features[key] = f;
	}
	const refresh = typeof v.refresh_after_s === 'number' ? v.refresh_after_s : 900;
	return {
		schema: FLEET_SCHEMA,
		version,
		issued_at: typeof v.issued_at === 'number' && Number.isFinite(v.issued_at) ? v.issued_at : 0,
		// At least a minute, at most a day, whatever the gateway asks.
		refresh_after_s: Math.min(Math.max(Number.isFinite(refresh) ? refresh : 900, 60), 86_400),
		gateway: { url: clean(gateway.url, 200) ?? '', modules: strings(gateway.modules) },
		org: {
			id: clean(org.id, 64) ?? '',
			slug: clean(org.slug, 64) ?? '',
			name: clean(org.name, 80) ?? '',
			kind: org.kind === 'company' ? 'company' : 'personal',
			plan: clean(org.plan, 40) ?? ''
		},
		me: {
			id: clean(me.id, 64) ?? '',
			name: clean(me.name, 80) ?? '',
			login: clean(me.login, 64),
			org_role: clean(me.org_role, 20),
			teams: Array.isArray(me.teams)
				? me.teams
						.filter(isObj)
						.slice(0, 64)
						.flatMap((t) => {
							const slug = clean(t.slug, 64);
							return slug
								? [{ slug, name: clean(t.name, 80) ?? slug, role: clean(t.role, 20) ?? 'member' }]
								: [];
						})
				: []
		},
		ship: {
			id: shipId,
			name: clean(ship.name, 80) ?? '',
			kind: ship.kind === 'hosted' ? 'hosted' : 'computer'
		},
		features
	};
}

/** The gateway's own message on a refusal, if it gave one. */
async function message(r: Response): Promise<string | null> {
	const text = await r.text().catch(() => '');
	if (text.length > MAX_BODY) return null;
	try {
		const v: unknown = JSON.parse(text);
		return isObj(v) ? clean(v.message, 200) : null;
	} catch {
		return null;
	}
}

/** §6.11: ask the gateway for this ship's fleet document, signed with its device key. */
export async function fetchFleet(
	gateway: string,
	deviceId: string,
	key: DeviceKey,
	deps: { fetch?: typeof fetch; now?: () => number } = {}
): Promise<Fetched> {
	const ts = (deps.now ?? Date.now)();
	const nonce = b64u(randomBytes(18));
	let r: Response;
	try {
		r = await (deps.fetch ?? fetch)(`${gateway}/v1/fleet`, {
			method: 'GET',
			headers: {
				accept: 'application/json',
				'X-WHC-Device': deviceId,
				'X-WHC-Ts': String(ts),
				'X-WHC-Nonce': nonce,
				'X-WHC-Sig': fleetSig(key, deviceId, ts, nonce)
			},
			redirect: 'error',
			signal: AbortSignal.timeout(TIMEOUT_MS)
		});
	} catch (e) {
		return {
			outcome: 'error',
			error: `The gateway at ${gateway} could not be reached: ${(e as Error).message}`
		};
	}
	if (r.status === 404) {
		await r.body?.cancel().catch(() => {});
		return { outcome: 'none' };
	}
	if (r.status === 401) {
		await r.body?.cancel().catch(() => {});
		return {
			outcome: 'refused',
			error: 'The gateway no longer knows this ship. Leave the fleet here and join again.'
		};
	}
	if (r.status === 403) {
		const why = await message(r);
		return {
			outcome: 'refused',
			error: `${why ?? 'The gateway no longer lets this ship in its fleet.'} Leave the fleet here and join again.`
		};
	}
	if (r.status === 429) {
		await r.body?.cancel().catch(() => {});
		return {
			outcome: 'error',
			error: 'The gateway asked this ship to slow down; it will ask again in a few minutes.'
		};
	}
	if (r.status !== 200) {
		const why = await message(r);
		return {
			outcome: 'error',
			error: `The gateway answered ${r.status}${why ? `: ${why}` : '.'}`
		};
	}
	const length = Number(r.headers.get('content-length'));
	const text =
		Number.isFinite(length) && length > MAX_BODY ? null : await r.text().catch(() => null);
	let parsed: unknown = null;
	try {
		parsed = text !== null && text.length <= MAX_BODY ? JSON.parse(text) : null;
	} catch {
		parsed = null;
	}
	const document = parseFleetDocument(parsed);
	// An answer about another ship is not this one's, whatever else it says.
	if (!document || document.ship.id !== deviceId) {
		return {
			outcome: 'error',
			error: 'The gateway’s fleet answer is not one this Wheelhouse understands.'
		};
	}
	return { outcome: 'ok', document };
}

function parseCache(v: unknown): FleetCache | null {
	if (!isObj(v) || v.schema !== FLEET_CACHE_SCHEMA) return null;
	const deviceId = clean(v.deviceId, 64);
	const gateway = clean(v.gateway, 200);
	const checkedAt = clean(v.checkedAt, 40);
	const outcome = ['ok', 'none', 'refused', 'error'].includes(v.outcome as string)
		? (v.outcome as FleetOutcome)
		: null;
	if (!deviceId || !gateway || !checkedAt || !outcome) return null;
	return {
		deviceId,
		gateway,
		checkedAt,
		outcome,
		error: clean(v.error, 400),
		document: parseFleetDocument(v.document)
	};
}

export interface FleetSyncDeps {
	fetch?: typeof fetch;
	now?: () => number;
}

/**
 * This ship's fleet, asked of its gateway and kept in `fleet.json` beside the
 * cloud settings. Each process has its own; they share the file.
 */
export class FleetSync {
	private inflight: Promise<FleetCache | null> | null = null;

	constructor(
		private settings: CloudSettings,
		private deps: FleetSyncDeps = {}
	) {}

	get file(): string {
		return path.join(this.settings.dir, 'fleet.json');
	}

	private now(): number {
		return (this.deps.now ?? Date.now)();
	}

	/** The last answer kept, whichever ship it was for. */
	async read(): Promise<FleetCache | null> {
		try {
			return parseCache(JSON.parse(await readFile(this.file, 'utf8')));
		} catch {
			return null;
		}
	}

	/** Forget the last answer: this ship left its fleet. */
	async forget(): Promise<void> {
		await rm(this.file, { force: true });
	}

	/** The last answer still good for this long from when it was asked. */
	private goodFor(c: FleetCache): number {
		if (c.outcome === 'ok' && c.document) return c.document.refresh_after_s * 1000;
		if (c.outcome === 'none') return NONE_MS;
		if (c.outcome === 'refused') return REFUSED_MS;
		return ERROR_MS;
	}

	/**
	 * Ask the gateway again when the answer kept is not for this ship, is older
	 * than it is good for, or (`version`, from `fleet.changed`) differs from
	 * the document's; `force` asks anyway, at most every few seconds. Returns the
	 * answer now kept for this ship, or null when it is not paired.
	 */
	refresh(opts: { force?: boolean; version?: string } = {}): Promise<FleetCache | null> {
		this.inflight ??= this.ask(opts).finally(() => (this.inflight = null));
		return this.inflight;
	}

	private async ask(opts: { force?: boolean; version?: string }): Promise<FleetCache | null> {
		const { settings } = await this.settings.read();
		const device = settings.device;
		const kept = await this.read();
		if (!device) {
			if (kept) await this.forget();
			return null;
		}
		const mine =
			kept && kept.deviceId === device.id && kept.gateway === device.gateway ? kept : null;
		if (mine) {
			const age = this.now() - Date.parse(mine.checkedAt);
			const fresh = age >= 0 && age < this.goodFor(mine);
			const recent = age >= 0 && age < FORCE_MS;
			if (opts.version !== undefined) {
				if (mine.document?.version === opts.version && mine.outcome === 'ok') return mine;
			} else if (opts.force ? recent : fresh) return mine;
		}
		const found = await this.settings.findKey();
		if (!found) return mine;
		const got = await fetchFleet(device.gateway, device.id, found.key, this.deps);
		// The ship may have left, or joined another fleet, while the gateway was asked.
		const { settings: after } = await this.settings.read();
		if (after.device?.id !== device.id) return null;
		const next: FleetCache = {
			deviceId: device.id,
			gateway: device.gateway,
			checkedAt: new Date(this.now()).toISOString(),
			outcome: got.outcome,
			error: got.outcome === 'refused' || got.outcome === 'error' ? got.error : null,
			// A failed ask keeps the last document, to show with why; a refusal or no fleets drops it.
			document:
				got.outcome === 'ok'
					? got.document
					: got.outcome === 'error'
						? (mine?.document ?? null)
						: null
		};
		await writeAtomic(
			this.file,
			JSON.stringify({ schema: FLEET_CACHE_SCHEMA, ...next }, null, '\t') + '\n'
		);
		return next;
	}
}

function reasonNote(f: FleetFeature, doc: FleetDocument): string {
	const org = doc.org.name || 'this fleet';
	switch (f.reason) {
		case 'not_on_this_gateway':
			return 'This gateway doesn’t offer it.';
		case 'suspended':
			return `Suspended for ${org}.`;
		case 'not_in_plan':
			return doc.org.plan ? `Not in the ${doc.org.plan} plan.` : 'Not in this fleet’s plan.';
		case 'invite_only':
			return 'Invite-only for now.';
		case 'off_by_org':
			return f.by ? `Switched off for ${org} by ${f.by}.` : `Switched off for ${org}.`;
		case 'off_by_team':
			return f.by ? `Switched off for your team by ${f.by}.` : 'Switched off for your team.';
		case 'needs_role':
			return 'Your role in this fleet doesn’t include it.';
		default:
			return 'Off.';
	}
}

/** The features Settings → Fleet lists, in its order, with why each is off. */
export function fleetFeatures(doc: FleetDocument): FleetFeatureView[] {
	const teamName = new Map(doc.me.teams.map((t) => [t.slug, t.name]));
	return FLEET_FEATURES.flatMap(({ key, label }) => {
		const f = doc.features[key];
		if (!f) return [];
		const teams = (f.teams ?? []).map((slug) => teamName.get(slug) ?? slug);
		// Off for the fleet but on for some of the captain's teams: on, for those teams only.
		const forTeams = !f.on && teams.length > 0;
		return [
			{
				key,
				label,
				on: f.on || forTeams,
				reason: f.on || forTeams ? null : (f.reason ?? null),
				note: forTeams ? `Only for ${teams.join(', ')}.` : f.on ? null : reasonNote(f, doc),
				why: f.on || forTeams ? null : (f.why ?? null)
			}
		];
	});
}

/** What Settings → Fleet shows: the pairing, and the fleet the gateway last said this ship is in. */
export function fleetView(
	cloud: CloudView,
	cache: FleetCache | null,
	pairing: CloudPairingView | null = cloud.pairing ?? null
): FleetView {
	const device = cloud.device;
	const gateway = cloud.gateway;
	const base: FleetView = {
		schema: 'wheelhouse-fleet.v1',
		state: 'not-joined',
		gateway,
		fleetyard: gateway === DEFAULT_GATEWAY,
		ship: null,
		fleet: null,
		features: [],
		checkedAt: null,
		error: null,
		pairing,
		viaRelay: cloud.viaRelay
	};
	if (!device) {
		// A record whose key went missing, say, or why the connector stopped.
		return { ...base, error: cloud.state === 'not-paired' ? cloud.reason : null };
	}
	const ship = { name: device.name, fingerprint: device.fingerprint, pairedAt: device.pairedAt };
	const mine = cache && cache.deviceId === device.id && cache.gateway === gateway ? cache : null;
	if (!mine) return { ...base, state: 'unknown', ship };
	const checked = { ship, checkedAt: mine.checkedAt, error: mine.error };
	if (mine.outcome === 'none') return { ...base, ...checked, state: 'no-fleets' };
	if (mine.outcome === 'refused') return { ...base, ...checked, state: 'refused' };
	const doc = mine.document;
	if (!doc) return { ...base, ...checked, state: 'unknown' };
	return {
		...base,
		...checked,
		state: 'joined',
		ship: { ...ship, name: doc.ship.name || ship.name },
		fleet: {
			name: doc.org.name || doc.org.slug,
			slug: doc.org.slug,
			kind: doc.org.kind,
			plan: doc.org.plan,
			role: doc.me.org_role,
			person: doc.me.name || doc.me.login || '',
			teams: doc.me.teams
		},
		features: fleetFeatures(doc)
	};
}
