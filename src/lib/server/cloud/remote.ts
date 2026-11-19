import { previewTemplate, type RemoteView } from '../../cloud';
import { servedOrigin } from '../session';

/**
 * How Wheelhouse tells a request that came through Wheelhouse Cloud: the
 * connector adds `X-Wheelhouse-Remote: 1` and the relay's preview template
 * (protocol §6.3), after removing any such headers the browser sent. They
 * change only where the page opens addresses on this machine, never what a
 * request may do.
 */

export const viaRelay = (request: Request) => request.headers.get('x-wheelhouse-remote') === '1';

/** Where a relayed page opens previews, or null for a page served here directly. */
export function remoteView(request: Request): RemoteView | null {
	if (!viaRelay(request)) return null;
	const preview = previewTemplate(request.headers.get('x-wheelhouse-remote-preview'));
	const port = Number(/:(\d+)$/.exec(request.headers.get('host') ?? '')?.[1] ?? NaN);
	return preview && Number.isInteger(port) ? { preview, appPort: port } : null;
}

/**
 * The origin the page that asked is shown at, which is what a preview must
 * let frame it: the relay's (as the connector passes it in
 * X-Wheelhouse-Remote-Origin) for a page that came through Wheelhouse Cloud,
 * else this server's own. A preview that lets only this computer frame it is
 * then reported as refusing to be embedded through the relay, with a link to
 * open it in a tab of its own, rather than drawn as an empty frame.
 */
export function framingOrigin(request: Request): string {
	if (viaRelay(request)) {
		const u = URL.parse(request.headers.get('x-wheelhouse-remote-origin') ?? '');
		if (u && (u.protocol === 'https:' || u.protocol === 'http:')) return u.origin;
	}
	return servedOrigin(request);
}

/**
 * The Remotes page and its API (and Settings → Gateway) answer only a browser on
 * this computer: a session through the gateway must never change the gateway,
 * re-pair the machine, read a pairing code or start and stop the connection
 * it came through.
 */
export const REMOTES_LOCAL_ONLY =
	'Remotes are managed only on this machine’s own Wheelhouse (127.0.0.1), never through the cloud.';
