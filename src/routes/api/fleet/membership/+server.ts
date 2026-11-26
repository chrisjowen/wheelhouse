import { json } from '@sveltejs/kit';
import { DEFAULT_GATEWAY } from '$lib/cloud';
import { cloudSettings, localFleet } from '$lib/server/cloud/local';
import { localFleetView } from '$lib/server/cloud/page';
import { disconnect } from '$lib/server/cloud/pairing';
import { REMOTES_LOCAL_ONLY, viaRelay } from '$lib/server/cloud/remote';
import { gatewayOrigin } from '$lib/server/cloud/settings';
import { remoteStarter } from '$lib/server/cloud/starter';
import { NO_STORE, readJson } from '$lib/server/http';
import type { RequestHandler } from './$types';

const MAX_REQUEST_BYTES = 4 * 1024;

const relayed = () => json({ message: REMOTES_LOCAL_ONLY }, { status: 403, headers: NO_STORE });

/**
 * The fleet this ship is in, for Settings → Fleet: the pairing, the fleet, the
 * captain's role there and what this ship may use. Never the key. Only on this
 * computer: never through the gateway (REMOTES_LOCAL_ONLY).
 */
export const GET: RequestHandler = async ({ request }) => {
	if (viaRelay(request)) return relayed();
	return json(await localFleetView(), { headers: NO_STORE });
};

/**
 * Change it: `{ action }` where action is `join` with `gateway: <url>` (empty
 * for Fleetyard: pair this ship with that gateway, leaving remote access off
 * until Start on the Remotes page), `cancel` (stop a Join waiting for
 * approval), `check` (ask the gateway again now) or `leave` (revoke this ship
 * on its gateway, delete its key and forget its fleet; remote access stops).
 * Origin and session token are checked in hooks.server.ts; captain-only
 * (agentauth.ts).
 */
export const POST: RequestHandler = async ({ request }) => {
	if (viaRelay(request)) return relayed();
	const read = await readJson(request, MAX_REQUEST_BYTES);
	if (!read.ok) return read.response;
	const { action, gateway } = read.body;
	const settings = cloudSettings();
	const starter = remoteStarter();
	const refuse = (message: string, status = 400) =>
		json({ message }, { status, headers: NO_STORE });
	switch (action) {
		case 'join': {
			if (gateway !== undefined && typeof gateway !== 'string')
				return refuse('Give the gateway as a URL.');
			const selected =
				typeof gateway === 'string' && gateway.trim()
					? gatewayOrigin(gateway)
					: { ok: true as const, origin: DEFAULT_GATEWAY };
			if (!selected.ok) return refuse(selected.error);
			const { settings: current } = await settings.read();
			if (current.device && (await settings.findKey())) {
				return refuse('This ship is already in a fleet. Leave it before joining another.', 409);
			}
			if (starter.pairingInFlight && current.gateway !== selected.origin) {
				return refuse('Cancel the Join in progress before choosing another gateway.', 409);
			}
			await settings.update((x) => (x.gateway = selected.origin));
			starter.clear();
			const r = await starter.join();
			if (!r.ok) {
				return json(
					{ message: r.error, view: await localFleetView({ wait: false }) },
					{ status: 502, headers: NO_STORE }
				);
			}
			break;
		}
		case 'cancel':
			if (starter.pairingInFlight) await starter.stop();
			starter.clear();
			break;
		case 'check':
			return json(
				{ view: await localFleetView({ force: true }), note: null },
				{ headers: NO_STORE }
			);
		case 'leave': {
			if (starter.pairingInFlight) await starter.stop();
			const r = await disconnect(settings);
			await localFleet().forget();
			starter.clear();
			if (r.error) {
				return json(
					{
						view: await localFleetView({ wait: false }),
						note: `This ship’s key was deleted here, but the gateway could not be told (${r.error}). Remove it from the gateway’s list of machines too.`
					},
					{ headers: NO_STORE }
				);
			}
			break;
		}
		default:
			return refuse('action must be join, cancel, check or leave.');
	}
	return json({ view: await localFleetView({ wait: false }), note: null }, { headers: NO_STORE });
};
