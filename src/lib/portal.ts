/**
 * The team's dev portal as Wheelhouse shows it: the basics of a service or API
 * and how it touches the captain, read from Fleetyard (wheelhouse-cloud
 * docs/protocol.md §6.12, "Wheelhouse's API"). The full portal, with every
 * fact and its receipt, stays on Fleetyard; each page here links to it. The
 * gateway's answers are checked and trimmed on the server
 * (server/cloud/portal.ts) into these shapes before a page sees them.
 */

/** One observation behind a fact: where a crew saw it, who filed it, and whether it is pinned to code. */
export interface PortalEvidence {
	source: string;
	repository: string | null;
	path: string | null;
	lines: string | null;
	commit: string | null;
	sourceRef: string | null;
	/** The first address it cites, when it cites one. */
	url: string | null;
	note: string | null;
	observedAt: string | null;
	/** The crew that filed it, such as "firstmate (claude-code)". */
	filedBy: string | null;
	/** The person that crew acted for, by their login. */
	for: string | null;
	/** Seen in a repository at a path, pinned to a commit. */
	confirmed: boolean;
}

/** A team whose dev portal this captain may read: a member's, or as a company Viewer. */
export interface PortalTeam {
	slug: string;
	name: string;
	/** Their role on the team, or `viewer`. */
	access: string;
	/** Whether the team's Docket is ready: `ready` once it has a dev portal. */
	docket: string;
	/** The team's full dev portal on Fleetyard. */
	portal: string | null;
}

/** Another record a record links to, or from. */
export interface PortalLink {
	rel: string;
	direction: 'out' | 'in';
	id: string;
	title: string;
	type: string;
	evidence: PortalEvidence[];
}

/** One of the captain's things that calls a record, or that it calls. */
export interface PortalTouch {
	id: string;
	title: string;
	type: string;
	/** The API of the record it calls, when it calls one rather than the service itself. */
	via: string | null;
	evidence: PortalEvidence[];
}

/** One record's basics: what Wheelhouse shows of a service or an API. */
export interface PortalRecord {
	id: string;
	type: string;
	typeName: string;
	title: string;
	summary: string;
	/** Its attributes as words, in the gateway's order; secret and variable lists are names only. */
	attributes: { key: string; value: string }[];
	/** How many attribute values the portal left out because they looked like secrets. */
	hidden: number;
	evidence: PortalEvidence[];
	owners: { id: string; title: string; type: string; via: string | null }[];
	/** Where a service runs, with its links there (API docs, dashboards, logs). */
	environments: { title: string; links: { label: string; url: string }[] }[];
	links: PortalLink[];
	touchesYou: {
		/** The portal knows which person the captain is (a person record with their GitHub login). */
		known: boolean;
		youOwn: boolean;
		yoursCallIt: PortalTouch[];
		itCallsYours: PortalTouch[];
	};
	/** Facts confirmed against the code, of all its facts. */
	confirmed: { facts: number; of: number };
	notKnown: string[];
	fullPage: string | null;
	updatedAt: string | null;
}

/** A record's basics, with the team whose portal holds it. */
export interface PortalRecordAnswer {
	team: { slug: string; name: string };
	record: PortalRecord;
}

/** A record named in a team's basics or an answer. */
export interface PortalItem {
	id: string;
	type: string;
	title: string;
	fullPage: string | null;
	notKnown: string[];
}

/** A team's basics: what the captain owns, and what crews filed lately. */
export interface PortalOverview {
	team: { slug: string; name: string; access: string; portal: string | null };
	you: { person: string | null; owns: PortalItem[] };
	latest: {
		id: string;
		type: string;
		title: string;
		rel: string | null;
		target: string | null;
		targetTitle: string | null;
		evidence: PortalEvidence | null;
	}[];
	readAt: string | null;
}

/** What the team's Docket holds for a question: no model writes it. */
export interface PortalAnswer {
	q: string;
	notRecorded: boolean;
	matches: (PortalItem & { typeName: string; summary: string; owners: string[] })[];
	/** Asking it on Fleetyard, where the portal's chat answers with sources. */
	fullPortal: string | null;
}

/** A dev portal page here: the record, team or answer, or why Fleetyard could not give it. */
export type PortalResult<T> =
	{ ok: true; value: T } | { ok: false; status: number; message: string };

/** The Wheelhouse page for a record of a team's portal. */
export const portalHref = (team: string, id?: string) =>
	`/portal/${encodeURIComponent(team)}${id ? `/${encodeURIComponent(id)}` : ''}`;

/** A record's name as people say it: an API by its method and path. */
export function recordName(r: { title: string; attributes?: { key: string; value: string }[] }) {
	const a = new Map((r.attributes ?? []).map((x) => [x.key, x.value]));
	const method = a.get('method');
	const p = a.get('path');
	return method && p ? `${method} ${p}` : r.title;
}

/** Where a fact was seen, in a few words: a file at its lines and commit, else what it came from. */
export function receipt(e: PortalEvidence): string {
	if (e.path) {
		const file = e.repository ? `${e.repository}/${e.path}` : e.path;
		return `${file}${e.lines ? `:${e.lines}` : ''}${e.commit ? ` @ ${e.commit.slice(0, 7)}` : ''}`;
	}
	if (e.sourceRef) return e.sourceRef;
	if (e.url) return URL.parse(e.url)?.host ?? e.url;
	return SOURCE[e.source] ?? e.source;
}

const SOURCE: Record<string, string> = {
	person: 'a person said so',
	codebase: 'the code',
	manifest: 'a manifest',
	runtime: 'the running system',
	docs: 'a document'
};

/** Who filed a fact: the crew, and the person it acted for. */
export function filedBy(e: PortalEvidence): string {
	if (e.filedBy && e.for && e.filedBy !== e.for) return `${e.filedBy} for ${e.for}`;
	return e.filedBy ?? e.for ?? 'someone';
}

const REL: Record<string, string> = {
	owned_by: 'is owned by',
	calls: 'calls',
	depends_on: 'depends on',
	exposes: 'exposes',
	lives_in: 'lives in',
	deploys: 'deploys',
	runs_in: 'runs in',
	builds: 'builds',
	involves: 'involves',
	documents: 'documents',
	member_of: 'is a member of',
	for_environment: 'is for',
	gated_by: 'is behind the flag'
};

/** A link as a sentence's verb. */
export const relWords = (rel: string) => REL[rel] ?? rel.replace(/_/g, ' ');

/** The newest of some observations. */
export function newest(evidence: PortalEvidence[]): PortalEvidence | null {
	let best: PortalEvidence | null = null;
	for (const e of evidence) if (!best || (e.observedAt ?? '') > (best.observedAt ?? '')) best = e;
	return best;
}

/** One fact about a record, as a sentence with its newest evidence. */
export interface PortalFact {
	/** The other record, when the fact is a link. */
	other: { id: string; title: string } | null;
	/** The sentence, in parts: before the other record's name, and after it. */
	text: [string, string];
	evidence: PortalEvidence;
	/** It names something the captain owns. */
	yours: boolean;
}

/**
 * A record's facts, the ones touching the captain's own things first, then
 * newest first: its links in and out, and what was seen of the record itself.
 */
export function factsOf(r: PortalRecord): PortalFact[] {
	// Your things, and the APIs of this service they call.
	const mine = new Set(
		[...r.touchesYou.yoursCallIt, ...r.touchesYou.itCallsYours].flatMap((t) =>
			t.via ? [t.id, t.via] : [t.id]
		)
	);
	const own = r.touchesYou.youOwn;
	const facts: PortalFact[] = [];
	for (const l of r.links) {
		const e = newest(l.evidence);
		if (!e) continue;
		const verb = relWords(l.rel);
		facts.push({
			other: { id: l.id, title: l.title },
			text:
				l.direction === 'out'
					? [`${recordName(r)} ${verb} `, '']
					: ['', ` ${verb} ${recordName(r)}`],
			evidence: e,
			yours: own || mine.has(l.id)
		});
	}
	for (const e of r.evidence) {
		if (!e.note) continue;
		facts.push({ other: null, text: [e.note, ''], evidence: e, yours: own });
	}
	return facts.sort(
		(a, b) =>
			Number(b.yours) - Number(a.yours) ||
			(b.evidence.observedAt ?? '').localeCompare(a.evidence.observedAt ?? '')
	);
}

/** Text as crews write it, split where `backticks` mark code. */
export function ticks(text: string): { code: boolean; text: string }[] {
	return text
		.split(/(`[^`\n]+`)/)
		.filter(Boolean)
		.map((s) =>
			s.length > 2 && s.startsWith('`') && s.endsWith('`')
				? { code: true, text: s.slice(1, -1) }
				: { code: false, text: s }
		);
}
