import type { CloudPairingView } from './cloud';

/**
 * The fleet this ship has joined, as the browser sees it on Settings → Fleet:
 * the gateway, the fleet (an org on Fleetyard: everyone's own fleet of one, or
 * a company's), the captain's role there, and which features the gateway says
 * this ship may use, with why any are off. It comes from the gateway's fleet
 * document (`GET /v1/fleet`, wheelhouse-cloud docs/protocol.md §6.11), cached
 * here; it is only for showing, never for security: the gateway checks every
 * call again.
 */

/**
 *   not-joined  no gateway knows this ship yet (Join pairs it)
 *   joined      paired, and the gateway answered with this ship's fleet
 *   no-fleets   paired with a gateway that has no fleets (an older or self-hosted one):
 *               remote access works as before, with nothing to show here
 *   refused     paired, but the gateway no longer knows or allows this ship: leave and join again
 *   unknown     paired, and the gateway could not be asked yet
 */
export type FleetState = 'not-joined' | 'joined' | 'no-fleets' | 'refused' | 'unknown';

/** Why the gateway says a feature is off (§6.11): the first layer that said no. */
export type FleetReason =
	| 'not_on_this_gateway'
	| 'suspended'
	| 'not_in_plan'
	| 'invite_only'
	| 'off_by_org'
	| 'off_by_team'
	| 'needs_role';

export const FLEET_REASONS: readonly FleetReason[] = [
	'not_on_this_gateway',
	'suspended',
	'not_in_plan',
	'invite_only',
	'off_by_org',
	'off_by_team',
	'needs_role'
];

/**
 * The features Wheelhouse knows, in the order Settings → Fleet lists them,
 * with the words it uses for each. The gateway's catalogue may hold more; a
 * key not named here is ignored (§6.11).
 */
export const FLEET_FEATURES: readonly { key: string; label: string }[] = [
	{ key: 'remotes', label: 'Reach this ship from anywhere' },
	{ key: 'remotes.sealed', label: 'Sealed remote access' },
	{ key: 'cloud_second_mates', label: 'Cloud second mates' },
	{ key: 'ssh_second_mates', label: 'Second mates on your own SSH host' },
	{ key: 'cloud_firstmate', label: 'Cloud Firstmate' },
	{ key: 'own_cloud_machines', label: 'Machines in your own cloud account' },
	{ key: 'teams', label: 'Teams' },
	{ key: 'knowledge', label: 'Team knowledge and dev portal' },
	{ key: 'knowledge.write', label: 'Crews write team knowledge' },
	{ key: 'reviews', label: 'Reviews between ships' },
	{ key: 'events', label: 'Events' },
	{ key: 'fleet_chat', label: 'Fleet chat' },
	{ key: 'gateway_tools', label: 'Gateway tools' },
	{ key: 'audit', label: 'Fleet audit log' },
	{ key: 'audit.export', label: 'Audit export' },
	{ key: 'sso', label: 'Single sign-on' }
];

export interface FleetFeatureView {
	key: string;
	label: string;
	/** This ship may use it: on for the whole fleet, or for some of the captain's teams there. */
	on: boolean;
	reason: FleetReason | null;
	/** Why it is off, in a sentence, or which teams it is on for; null when simply on. */
	note: string | null;
	/** The reason the person who switched it off gave, or the operator's, as the gateway sent it. */
	why: string | null;
}

/** A gateway the captain saved, as Settings → Fleet lists it. */
export interface FleetGatewayView {
	id: string;
	name: string;
	gateway: string;
	/** The one this ship uses now. */
	active: boolean;
	/** This ship is paired with it: in its fleet when in use, its pairing kept for switching back otherwise. */
	paired: boolean;
}

export interface FleetView {
	schema: 'wheelhouse-fleet.v1';
	state: FleetState;
	/** The gateway's origin: the one this ship is paired with, else the one Join would use. */
	gateway: string;
	/** The gateway is Fleetyard, the default. */
	fleetyard: boolean;
	/** This ship as the gateway knows it. */
	ship: { name: string; fingerprint: string; pairedAt: string } | null;
	fleet: {
		name: string;
		slug: string;
		kind: 'personal' | 'company';
		plan: string;
		/** The captain's role in it: owner, admin, billing or member; null once they are not a member. */
		role: string | null;
		person: string;
		teams: { slug: string; name: string; role: string }[];
	} | null;
	features: FleetFeatureView[];
	/** When the gateway was last asked, whatever it answered. */
	checkedAt: string | null;
	/** Why the last ask failed: shown with the last answer, which is kept. */
	error: string | null;
	/** The saved gateways, in the captain's order; one is in use. */
	gateways: FleetGatewayView[];
	/** A Join waiting for the captain to approve it on the gateway, or why the last one ended. */
	pairing: CloudPairingView | null;
	/** This page itself came through the gateway. */
	viaRelay: boolean;
}

/**
 * A page in the Fleet area's row (behind the experimental `fleet` flag), and the
 * fleet feature that gates it, if any. A page whose stage has not shipped is not
 * listed at all.
 */
export interface FleetTab {
	href: string;
	label: string;
	/** The fleet document's feature for it (FLEET_FEATURES), or null for the Overview. */
	feature: string | null;
	/** Switched off for this ship, with who and why; the tab stays, locked. */
	off: FleetFeatureView | null;
}

/**
 * A feature the fleet this ship is in has switched off, with why; null when it is on,
 * or when there is no fleet document to say (not joined, or not asked yet), as before
 * fleets: the gateway checks every call again either way.
 */
export function switchedOff(view: FleetView | null, key: string): FleetFeatureView | null {
	if (view?.state !== 'joined') return null;
	return view.features.find((f) => f.key === key && !f.on) ?? null;
}

/**
 * The Fleet area's row: the Overview, then Remotes while remote access (the `remotes`
 * flag) is on, locked when the fleet switched it off.
 */
export function fleetTabs(view: FleetView | null, flags: { remotes?: boolean }): FleetTab[] {
	const tabs: FleetTab[] = [{ href: '/fleet', label: 'Overview', feature: null, off: null }];
	if (flags.remotes)
		tabs.push({
			href: '/fleet/remotes',
			label: 'Remotes',
			feature: 'remotes',
			off: switchedOff(view, 'remotes')
		});
	return tabs;
}
