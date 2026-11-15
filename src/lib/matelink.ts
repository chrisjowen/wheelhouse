/**
 * A second mate on a Fleetyard machine, and the words Wheelhouse uses for its
 * link. Its host is the alias `fy-<machine>` that Fleetyard's connector writes
 * for it (`whc-connector ssh-setup`), and every connection to it goes from this
 * computer, through Fleetyard, to the machine: both ends dial out, the machine
 * opens no port, and Fleetyard passes along traffic it cannot read. Shared by
 * the server (server/firstmate/matelink.ts) and the pages, so both say the same
 * thing. No user-facing word here names the transport underneath.
 */

/** The alias Fleetyard's connector gives a hosted machine: `fy-<slug>`. */
const FLEETYARD_HOST = /^fy-([a-z0-9][a-z0-9-]{0,62})$/;

/** The Fleetyard machine a second mate's host names, or null when it is not one. */
export function fleetyardMachine(host: string | null | undefined): string | null {
	return (host && FLEETYARD_HOST.exec(host)?.[1]) || null;
}

/** A remote second mate's host in words: `mate-demo, through Fleetyard`, or the host itself. */
export function hostLabel(host: string | null | undefined): string {
	const machine = fleetyardMachine(host);
	return machine ? `${machine}, through Fleetyard` : (host ?? 'its host');
}

/** Where a remote second mate runs, after its name: `via Fleetyard · mate-demo`, or `on <host>`. */
export function placeLabel(host: string | null | undefined): string {
	const machine = fleetyardMachine(host);
	return machine ? `via Fleetyard · ${machine}` : `on ${host ?? 'another host'}`;
}

/** This computer as the captain knows it: `this Mac` on a Mac. Known only on the server. */
export const HERE = globalThis.process?.platform === 'darwin' ? 'this Mac' : 'this computer';

/** What fixes a link problem, when the captain can: each is a button on the second mate's card. */
export type LinkAction = 'wake' | 'approve' | 'update-passkeys' | 'connect';

export type LinkProblemCode =
	| 'stopped'
	| 'starting'
	| 'offline'
	| 'gone'
	| 'not-approved'
	| 'refused'
	| 'old-connector'
	| 'busy'
	| 'not-connected'
	| 'no-answer'
	| 'no-connector'
	| 'mate'
	| 'unknown';

/** Why the link does not work now, in plain words, and what fixes it. */
export interface LinkProblem {
	code: LinkProblemCode;
	text: string;
	action: LinkAction | null;
}

/** The link as a dot: linked, down (cannot reach it), pending (not approved yet), or not known. */
export type LinkHealth = 'linked' | 'down' | 'pending' | 'unknown';

/** The link as Fleetyard last described it to this computer. */
export interface MateLinkStatus {
	/** The machine's name on Fleetyard (its alias's tail until Fleetyard has named it). */
	machine: string;
	/** This computer, as the captain knows it: `this Mac`, or `this computer`. */
	here: string;
	health: LinkHealth;
	/** The machine is running with its connector online; null when Fleetyard could not be asked. */
	online: boolean | null;
	/** This computer is let in on the machine; null when that cannot be known (it is stopped). */
	approved: boolean | null;
	problem: LinkProblem | null;
	checkedAt: string;
	/** Fleetyard's own pages: its Machines page, and where this computer's approval is given. */
	urls: { machines: string | null; approve: string | null };
}

/** One step of Test connection, in the order they run; the first that fails stops the rest. */
export interface LinkStep {
	key: 'fleetyard' | 'machine' | 'approved' | 'mate';
	label: string;
	state: 'ok' | 'bad' | 'skipped';
	/** How long the step took, when it is a round trip worth timing. */
	ms: number | null;
	problem: LinkProblem | null;
}

export interface LinkTest {
	steps: LinkStep[];
	status: MateLinkStatus;
	/** The timed round trip to the second mate, when the test got that far. */
	roundTripMs: number | null;
	at: string;
}

/** A link fix that waits on the captain on Fleetyard: connecting this computer, or approving it. */
export interface LinkJob {
	kind: 'connect' | 'approve';
	state: 'running' | 'done' | 'failed';
	/** The Fleetyard page to open, once the connector names it. */
	url: string | null;
	/** What that page should show: the pairing code to type, or this computer's code to check. */
	code: string | null;
	/** How it ended, in plain words. */
	message: string | null;
	startedAt: string;
	endedAt: string | null;
}

/** The link's state and any fix in progress, as the card asks for it. */
export interface MateLinkView {
	status: MateLinkStatus | null;
	job: LinkJob | null;
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * A refusal or failure, in the connector's or Fleetyard's own words, in plain
 * ones. `here` is this computer as the captain knows it (`this Mac`). Unknown
 * words pass through with any transport name taken out.
 */
export function linkProblem(said: string, machine: string, here: string): LinkProblem {
	const s = said.replace(/^whc-connector:\s*/i, '').trim();
	const p = (code: LinkProblemCode, text: string, action: LinkAction | null = null) => ({
		code,
		text,
		action
	});
	if (/\bis stopped\b/i.test(s)) return p('stopped', `${machine} is stopped.`, 'wake');
	if (/\bis (?:still )?stopping\b/i.test(s)) {
		return p('starting', `${machine} is stopping; wake it once it has stopped.`);
	}
	if (/connector is not online yet|is still connecting|is (?:starting|provisioning)\b/i.test(s)) {
		return p('starting', `${machine} is starting; try again in a minute.`);
	}
	if (/no hosted machine called|has been deleted|is (?:deleting|deleted|failed)\b/i.test(s)) {
		return p('gone', `Fleetyard has no machine called ${machine} that can be reached.`);
	}
	if (/not approved for|has not let this computer in/i.test(s)) {
		return p('not-approved', `${cap(here)} isn’t approved for ${machine}.`, 'approve');
	}
	const refused = /refused your (?:latest approval|list)(.*)$/i.exec(s);
	if (refused) {
		const why = refused[1]
			.replace(/\s+If it .*$/i, '')
			.replace(/^\s*[(:]\s*/, '')
			.replace(/\)?\.?\s*$/, '')
			.trim();
		return p(
			'refused',
			`${machine} didn’t accept the approval${why ? `: ${why}` : ''}.`,
			'update-passkeys'
		);
	}
	if (/does not carry|connector needs updating|old connector/i.test(s)) {
		return p('old-connector', `${machine}’s connector is too old to be reached this way.`);
	}
	if (/too many|connections open|is busy/i.test(s)) {
		return p('busy', `Too many connections from ${here}; try again in a few minutes.`);
	}
	if (
		/not paired|removed from your account|account is disabled|cannot reach other machines/i.test(s)
	) {
		return p('not-connected', `${cap(here)} isn’t connected to your Fleetyard account.`, 'connect');
	}
	if (/could not reach its \S+ server/i.test(s)) {
		return p(
			'mate',
			`${machine} took the connection but could not answer it; try again in a minute.`
		);
	}
	if (/went offline/i.test(s)) return p('offline', `${machine} went offline.`);
	if (
		/could not reach|fetch failed|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|getaddrinfo|ETIMEDOUT|socket hang up|gateway answered 5\d\d|clock/i.test(
			s
		)
	) {
		return p(
			'no-answer',
			/clock/i.test(s)
				? `Fleetyard turned the request away: ${here}’s clock is off.`
				: `Fleetyard didn’t answer. Check ${here}’s internet connection, then test again.`
		);
	}
	return p('unknown', s ? `Fleetyard said: ${withoutTransport(s)}` : 'The link failed.');
}

/** Words from a tool, with the transport's name taken out. */
export function withoutTransport(s: string): string {
	return s
		.replace(/\bssh:\s*/gi, '')
		.replace(/\bSSH (?:server|host)\b/gi, 'host')
		.replace(/\bSSH\b/gi, 'the link');
}

/**
 * A second mate's sidebar dot: its link's health when it has one (linked, a
 * hollow dot while not approved, amber while it cannot be reached), else none.
 */
export function linkDot(link: { status: MateLinkStatus | null } | null): LinkHealth | null {
	return link?.status ? link.status.health : null;
}

/** What a failed connection said, as a plain phrase: why the host could not be reached. */
function plainWhy(said: string): string {
	const s = said.trim();
	if (!s) return '';
	if (/could not resolve hostname/i.test(s)) return 'its name could not be looked up';
	if (/connection refused/i.test(s)) return 'it refused the connection';
	if (/timed out/i.test(s)) return 'it did not answer in time';
	if (/no route to host|network is unreachable|host is down/i.test(s)) {
		return 'it cannot be reached from this network';
	}
	if (/permission denied/i.test(s)) return `it did not accept ${HERE}’s key`;
	if (/host key verification failed|host identification has changed/i.test(s)) {
		return `it did not match the identity ${HERE} remembers for it`;
	}
	if (/connection closed|kex_exchange_identification|connection reset/i.test(s)) {
		return 'it closed the connection';
	}
	return withoutTransport(s).slice(0, 300);
}

/**
 * Why a remote second mate's host could not be reached, as a sentence to show:
 * for one on a Fleetyard machine, the connector's own reason in the link's
 * words when it gave one; otherwise the failure in plain words. `said` is
 * what the connection wrote on standard error.
 */
export function unreachable(host: string | null, said: string, verb = 'could not reach'): string {
	const machine = fleetyardMachine(host);
	const own = said
		.split('\n')
		.map((l) => l.trim())
		.filter((l) => /^whc-connector:/.test(l))
		.pop();
	if (machine && own) return linkProblem(own, machine, HERE).text;
	const last = said.trim().split('\n').slice(-1)[0] ?? '';
	const why = plainWhy(last);
	return `${verb} ${hostLabel(host)}${why ? ` (${why})` : ''}.`;
}
