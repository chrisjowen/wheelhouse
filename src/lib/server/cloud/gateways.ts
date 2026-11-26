import { randomBytes } from 'node:crypto';
import { unpair } from './pairing';
import {
	gatewayOrigin,
	MAX_GATEWAYS,
	type CloudSettings,
	type CloudSettingsData
} from './settings';

/**
 * The gateways the captain saved on Settings → Fleet (Fleetyard, a
 * self-hosted one, one on this computer for testing): add, rename or
 * readdress, remove, and switch which one this ship uses. A ship is in one
 * fleet at a time, through the gateway in use. Switching stops using the
 * current one (remote access stops, and its pairing is kept, unused, so
 * switching back needs no new approval) and uses the chosen one, which pairs
 * first when it has no pairing with a key here. Removing a gateway revokes
 * its pairing there, if it has one, and deletes its key here. Each pairing's
 * key is kept apart from every other's (keySlotFor).
 */

export type GatewayResult =
	{ ok: true; note?: string } | { ok: false; error: string; status: number };

const refuse = (error: string, status = 400): GatewayResult => ({ ok: false, error, status });

function checkName(raw: unknown): string | GatewayResult {
	if (typeof raw !== 'string' || !raw.trim()) return refuse('Give the gateway a name.');
	if (raw.trim().length > 60) return refuse('A gateway’s name must be 60 characters or fewer.');
	return raw.trim();
}

function checkAddress(raw: unknown): string | GatewayResult {
	if (typeof raw !== 'string' || !raw.trim()) return refuse('Give the gateway’s address.');
	const o = gatewayOrigin(raw);
	return o.ok ? o.origin : refuse(o.error);
}

/** The address of each saved gateway, the one in use from the settings themselves. */
const addressOf = (s: CloudSettingsData, id: string) =>
	id === s.activeId ? s.gateway : s.gateways.find((g) => g.id === id)?.gateway;

/** Save another gateway, not in use until the captain switches to it. */
export async function addGateway(
	settings: CloudSettings,
	input: { name: unknown; gateway: unknown }
): Promise<GatewayResult> {
	const name = checkName(input.name);
	if (typeof name !== 'string') return name;
	const origin = checkAddress(input.gateway);
	if (typeof origin !== 'string') return origin;
	const { settings: s } = await settings.read();
	if (s.gateways.length >= MAX_GATEWAYS)
		return refuse(`At most ${MAX_GATEWAYS} gateways are kept.`);
	if (s.gateways.some((g) => addressOf(s, g.id) === origin))
		return refuse('That gateway is saved already.', 409);
	await settings.update((x) => {
		x.gateways.push({
			id: `g-${randomBytes(4).toString('hex')}`,
			name,
			gateway: origin,
			device: null
		});
	});
	return { ok: true };
}

/**
 * Rename a saved gateway, or give it another address. A gateway this ship is
 * paired with keeps its address: the pairing belongs to that one.
 */
export async function editGateway(
	settings: CloudSettings,
	input: { id: unknown; name: unknown; gateway: unknown },
	pairingInFlight: boolean
): Promise<GatewayResult> {
	const name = checkName(input.name);
	if (typeof name !== 'string') return name;
	const origin = checkAddress(input.gateway);
	if (typeof origin !== 'string') return origin;
	const { settings: s } = await settings.read();
	const entry = s.gateways.find((g) => g.id === input.id);
	if (!entry) return refuse('No such gateway is saved; look again.', 404);
	const active = entry.id === s.activeId;
	const was = active ? s.gateway : entry.gateway;
	if (origin !== was) {
		if (active ? s.device : entry.device)
			return refuse(
				active
					? 'This ship is in a fleet through this gateway. Leave the fleet before changing its address.'
					: 'This ship is paired with this gateway. Remove it and add the new address instead.',
				409
			);
		if (active && pairingInFlight)
			return refuse('Cancel the Join in progress before changing this gateway’s address.', 409);
		if (s.gateways.some((g) => g.id !== entry.id && addressOf(s, g.id) === origin))
			return refuse('That address is saved already, as another gateway.', 409);
	}
	await settings.update((x) => {
		if (active) {
			x.profileName = name;
			x.gateway = origin;
			return;
		}
		const e = x.gateways.find((g) => g.id === entry.id);
		if (e) Object.assign(e, { name, gateway: origin });
	});
	return { ok: true };
}

/**
 * Forget a saved gateway that is not in use: its pairing, if it has one, is
 * revoked there with its own key, and the key is deleted here whatever the
 * gateway says.
 */
export async function removeGateway(
	settings: CloudSettings,
	id: unknown,
	deps: { fetch?: typeof fetch } = {}
): Promise<GatewayResult> {
	const { settings: s } = await settings.read();
	const entry = s.gateways.find((g) => g.id === id);
	if (!entry) return refuse('No such gateway is saved; look again.', 404);
	if (entry.id === s.activeId)
		return refuse('This ship uses this gateway now. Switch to another before removing it.', 409);
	await settings.update((x) => {
		x.gateways = x.gateways.filter((g) => g.id !== entry.id);
	});
	const device = entry.device;
	if (!device) return { ok: true };
	const slot = device.keySlot ?? null;
	const found = await settings.findKey(slot);
	await settings.removeKey(slot);
	if (!found) return { ok: true };
	const told = await unpair(device.gateway, found.key, device.id, deps);
	return told.ok
		? { ok: true }
		: {
				ok: true,
				note: `${entry.name}’s key was deleted here, but the gateway could not be told (${told.error}). Remove this ship from its list of machines too.`
			};
}

/**
 * Use another saved gateway. The one in use stops (remote access stops; its
 * pairing is kept for switching back) and the chosen one takes its place.
 * Returns whether the chosen one still needs a Join: it has no pairing, or
 * none whose key is here.
 */
export async function switchGateway(
	settings: CloudSettings,
	id: unknown
): Promise<GatewayResult & { needsJoin?: boolean }> {
	const { settings: s } = await settings.read();
	const entry = s.gateways.find((g) => g.id === id);
	if (!entry) return refuse('No such gateway is saved; look again.', 404);
	if (entry.id === s.activeId) return { ok: true, needsJoin: !s.device };
	const kept = entry.device ? await settings.findKey(entry.device.keySlot ?? null) : null;
	await settings.update((x) => {
		const current = x.gateways.find((g) => g.id === x.activeId);
		if (current) {
			current.name = x.profileName;
			current.gateway = x.gateway;
			current.device = x.device;
		}
		const next = x.gateways.find((g) => g.id === entry.id)!;
		x.activeId = next.id;
		x.profileName = next.name;
		x.gateway = next.gateway;
		x.device = kept ? next.device : null;
		next.device = null;
		x.enabled = !!x.device;
		x.started = false;
		x.reconnectAt = null;
	});
	// A pairing whose key went missing cannot be used: it is forgotten, and the Join pairs anew.
	if (entry.device && !kept) await settings.removeKey(entry.device.keySlot ?? null);
	return { ok: true, needsJoin: !kept };
}
