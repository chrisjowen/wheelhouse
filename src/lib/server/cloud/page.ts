import type { CloudView } from '../../cloud';
import { cloudSettings } from './local';
import { viaRelay } from './remote';
import { remoteStarter } from './starter';

/**
 * The Remotes page's (and Settings → Gateway's) data. A page that came through the
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
