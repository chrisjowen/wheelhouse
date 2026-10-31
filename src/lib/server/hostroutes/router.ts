import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Duplex } from 'node:stream';
import { localhostName } from '../../plugins/addresses';
import { refuseUpgrade } from '../sessions/terminal';
import type { HostRoute, HostRouteContext } from '../plugins/types';

/**
 * Hands requests for a `*.localhost` name to the plugin whose host route
 * answers it (see plugins/types.ts HostRoute), before SvelteKit sees them,
 * which would refuse such a Host. Wheelhouse keeps the protections it gives
 * its own routes where a browser is concerned:
 *
 *   - a `*.localhost` name is one a DNS-rebinding page cannot send;
 *   - with no plugin on to answer it, the host gets the 421 any foreign Host
 *     gets, exactly as before host routes existed;
 *   - anything that changes something (any method but GET, HEAD and OPTIONS)
 *     and every WebSocket must come from that host's own page, its Origin, so
 *     another site open in the browser, or another plugin's host, cannot post
 *     to it or open a socket on it.
 *
 * Wheelhouse's session token is not asked for: the page on that host is not
 * one of Wheelhouse's, and never has it.
 */

export interface HostMatch {
	plugin: string;
	route: HostRoute;
	port: number;
	settings: Record<string, unknown>;
}

export interface HostRouterOptions {
	/** The route that answers a host name, while its plugin is on (PluginRegistry.hostRoute). */
	route(hostname: string): Promise<HostMatch | null>;
	loopbackAddresses(): Promise<string[]>;
	/** Wheelhouse's own ports beyond the one a request came in on. */
	reservedPorts(): number[];
	log?(message: string): void;
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
export const MISDIRECTED = 'Misdirected request';

type Verdict =
	| { ok: true; match: HostMatch; ctx: HostRouteContext }
	| { ok: false; status: number; message: string };

export class HostRouter {
	constructor(private readonly opts: HostRouterOptions) {}

	/** Take an HTTP request for a `*.localhost` name; false leaves any other to SvelteKit. */
	request(req: IncomingMessage, res: ServerResponse): boolean {
		if (localhostName(req.headers.host) === null) return false;
		void this.check(req, false).then(
			(v) => {
				if (!v.ok) return send(res, v.status, v.message);
				return Promise.resolve()
					.then(() => v.match.route.request(req, res, v.ctx))
					.catch((e) => {
						this.failed(v.match, e);
						if (!res.headersSent) send(res, 500, 'The plugin that answers this address failed.');
						else res.destroy();
					});
			},
			() => send(res, 500, 'Wheelhouse could not tell which plugin answers this address.')
		);
		return true;
	}

	/** Take a WebSocket upgrade for a `*.localhost` name; false leaves any other to its server. */
	upgrade(req: IncomingMessage, socket: Duplex, head: Buffer): boolean {
		if (localhostName(req.headers.host) === null) return false;
		socket.on('error', () => socket.destroy());
		void this.check(req, true).then(
			(v) => {
				if (!v.ok) return refuseUpgrade(socket, v.status, v.message);
				const upgrade = v.match.route.upgrade;
				if (!upgrade) return refuseUpgrade(socket, 404, 'This address takes no WebSockets.');
				return Promise.resolve()
					.then(() => upgrade.call(v.match.route, req, socket, head, v.ctx))
					.catch((e) => {
						this.failed(v.match, e);
						socket.destroy();
					});
			},
			() => socket.destroy()
		);
		return true;
	}

	/** Whether this request may reach a plugin, and which. */
	async check(req: IncomingMessage, upgrade: boolean): Promise<Verdict> {
		const host = (req.headers.host ?? '').toLowerCase();
		const match = await this.opts.route(localhostName(host)!);
		if (!match) return { ok: false, status: 421, message: MISDIRECTED };
		const origin = `http://${host}`;
		const method = (req.method ?? 'GET').toUpperCase();
		if (upgrade || !SAFE_METHODS.has(method)) {
			const from = req.headers.origin;
			if (!from) {
				return {
					ok: false,
					status: 403,
					message: 'Requests that change anything must carry an Origin header.'
				};
			}
			if (from !== origin) {
				return { ok: false, status: 403, message: `Requests from ${from} are not accepted.` };
			}
		}
		const own = req.socket.localPort;
		const ctx: HostRouteContext = {
			host,
			origin,
			port: match.port,
			settings: match.settings,
			loopbackAddresses: () => this.opts.loopbackAddresses(),
			reservedPorts: () => [...new Set([...(own ? [own] : []), ...this.opts.reservedPorts()])]
		};
		return { ok: true, match, ctx };
	}

	private failed(match: HostMatch, e: unknown): void {
		this.opts.log?.(
			`Plugin ${match.plugin}: host route "${match.route.id}" failed: ${e instanceof Error ? e.message : String(e)}`
		);
	}
}

function send(res: ServerResponse, status: number, message: string): void {
	res.writeHead(status, {
		'content-type': 'text/plain; charset=utf-8',
		'cache-control': 'no-store',
		'x-content-type-options': 'nosniff'
	});
	res.end(message);
}
