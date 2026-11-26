import type { CloudView } from '../../cloud';
import type { FleetView } from '../../fleet';
import { fleetView } from './fleet';
import { cloudSettings, localFleet } from './local';
import { viaRelay } from './remote';
import { remoteStarter } from './starter';

/**
 * The Remotes page's data. A page that came through the
 * cloud gets no controls (REMOTES_LOCAL_ONLY), only the gateway it came through,
 * for the page to say it is already remote and link back there.
 */
export async function remotesPage(
	request: Request
): Promise<{ view: CloudView | null; gateway: string | null }> {
	if (viaRelay(request)) {
		const { settings } = await cloudSettings().read();
		return { view: null, gateway: settings.device?.gateway ?? settings.gateway };
	}
	return { view: await remoteStarter().view(), gateway: null };
}

/**
 * Settings → Fleet's data: the pairing and the fleet this ship is in. The page
 * opens on the answer kept, never waiting for the gateway; a stale one is asked
 * for again meanwhile, for the page's next look. Through the cloud, only the
 * gateway the page came through, as for the Remotes page.
 */
export async function fleetPage(
	request: Request
): Promise<{ view: FleetView | null; gateway: string | null }> {
	if (viaRelay(request)) {
		const { settings } = await cloudSettings().read();
		return { view: null, gateway: settings.device?.gateway ?? settings.gateway };
	}
	return { view: await localFleetView({ wait: false }), gateway: null };
}

/**
 * This Wheelhouse's fleet as Settings → Fleet shows it, asking the gateway
 * again when the answer kept is stale, or at once (`force`: Check now);
 * `wait: false` shows the answer kept without waiting for that ask.
 */
export async function localFleetView(
	opts: { force?: boolean; wait?: boolean } = {}
): Promise<FleetView> {
	const fleet = localFleet();
	const asked = fleet.refresh({ force: opts.force }).catch(() => fleet.read());
	const cache = opts.wait === false ? await fleet.read() : await asked;
	const cloud = await remoteStarter().view();
	const { settings } = await cloudSettings().read();
	const gateways = settings.gateways.map((g) => {
		const active = g.id === settings.activeId;
		return {
			id: g.id,
			name: active ? settings.profileName : g.name,
			gateway: active ? settings.gateway : g.gateway,
			active,
			paired: active ? !!cloud.device : !!g.device
		};
	});
	return fleetView(cloud, cache, gateways);
}
