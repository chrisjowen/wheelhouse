import { json } from '@sveltejs/kit';
import { ALERT_KINDS } from '$lib/bell';
import { GATEWAY_CHANNELS, type GatewayChannel } from '$lib/gateway';
import { NO_STORE, readJson } from '$lib/server/http';
import { currentGateway, getRuntime } from '$lib/server/runtime';
import type { AlertKind } from '$lib/types';
import type { RequestHandler } from './$types';

const MAX_REQUEST_BYTES = 4 * 1024;
const CHANNELS = new Set(GATEWAY_CHANNELS.map((c) => c.channel));
const KINDS = new Set(ALERT_KINDS.map((k) => k.kind));

/** The gateway's channels: connected or not, paired with whom, which alerts they send. Never a token. */
export const GET: RequestHandler = async () => json(await currentGateway(), { headers: NO_STORE });

/**
 * Change one channel: `{ channel, action }` where action is `pair` (answers
 * with the one-time code, shown only to this page), `cancel-pairing`,
 * `unpair`, `on`, `off`, `alerts` with `alerts: AlertKind[]`, or
 * `titles-only` with `titlesOnly: boolean`. Origin and
 * session token are checked in hooks.server.ts. The bot token is set only
 * with `wheelhouse gateway connect`, never through the browser.
 */
export const POST: RequestHandler = async ({ request }) => {
	const runtime = await getRuntime();
	if (!runtime.configured)
		return json({ message: runtime.error }, { status: 503, headers: NO_STORE });
	const gateway = runtime.gateway;
	if (!gateway) {
		const view = await currentGateway();
		return json({ message: view.reason }, { status: 503, headers: NO_STORE });
	}
	const read = await readJson(request, MAX_REQUEST_BYTES);
	if (!read.ok) return read.response;
	const { channel, action, alerts, titlesOnly } = read.body;
	if (typeof channel !== 'string' || !CHANNELS.has(channel as GatewayChannel)) {
		return json({ message: 'Name a channel: discord.' }, { status: 400, headers: NO_STORE });
	}
	const c = channel as GatewayChannel;
	let code: { code: string; expiresAt: string } | null = null;
	switch (action) {
		case 'pair': {
			const r = await gateway.startPairing(c);
			if (!r.ok) return json({ message: r.error }, { status: 409, headers: NO_STORE });
			code = { code: r.code, expiresAt: r.expiresAt };
			break;
		}
		case 'cancel-pairing':
			gateway.cancelPairing(c);
			break;
		case 'unpair':
			await gateway.unpair(c);
			break;
		case 'on':
		case 'off':
			await gateway.setEnabled(c, action === 'on');
			break;
		case 'alerts':
			if (!Array.isArray(alerts) || !alerts.every((k) => KINDS.has(k as AlertKind))) {
				return json(
					{ message: 'alerts must list kinds: pr-green, question, stuck, landed.' },
					{ status: 400, headers: NO_STORE }
				);
			}
			await gateway.setAlerts(c, alerts as AlertKind[]);
			break;
		case 'titles-only':
			if (typeof titlesOnly !== 'boolean') {
				return json(
					{ message: 'titlesOnly must be true or false.' },
					{ status: 400, headers: NO_STORE }
				);
			}
			await gateway.setTitlesOnly(c, titlesOnly);
			break;
		default:
			return json(
				{ message: 'action must be pair, cancel-pairing, unpair, on, off, alerts or titles-only.' },
				{ status: 400, headers: NO_STORE }
			);
	}
	return json({ view: await gateway.view(), pairing: code }, { headers: NO_STORE });
};
