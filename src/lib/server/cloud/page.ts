import { error } from '@sveltejs/kit';
import type { CloudView } from '../../cloud';
import { REMOTES_LOCAL_ONLY, viaRelay } from './remote';
import { remoteStarter } from './starter';

/** The Remotes page's (and Settings → Cloud's) data, refused to a page that came through the cloud. */
export async function remotesPage(request: Request): Promise<{ view: CloudView }> {
	if (viaRelay(request)) error(403, REMOTES_LOCAL_ONLY);
	return { view: await remoteStarter().view() };
}
