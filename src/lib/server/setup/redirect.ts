/**
 * Whether a request is a browser opening a page (not data, an asset or the
 * API) other than the setup wizard's: while Wheelhouse has no Firstmate, or
 * a cloud machine's agent is not signed in yet (cloud.ts), hooks.server.ts
 * sends such a request to /setup.
 */
export function opensSetup(request: Request, pathname: string): boolean {
	if (request.method !== 'GET') return false;
	if (!(request.headers.get('accept') ?? '').includes('text/html')) return false;
	if (pathname.endsWith('/__data.json')) return false;
	return !/^\/(api|_app|setup|favicon|fonts)(\/|$|\.)/.test(pathname);
}
