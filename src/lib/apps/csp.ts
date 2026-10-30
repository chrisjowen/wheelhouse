import type { AppCsp } from './types';

/**
 * The Content-Security-Policy an MCP app runs under, built from the origins
 * its resource declares (`_meta.ui.csp`), as the spec lays out: nothing
 * beyond them, and no network at all when it declares none. Wheelhouse is
 * stricter than the spec in two ways: a declared entry must be a plain origin
 * (a scheme, a host or `*.` subdomain wildcard, and an optional port), so a
 * bare `*`, a scheme alone or a keyword is dropped; and forms may not post
 * anywhere.
 */

const ORIGIN = /^(https?|wss?):\/\/(\*\.)?[a-z0-9-]+(\.[a-z0-9-]+)*(:(\d{1,5}|\*))?$/i;
const MAX_DOMAINS = 32;

const KEYS = ['connectDomains', 'resourceDomains', 'frameDomains', 'baseUriDomains'] as const;

/** The declared origins Wheelhouse can express, each list at most 32 long; anything else is dropped. */
export function cleanCsp(raw: unknown): AppCsp {
	const out: AppCsp = {};
	if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return out;
	for (const k of KEYS) {
		const list = (raw as Record<string, unknown>)[k];
		if (!Array.isArray(list)) continue;
		const kept = [
			...new Set(
				list
					.filter((d): d is string => typeof d === 'string' && ORIGIN.test(d))
					.map((d) => d.toLowerCase())
			)
		].slice(0, MAX_DOMAINS);
		if (kept.length) out[k] = kept;
	}
	return out;
}

/** The policy for an app declaring `csp` (already cleaned or not: it is cleaned again). */
export function cspHeader(csp: unknown): string {
	const c = cleanCsp(csp);
	const res = (c.resourceDomains ?? []).join(' ');
	const sp = (s: string) => (s ? ` ${s}` : '');
	const connect = c.connectDomains?.length ? `'self' ${c.connectDomains.join(' ')}` : "'none'";
	return [
		"default-src 'none'",
		`script-src 'self' 'unsafe-inline'${sp(res)}`,
		`style-src 'self' 'unsafe-inline'${sp(res)}`,
		`img-src 'self' data:${sp(res)}`,
		`font-src 'self'${sp(res)}`,
		`media-src 'self' data:${sp(res)}`,
		`connect-src ${connect}`,
		`frame-src ${c.frameDomains?.length ? c.frameDomains.join(' ') : "'none'"}`,
		"object-src 'none'",
		`base-uri ${c.baseUriDomains?.length ? c.baseUriDomains.join(' ') : "'self'"}`,
		"form-action 'none'"
	].join('; ');
}

/** Every origin the app may reach, for the page to say so. */
export function cspOrigins(csp: AppCsp): string[] {
	return [...new Set(KEYS.flatMap((k) => csp[k] ?? []))];
}
