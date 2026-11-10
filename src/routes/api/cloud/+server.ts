import { json } from '@sveltejs/kit';
import { cloudSettings } from '$lib/server/cloud/local';
import { disconnect } from '$lib/server/cloud/pairing';
import { viaRelay } from '$lib/server/cloud/remote';
import { gatewayOrigin } from '$lib/server/cloud/settings';
import { NO_STORE, readJson } from '$lib/server/http';
import type { RequestHandler } from './$types';

const MAX_REQUEST_BYTES = 4 * 1024;

/** Wheelhouse Cloud on this machine: on or off, the gateway, the device, the connector. Never the key. */
export const GET: RequestHandler = async ({ request }) =>
	json(await cloudSettings().view(viaRelay(request)), { headers: NO_STORE });

/**
 * Change it: `{ action }` where action is `on`, `off`, `gateway` with
 * `gateway: <url>` (only while no machine is paired), or `disconnect`
 * (revoke this machine on its gateway and delete its key). Origin and session
 * token are checked in hooks.server.ts. Pairing itself is done with
 * `wheelhouse remote connect`, in a terminal on this machine.
 */
export const POST: RequestHandler = async ({ request }) => {
	const read = await readJson(request, MAX_REQUEST_BYTES);
	if (!read.ok) return read.response;
	const { action, gateway } = read.body;
	const settings = cloudSettings();
	const refuse = (message: string, status = 400) =>
		json({ message }, { status, headers: NO_STORE });
	switch (action) {
		case 'on':
		case 'off':
			await settings.update((s) => (s.enabled = action === 'on'));
			break;
		case 'gateway': {
			if (typeof gateway !== 'string') return refuse('Give the gateway as a URL.');
			const { settings: s } = await settings.read();
			if (s.device) {
				return refuse('Disconnect this machine before changing its gateway.', 409);
			}
			if (!gateway.trim()) {
				await settings.update((x) => (x.gateway = ''));
				break;
			}
			const origin = gatewayOrigin(gateway);
			if (!origin.ok) return refuse(origin.error);
			await settings.update((x) => (x.gateway = origin.origin));
			break;
		}
		case 'disconnect': {
			const r = await disconnect(settings);
			if (r.error) {
				return json(
					{
						view: await settings.view(viaRelay(request)),
						note: `This machine’s key was deleted here, but the gateway could not be told (${r.error}). Remove it from the gateway’s list of machines too.`
					},
					{ headers: NO_STORE }
				);
			}
			break;
		}
		default:
			return refuse('action must be on, off, gateway or disconnect.');
	}
	return json({ view: await settings.view(viaRelay(request)), note: null }, { headers: NO_STORE });
};
