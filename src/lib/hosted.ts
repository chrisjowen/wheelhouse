/**
 * Previews in a hosted dev environment. When Wheelhouse runs in a cloud
 * workspace (Ona, formerly Gitpod; GitHub Codespaces; a devcontainer or a
 * remote VM), a worker's preview at `http://127.0.0.1:5173/` is on that
 * workspace, not on the viewer's computer, and the workspace serves each of
 * its ports at a public URL of its own. Wheelhouse then shows every address
 * on its computer at that URL instead: in a live preview's frame and **Open
 * in new tab**, and every link on its pages (see client/addresses.svelte.ts).
 *
 * Where the URLs are, from the server's environment, first match wins:
 *
 * 1. `WHEELHOUSE_PREVIEW_URL` (or `wheelhouse open --preview-url`): a URL
 *    pattern with `{port}` once, in its host or its path, such as
 *    `https://{port}.example.dev` or `https://code.example.dev/proxy/{port}`.
 *    `off` turns hosted previews off, detection included.
 * 2. Gitpod Classic workspaces only: `GITPOD_WORKSPACE_URL`, such as
 *    `https://abc.ws-eu45.gitpod.io`, serves port 5173 at
 *    `https://5173-abc.ws-eu45.gitpod.io`. Ona's current environments are not
 *    detected (its docs give no variable or URL format a port's URL can be
 *    derived from), so they need the pattern set.
 * 3. GitHub Codespaces: `CODESPACE_NAME` and
 *    `GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN` serve port 5173 at
 *    `https://<name>-5173.<domain>`.
 *
 * With none, addresses are shown as before (a plugin's address rewrite, such
 * as the Localhost proxy's, still applies). Wheelhouse's own ports are never
 * rewritten. Pure, so the server and the pages share it, and unit-tested.
 */

/** Where the pattern came from. */
export type HostedSource = 'configured' | 'gitpod' | 'codespaces';

/** Where a hosted environment serves the ports on Wheelhouse's computer. */
export interface HostedPreviews {
	/** An http(s) URL with `{port}` once in its host or path, such as `https://{port}-abc.ws-eu45.gitpod.io`. */
	pattern: string;
	source: HostedSource;
}

/** What the pages are given: the pattern, and the ports that stay as they are (Wheelhouse's own). */
export interface HostedView extends HostedPreviews {
	reserved: number[];
}

/** The environment variable that sets (or, with `off`, turns off) the pattern. */
export const PREVIEW_URL_ENV = 'WHEELHOUSE_PREVIEW_URL';

/** The hosts an address on Wheelhouse's computer is written with. */
const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', '0.0.0.0', '[::1]']);

const validPort = (n: number) => Number.isInteger(n) && n >= 1 && n <= 65535;

/**
 * `raw` if it is a pattern a hosted environment's ports can be opened at: an
 * http(s) URL with `{port}` exactly once, in its host or its path, and no
 * credentials, query or fragment; else null.
 */
export function previewPattern(raw: unknown): string | null {
	if (typeof raw !== 'string') return null;
	const v = raw.trim();
	if (v.length > 300 || v.split('{port}').length !== 2) return null;
	// The authority (a host, with `{port}` somewhere in it or not, and maybe a fixed port), then a path.
	const m = /^https?:\/\/([a-z0-9.-]*(?:\{port\}[a-z0-9.-]*)?)(?::\d{1,5})?(\/[^?#]*)?$/i.exec(v);
	if (!m) return null;
	const u = URL.parse(v.replace('{port}', '1'));
	return u && u.hostname === m[1].replace('{port}', '1').toLowerCase() ? v : null;
}

/** The host a workspace URL such as `https://abc.ws-eu45.gitpod.io` names; null when it is not one. */
function workspaceHost(raw: string | undefined): string | null {
	const u = URL.parse(raw?.trim() ?? '');
	if (!u || u.protocol !== 'https:' || u.username || u.password || u.port) return null;
	return /^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/i.test(u.hostname) ? u.hostname.toLowerCase() : null;
}

/** The detected or configured pattern, and why a configured one was not used. */
export interface HostedDetection {
	hosted: HostedPreviews | null;
	/** A configured value that is not a pattern, in plain words; null when there is none. */
	problem: string | null;
}

/** Where the environment Wheelhouse runs in serves its ports (see the module comment). */
export function detectHosted(env: Record<string, string | undefined>): HostedDetection {
	const set = env[PREVIEW_URL_ENV]?.trim();
	let problem: string | null = null;
	if (set) {
		if (set.toLowerCase() === 'off') return { hosted: null, problem: null };
		const pattern = previewPattern(set);
		if (pattern) return { hosted: { pattern, source: 'configured' }, problem: null };
		problem = `${PREVIEW_URL_ENV} is not a preview URL pattern (an http(s) URL with {port} once in its host or path, such as https://{port}.example.dev), so it is ignored.`;
	}
	const gitpod = workspaceHost(env.GITPOD_WORKSPACE_URL);
	if (gitpod) return { hosted: { pattern: `https://{port}-${gitpod}`, source: 'gitpod' }, problem };
	const name = env.CODESPACE_NAME?.trim().toLowerCase();
	const domain = env.GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN?.trim().toLowerCase();
	if (name && domain && /^[a-z0-9-]+$/.test(name) && /^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/.test(domain)) {
		return {
			hosted: { pattern: `https://${name}-{port}.${domain}`, source: 'codespaces' },
			problem
		};
	}
	return { hosted: null, problem };
}

/** The port an http(s) address on Wheelhouse's computer is on, with no credentials; else null. */
export function localPort(raw: string): number | null {
	const u = URL.parse(raw);
	if (!u || (u.protocol !== 'http:' && u.protocol !== 'https:') || u.username || u.password) {
		return null;
	}
	if (!LOCAL_HOSTS.has(u.hostname.toLowerCase())) return null;
	const port = Number(u.port || (u.protocol === 'https:' ? 443 : 80));
	return validPort(port) ? port : null;
}

/**
 * `raw` at the hosted environment's URL for its port, when it is an address
 * on Wheelhouse's computer (127.0.0.1, localhost, 0.0.0.0 or [::1]) on a
 * port that is not one of Wheelhouse's own; else unchanged. Its path, query
 * and fragment are kept: `http://localhost:5173/app?x=1` with
 * `https://{port}-abc.ws-eu45.gitpod.io` is
 * `https://5173-abc.ws-eu45.gitpod.io/app?x=1`.
 */
export function hostedAddress(
	raw: string,
	hosted: Pick<HostedView, 'pattern'> & { reserved?: number[] }
): string {
	const port = localPort(raw);
	if (port === null || hosted.reserved?.includes(port)) return raw;
	const u = new URL(raw);
	const base = hosted.pattern.replace('{port}', String(port)).replace(/\/+$/, '');
	return `${base}${u.pathname}${u.search}${u.hash}`;
}
