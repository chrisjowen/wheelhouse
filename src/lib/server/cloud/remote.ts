import { previewTemplate, type RemoteView } from '../../cloud';

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
