import { json } from '@sveltejs/kit';
import { cloudSettings } from '$lib/server/cloud/local';
import { disconnect } from '$lib/server/cloud/pairing';
import { REMOTES_LOCAL_ONLY, viaRelay } from '$lib/server/cloud/remote';
import { gatewayOrigin } from '$lib/server/cloud/settings';
import { remoteStarter } from '$lib/server/cloud/starter';
import { NO_STORE, readJson } from '$lib/server/http';
import type { RequestHandler } from './$types';

const MAX_REQUEST_BYTES = 4 * 1024;

const relayed = () => json({ message: REMOTES_LOCAL_ONLY }, { status: 403, headers: NO_STORE });

/**
 * Wheelhouse Cloud on this machine, for the Remotes page: started or not, the
 * gateway, the device, the connector, a pairing in progress. Never the key.
 * Only on this computer: never through the gateway (REMOTES_LOCAL_ONLY).
 */
export const GET: RequestHandler = async ({ request }) => {
	if (viaRelay(request)) return relayed();
	return json(await remoteStarter().view(), { headers: NO_STORE });
};

/**
 * Change it: `{ action }` where action is `start` (turn remote access on;
 * pairs first when this machine is not paired), `stop` (cancel a pairing and
 * turn it off), `gateway` with `gateway: <url>` (only while no machine is
 * paired or pairing; empty for the default), `disconnect` (revoke this
 * machine on its gateway and delete its key), or `approve-pins` /
 * `reject-pins` with `ref: <the pending change's ref>` (decide on the change
 * of trusted passkeys the gateway asked for: only here, never through it).
 * Origin and session token are checked in hooks.server.ts.
 */
export const POST: RequestHandler = async ({ request }) => {
	if (viaRelay(request)) return relayed();
	const read = await readJson(request, MAX_REQUEST_BYTES);
	if (!read.ok) return read.response;
	const { action, gateway, ref } = read.body;
	const settings = cloudSettings();
	const starter = remoteStarter();
	const refuse = (message: string, status = 400) =>
		json({ message }, { status, headers: NO_STORE });
	switch (action) {
		case 'start': {
			const r = await starter.start();
			if (!r.ok) return refuse(r.error, 502);
			break;
		}
		case 'stop':
			await starter.stop();
			break;
		case 'gateway': {
			if (typeof gateway !== 'string') return refuse('Give the gateway as a URL.');
			const { settings: s } = await settings.read();
			if (s.device) {
				return refuse('Revoke this machine before changing its gateway.', 409);
			}
			if (starter.pairingInFlight) {
				return refuse('Stop the pairing in progress before changing the gateway.', 409);
			}
			let origin = '';
			if (gateway.trim()) {
				const o = gatewayOrigin(gateway);
				if (!o.ok) return refuse(o.error);
				origin = o.origin;
			}
			await settings.update((x) => (x.gateway = origin));
			starter.clear();
			break;
		}
		case 'disconnect': {
			if (starter.pairingInFlight) await starter.stop();
			const r = await disconnect(settings);
			starter.clear();
			if (r.error) {
				return json(
					{
						view: await starter.view(),
						note: `This machine’s key was deleted here, but the gateway could not be told (${r.error}). Remove it from the gateway’s list of machines too.`
					},
					{ headers: NO_STORE }
				);
			}
			break;
		}
		case 'approve-pins':
		case 'reject-pins': {
			if (typeof ref !== 'string' || !ref) return refuse('Name the change of passkeys (ref).');
			const r =
				action === 'approve-pins'
					? await settings.approvePins(ref)
					: await settings.rejectPins(ref);
			if (!r.ok) return refuse(r.error, 409);
			break;
		}
		default:
			return refuse(
				'action must be start, stop, gateway, disconnect, approve-pins or reject-pins.'
			);
	}
	return json({ view: await starter.view(), note: null }, { headers: NO_STORE });
};
