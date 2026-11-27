import { createHash, randomBytes } from 'node:crypto';
import type {
	PortalAnswer,
	PortalEvidence,
	PortalItem,
	PortalLink,
	PortalOverview,
	PortalRecord,
	PortalRecordAnswer,
	PortalResult,
	PortalTeam,
	PortalTouch
} from '../../portal';
import type { FleetCache, FleetSync } from './fleet';
import { b64u, portalSig, type DeviceKey } from './protocol';
import type { CloudSettings } from './settings';

/**
 * The team dev portals this ship's captain may read, from the gateway
 * (wheelhouse-cloud docs/protocol.md §6.12): every request is signed with the
 * device key over its method, path with query and body, and answers only for
 * the ship's person. Wheelhouse only reads here: the basics of a team, of one
 * record and how it touches the captain, and a question asked of the team's
 * Docket. Nothing is kept; each page asks again.
 *
 * The portal is shown only while this ship is in a fleet whose document
 * (fleet.ts) says the dev portal (`knowledge`) is on for it, or for some of the
 * captain's teams: otherwise there is no menu entry and its pages are not
 * there. The gateway checks every request again.
 */

export const PORTAL_SCHEMA = 'fleetyard-portal.v1';

/** An answer is a few dozen kilobytes; a record with many links, at most this. */
const MAX_BODY = 1024 * 1024;
const TIMEOUT_MS = 10_000;

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Text from the gateway as it may be shown: no control characters, at most `max` long. */
function text(v: unknown, max = 200): string | null {
	if (typeof v !== 'string') return null;
	// eslint-disable-next-line no-control-regex
	const s = v.replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u2028\u2029]+/g, ' ').trim();
	return s ? s.slice(0, max) : null;
}

/** One line of it. */
const line = (v: unknown, max = 200) => text(v, max)?.replace(/\s+/g, ' ') ?? null;

/** An address a page may link to: http or https only. */
function href(v: unknown): string | null {
	const s = line(v, 2000);
	const u = s ? URL.parse(s) : null;
	return u && (u.protocol === 'https:' || u.protocol === 'http:') ? u.href : null;
}

const list = <T>(v: unknown, max: number, each: (x: unknown) => T | null): T[] =>
	Array.isArray(v)
		? v
				.slice(0, max)
				.map(each)
				.filter((x): x is T => x !== null)
		: [];

const lines = (v: unknown, max = 50) => list(v, max, (x) => line(x));

function evidence(v: unknown): PortalEvidence | null {
	if (!isObj(v)) return null;
	const source = line(v.source, 40);
	if (!source) return null;
	return {
		source,
		repository: line(v.repository, 120),
		path: line(v.path, 300),
		lines: line(v.lines, 40),
		commit: line(v.commit, 64),
		sourceRef: line(v.sourceRef, 200),
		url: list(v.urls, 5, href)[0] ?? null,
		note: line(v.note, 600),
		observedAt: line(v.observedAt, 40),
		filedBy: line(v.filedBy, 80),
		for: line(v.for, 80),
		confirmed: v.confirmed === true
	};
}

const evidenceList = (v: unknown) => list(v, 20, evidence);

/** An attribute's value as words: a list joined, a number as it is, anything else left out. */
function attribute(v: unknown): string | null {
	if (typeof v === 'string') return line(v, 400);
	if (typeof v === 'number' && Number.isFinite(v)) return String(v);
	if (typeof v === 'boolean') return v ? 'yes' : 'no';
	if (Array.isArray(v)) {
		const xs = lines(v, 30);
		return xs.length ? xs.join(', ') : null;
	}
	return null;
}

function attributes(v: unknown): { key: string; value: string }[] {
	if (!isObj(v)) return [];
	return Object.entries(v)
		.slice(0, 40)
		.flatMap(([key, x]) => {
			const value = /^[A-Za-z0-9_.-]{1,40}$/.test(key) ? attribute(x) : null;
			return value ? [{ key, value }] : [];
		});
}

function touch(v: unknown): PortalTouch | null {
	if (!isObj(v)) return null;
	const id = line(v.id, 200);
	if (!id) return null;
	return {
		id,
		title: line(v.title) ?? id,
		type: line(v.type, 40) ?? '',
		via: line(v.via, 200),
		evidence: evidenceList(v.evidence)
	};
}

function link(v: unknown): PortalLink | null {
	if (!isObj(v)) return null;
	const id = line(v.id, 200);
	const rel = line(v.rel, 40);
	if (!id || !rel) return null;
	return {
		rel,
		direction: v.direction === 'in' ? 'in' : 'out',
		id,
		title: line(v.title) ?? id,
		type: line(v.type, 40) ?? '',
		evidence: evidenceList(v.evidence)
	};
}

/** The links a service has where it runs, by the words people use for them. */
const ENV_LINKS: [string, string][] = [
	['apiDocs', 'API docs'],
	['dashboard', 'Dashboard'],
	['logs', 'Logs'],
	['traces', 'Traces'],
	['alerts', 'Alerts']
];

function environment(v: unknown): PortalRecord['environments'][number] | null {
	if (!isObj(v)) return null;
	const title = line(v.title, 80) ?? line(v.deployment, 120);
	if (!title) return null;
	const a = isObj(v.attributes) ? v.attributes : {};
	return {
		title,
		links: ENV_LINKS.flatMap(([k, label]) => {
			const url = href(a[k]);
			return url ? [{ label, url }] : [];
		})
	};
}

/** `GET /v1/portal/teams/<slug>/records/<id>`'s record, checked and trimmed, or null. */
export function parseRecord(v: unknown): PortalRecord | null {
	if (!isObj(v)) return null;
	const id = line(v.id, 200);
	const type = line(v.type, 40);
	if (!id || !type) return null;
	const t = isObj(v.touchesYou) ? v.touchesYou : {};
	const c = isObj(v.confirmed) ? v.confirmed : {};
	const count = (x: unknown) =>
		typeof x === 'number' && Number.isFinite(x) && x >= 0 ? Math.floor(x) : 0;
	return {
		id,
		type,
		typeName: line(v.typeName, 40) ?? type,
		title: line(v.title) ?? id,
		summary: text(v.summary, 600) ?? '',
		attributes: attributes(v.attributes),
		hidden: count(v.hidden),
		evidence: evidenceList(v.evidence),
		owners: list(v.owners, 10, (o) => {
			if (!isObj(o)) return null;
			const oid = line(o.id, 200);
			return oid
				? {
						id: oid,
						title: line(o.title) ?? oid,
						type: line(o.type, 40) ?? '',
						via: line(o.via, 200)
					}
				: null;
		}),
		environments: list(v.environments, 10, environment),
		links: list(v.links, 200, link),
		touchesYou: {
			known: t.known === true,
			youOwn: t.youOwn === true,
			yoursCallIt: list(t.yoursCallIt, 30, touch),
			itCallsYours: list(t.itCallsYours, 30, touch)
		},
		confirmed: { facts: count(c.facts), of: count(c.of) },
		notKnown: lines(v.notKnown, 20),
		fullPage: href(v.fullPage),
		updatedAt: line(v.updatedAt, 40)
	};
}

/** `GET /v1/portal/teams/<slug>/records/<id>`: the team, and the record's basics. */
export function parseRecordAnswer(v: unknown): PortalRecordAnswer | null {
	if (!isObj(v) || v.schema !== PORTAL_SCHEMA) return null;
	const record = parseRecord(v.record);
	const t = isObj(v.team) ? v.team : {};
	const slug = line(t.slug, 40);
	return record && slug ? { team: { slug, name: line(t.name, 80) ?? slug }, record } : null;
}

function item(v: unknown): PortalItem | null {
	if (!isObj(v)) return null;
	const id = line(v.id, 200);
	if (!id) return null;
	return {
		id,
		type: line(v.type, 40) ?? '',
		title: line(v.title) ?? id,
		fullPage: href(v.fullPage),
		notKnown: lines(v.notKnown, 20)
	};
}

/** `GET /v1/portal/teams/<slug>`, checked and trimmed, or null. */
export function parseOverview(v: unknown): PortalOverview | null {
	if (!isObj(v) || v.schema !== PORTAL_SCHEMA || !isObj(v.team)) return null;
	const slug = line(v.team.slug, 40);
	if (!slug) return null;
	const you = isObj(v.you) ? v.you : {};
	return {
		team: {
			slug,
			name: line(v.team.name, 80) ?? slug,
			access: line(v.team.access, 20) ?? 'member',
			portal: href(v.team.portal)
		},
		you: { person: line(you.person, 200), owns: list(you.owns, 50, item) },
		latest: list(v.latest, 20, (x) => {
			if (!isObj(x)) return null;
			const id = line(x.id, 200);
			if (!id) return null;
			return {
				id,
				type: line(x.type, 40) ?? '',
				title: line(x.title) ?? id,
				rel: line(x.rel, 40),
				target: line(x.target, 200),
				targetTitle: line(x.targetTitle),
				evidence: evidence(x.evidence)
			};
		}),
		readAt: line(v.readAt, 40)
	};
}

/** `GET /v1/portal/teams/<slug>/ask?q=`, checked and trimmed, or null. */
export function parseAnswer(v: unknown): PortalAnswer | null {
	if (!isObj(v) || v.schema !== PORTAL_SCHEMA) return null;
	const matches = list(v.matches, 5, (m) => {
		const it = item(m);
		if (!it || !isObj(m)) return null;
		return {
			...it,
			typeName: line(m.typeName, 40) ?? it.type,
			summary: text(m.summary, 600) ?? '',
			owners: list(m.owners, 5, (o) => (isObj(o) ? line(o.title) : null))
		};
	});
	return {
		q: line(v.q, 300) ?? '',
		notRecorded: v.notRecorded === true || matches.length === 0,
		matches,
		fullPortal: href(v.fullPortal)
	};
}

/** `GET /v1/portal`'s teams, checked and trimmed. */
export function parseTeams(v: unknown): PortalTeam[] | null {
	if (!isObj(v) || v.schema !== PORTAL_SCHEMA || !Array.isArray(v.teams)) return null;
	return list(v.teams, 64, (t) => {
		if (!isObj(t)) return null;
		const slug = line(t.slug, 40);
		if (!slug || !/^[a-z0-9-]{1,40}$/.test(slug)) return null;
		return {
			slug,
			name: line(t.name, 80) ?? slug,
			access: line(t.access, 20) ?? 'member',
			docket: line(t.docket, 20) ?? 'ready',
			portal: href(t.portal)
		};
	});
}

/** Why the gateway would not answer, in the captain's words. */
function refusal(status: number, code: string | null, message: string | null): string {
	switch (code) {
		case 'not_recorded':
			return message ?? 'Not recorded in the dev portal.';
		case 'no_docket':
			return 'This team has no dev portal yet: its admin sets one up on Fleetyard.';
		case 'docket_error':
			return 'Fleetyard could not reach the team’s dev portal just now. Try again in a minute.';
		case 'rate_limited':
			return 'Fleetyard asked this ship to slow down. Try again in a few minutes.';
		case 'unknown_device':
		case 'not_allowed':
			return 'Fleetyard no longer knows this ship. Join the fleet again in Settings → Fleet.';
	}
	if (status === 404) return 'There is no such team or record, or you may not read it.';
	return message ? `Fleetyard answered ${status}: ${message}` : `Fleetyard answered ${status}.`;
}

export interface PortalDeps {
	fetch?: typeof fetch;
	now?: () => number;
}

/** §6.12: one signed GET of the dev portal API: the answer's body, or why there is none. */
export async function portalGet(
	gateway: string,
	deviceId: string,
	key: DeviceKey,
	pathAndQuery: string,
	deps: PortalDeps = {}
): Promise<PortalResult<unknown>> {
	const ts = (deps.now ?? Date.now)();
	const nonce = b64u(randomBytes(18));
	const empty = createHash('sha256').update(Buffer.alloc(0)).digest('base64url');
	// Signed as the gateway reads it: the path and query as the URL sends them (a ' in a question is %27).
	const url = new URL(pathAndQuery, gateway);
	let r: Response;
	try {
		r = await (deps.fetch ?? fetch)(url.href, {
			method: 'GET',
			headers: {
				accept: 'application/json',
				'X-WHC-Device': deviceId,
				'X-WHC-Ts': String(ts),
				'X-WHC-Nonce': nonce,
				'X-WHC-Sig': portalSig(key, deviceId, ts, nonce, 'GET', url.pathname + url.search, empty)
			},
			redirect: 'error',
			signal: AbortSignal.timeout(TIMEOUT_MS)
		});
	} catch {
		return {
			ok: false,
			status: 0,
			message: 'Fleetyard could not be reached. Try again in a minute.'
		};
	}
	const length = Number(r.headers.get('content-length'));
	const body =
		Number.isFinite(length) && length > MAX_BODY ? null : await r.text().catch(() => null);
	let parsed: unknown = null;
	try {
		parsed = body !== null && body.length <= MAX_BODY ? JSON.parse(body) : null;
	} catch {
		parsed = null;
	}
	if (r.status === 200) {
		return parsed === null
			? { ok: false, status: 502, message: 'Fleetyard’s answer could not be read.' }
			: { ok: true, value: parsed };
	}
	const err = isObj(parsed) ? parsed : {};
	return {
		ok: false,
		status: r.status,
		message: refusal(r.status, line(err.error, 40), line(err.message, 300))
	};
}

/** Whether the fleet document kept for this ship says its captain may read a dev portal. */
export function portalOn(cache: FleetCache | null): boolean {
	const k = cache?.document?.features.knowledge;
	return !!k && (k.on || (k.teams?.length ?? 0) > 0);
}

/**
 * This ship's way into its teams' dev portals: shown only while it is paired,
 * in a fleet, and the dev portal is on for it.
 */
export class DevPortal {
	constructor(
		private settings: CloudSettings,
		private fleet: FleetSync,
		private deps: PortalDeps = {}
	) {}

	/** The ship to ask as, while the dev portal is shown; null when it is not. */
	private async ship(): Promise<{ gateway: string; id: string } | null> {
		const { settings } = await this.settings.read();
		const device = settings.device;
		if (!device) return null;
		const cache = await this.fleet.read();
		const mine = cache && cache.deviceId === device.id && cache.gateway === device.gateway;
		if (!mine || (cache.outcome !== 'ok' && cache.outcome !== 'error') || !portalOn(cache))
			return null;
		return { gateway: device.gateway, id: device.id };
	}

	/** Whether the menu shows the dev portal: read from what is kept, never asking the gateway. */
	async shown(): Promise<boolean> {
		return (await this.ship()) !== null;
	}

	private async get<T>(
		pathAndQuery: string,
		parse: (v: unknown) => T | null
	): Promise<PortalResult<T> | null> {
		// A stale fleet document is asked for again, for the next look; this one uses what is kept.
		void this.fleet.refresh().catch(() => {});
		const ship = await this.ship();
		if (!ship) return null;
		const found = await this.settings.findKey();
		if (!found)
			return {
				ok: false,
				status: 0,
				message: 'This ship’s key is missing: join the fleet again in Settings → Fleet.'
			};
		const got = await portalGet(ship.gateway, ship.id, found.key, pathAndQuery, this.deps);
		if (!got.ok) return got;
		const value = parse(got.value);
		return value === null
			? {
					ok: false,
					status: 502,
					message: 'Fleetyard’s answer is not one this Wheelhouse understands.'
				}
			: { ok: true, value };
	}

	/** The captain's teams with a dev portal; null when the dev portal is not shown. */
	teams() {
		return this.get('/v1/portal', parseTeams);
	}

	/** A team's basics. */
	overview(team: string) {
		return this.get(`/v1/portal/teams/${encodeURIComponent(team)}`, parseOverview);
	}

	/** One record's basics, and how it touches the captain. */
	record(team: string, id: string) {
		return this.get(
			`/v1/portal/teams/${encodeURIComponent(team)}/records/${encodeURIComponent(id)}`,
			parseRecordAnswer
		);
	}

	/** A question asked of the team's Docket. */
	ask(team: string, q: string) {
		return this.get(
			`/v1/portal/teams/${encodeURIComponent(team)}/ask?q=${encodeURIComponent(q.trim().slice(0, 300))}`,
			parseAnswer
		);
	}
}
