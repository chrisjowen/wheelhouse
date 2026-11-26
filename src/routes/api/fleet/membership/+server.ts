import { json } from '@sveltejs/kit';
import { cloudSettings, localFleet } from '$lib/server/cloud/local';
import { localFleetView } from '$lib/server/cloud/page';
import { disconnect } from '$lib/server/cloud/pairing';
import { REMOTES_LOCAL_ONLY, viaRelay } from '$lib/server/cloud/remote';
import { addGateway, editGateway, removeGateway, switchGateway } from '$lib/server/cloud/gateways';
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
 * Change it: `{ action }` where action is
 *   join     pair this ship with the gateway in use, leaving remote access off until Start on Remotes
 *   cancel   stop a Join waiting for approval
 *   check    ask the gateway again now
 *   leave    revoke this ship on the gateway in use, delete its key and forget its fleet
 *   add      save another gateway: `name`, `gateway` (its address)
 *   edit     rename a saved gateway or change its address: `id`, `name`, `gateway`
 *   remove   forget a saved gateway not in use, revoking its pairing there: `id`
 *   switch   use another saved gateway (`id`): the one in use stops and keeps its pairing,
 *            and the chosen one joins at once when it has a pairing, else starts a Join
 * Origin and session token are checked in hooks.server.ts; captain-only (agentauth.ts).
 */
export const POST: RequestHandler = async ({ request }) => {
	if (viaRelay(request)) return relayed();
	const read = await readJson(request, MAX_REQUEST_BYTES);
	if (!read.ok) return read.response;
	const { action, gateway, name, id } = read.body;
	const settings = cloudSettings();
	const starter = remoteStarter();
	const refuse = (message: string, status = 400) =>
		json({ message }, { status, headers: NO_STORE });
	switch (action) {
		case 'join': {
			const { settings: current } = await settings.read();
			if (current.device && (await settings.findKey())) {
				return refuse('This ship is already in a fleet. Leave it before joining another.', 409);
			}
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
		case 'add':
		case 'edit':
		case 'remove':
		case 'switch': {
			if ((action === 'remove' || action === 'switch') && starter.pairingInFlight)
				return refuse('Cancel the Join in progress first.', 409);
			const r =
				action === 'add'
					? await addGateway(settings, { name, gateway })
					: action === 'edit'
						? await editGateway(settings, { id, name, gateway }, starter.pairingInFlight)
						: action === 'remove'
							? await removeGateway(settings, id)
							: await switchGateway(settings, id);
			if (!r.ok) return refuse(r.error, r.status);
			if (action === 'switch') {
				starter.clear();
				await localFleet().forget();
				if ('needsJoin' in r && r.needsJoin) {
					const joined = await starter.join();
					if (!joined.ok) {
						return json(
							{ message: joined.error, view: await localFleetView({ wait: false }) },
							{ status: 502, headers: NO_STORE }
						);
					}
				}
				return json({ view: await localFleetView(), note: null }, { headers: NO_STORE });
			}
			return json(
				{ view: await localFleetView({ wait: false }), note: r.note ?? null },
				{ headers: NO_STORE }
			);
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
			return refuse('action must be join, cancel, check, leave, add, edit, remove or switch.');
	}
	return json({ view: await localFleetView({ wait: false }), note: null }, { headers: NO_STORE });
};
