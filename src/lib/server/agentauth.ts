import { timingSafeEqual } from 'node:crypto';
import { viaRelay } from './cloud/remote';

/**
 * The agent's way to change things, for `wheelhouse` commands an agent runs
 * (cli/agent.ts). Every page-made change carries the page's Origin and the
 * session token (session.ts). A program has neither, so it may instead send
 * `Authorization: Bearer <token>` with the token this server process wrote,
 * readable only by its owner, to `<plugins dir>/.running/<pid>.json`
 * (cli/running.ts): the same token the restart route already takes. Anyone
 * who can read that record could already edit Wheelhouse's files or restart
 * it, so it widens nothing beyond the same user.
 *
 * The token opens only the routes in AGENT_ROUTES. Those in CAPTAIN_ONLY are
 * the captain's own calls (consent, remote access, secret values, answers,
 * messages as the captain): they refuse it with 403 and name the page where
 * the captain makes the call. Every other route refuses it too. It is never
 * taken from a request a page sent (any Origin) or one that came through
 * Wheelhouse Cloud: those still need the page's checks. hooks.server.ts has
 * already refused any Host that is not loopback.
 */

export const AGENT_HEADER = 'authorization';

/** A route parameter as Wheelhouse names projects and plugins; never `..`, `%` or a slash. */
const ID = '[A-Za-z0-9][A-Za-z0-9._-]*';
const route = (pattern: string) => new RegExp(`^${pattern.replaceAll(':id', ID)}$`);

export interface AgentRoute {
	method: 'POST' | 'PUT';
	/** The route, as src/routes/api names it, with :id for a parameter. */
	path: string;
	pattern: RegExp;
}

const agent = (method: AgentRoute['method'], path: string): AgentRoute => ({
	method,
	path,
	pattern: route(path)
});

/** What the agent token may change. */
export const AGENT_ROUTES: readonly AgentRoute[] = [
	agent('POST', '/api/plugins/:id/config'),
	agent('POST', '/api/plugins/roles'),
	agent('POST', '/api/plugins/inspect'),
	agent('POST', '/api/plugins/install'),
	agent('POST', '/api/plugins/:id/update'),
	agent('POST', '/api/plugins/:id/load'),
	agent('POST', '/api/services'),
	agent('POST', '/api/projects/:id/passage/draft'),
	agent('PUT', '/api/projects/:id/passage/file'),
	agent('POST', '/api/wheelhouse/update'),
	agent('POST', '/api/wheelhouse/upgrade'),
	agent('POST', '/api/wheelhouse/source')
];

export interface CaptainRoute {
	/** The route, as src/routes/api names it, with :id for a parameter. */
	path: string;
	pattern: RegExp;
	/** The page where the captain makes this call, from the route's parameters. */
	page: (params: string[]) => string;
}

const captain = (path: string, page: CaptainRoute['page']): CaptainRoute => ({
	path,
	// Captain-only routes match any parameter, so a stranger spelling never slips past to "not open".
	pattern: new RegExp(`^${path.replaceAll(':id', '([^/]+)')}$`),
	page
});

/** The captain's own calls: the agent token is refused here with where to make them. */
export const CAPTAIN_ONLY: readonly CaptainRoute[] = [
	captain('/api/projects/:id/passage/consent', ([id]) => `/projects/${id}/passage`),
	captain('/api/projects/:id/passage/commands', ([id]) => `/projects/${id}/passage`),
	captain('/api/projects/:id/passage/test', ([id]) => `/projects/${id}/passage/edit`),
	captain('/api/cloud', () => '/settings/cloud'),
	captain('/api/fleet/membership', () => '/settings/fleet'),
	captain('/api/setup', () => '/setup'),
	captain('/api/vault', () => '/settings/plugins/vault'),
	captain('/api/inbox', () => '/inbox'),
	captain('/api/inbox/following', () => '/inbox'),
	captain('/api/inbox/talk', () => '/inbox'),
	captain('/api/firstmate/input', () => '/'),
	captain('/api/firstmate/pick', () => '/'),
	captain('/api/firstmate/dismiss', () => '/'),
	captain('/api/firstmate/interrupt', () => '/'),
	captain('/api/firstmate/messages', () => '/'),
	captain('/api/apps/:id', () => '/'),
	captain('/api/second-mate-setup', () => '/second-mates/add'),
	captain('/api/second-mates/:id/link', () => '/second-mates')
];

const KEY = Symbol.for('wheelhouse.agent-token');
const g = globalThis as unknown as Record<symbol, string | undefined>;

/** Left by the CLI's server (`wheelhouse open`): the token its running record holds. */
export function setAgentToken(token: string | null): void {
	g[KEY] = token ?? undefined;
}

function tokenMatches(given: string): boolean {
	const want = g[KEY];
	if (!want) return false;
	const a = Buffer.from(given);
	const b = Buffer.from(want);
	return a.length === b.length && timingSafeEqual(a, b);
}

/** The captain-only route a path is, with the page where the captain makes that call. */
export function captainPage(pathname: string): string | null {
	for (const c of CAPTAIN_ONLY) {
		const m = c.pattern.exec(pathname);
		if (m) return c.page(m.slice(1));
	}
	return null;
}

export const agentRoute = (method: string, pathname: string): AgentRoute | null =>
	AGENT_ROUTES.find((r) => r.method === method.toUpperCase() && r.pattern.test(pathname)) ?? null;

export type AgentDecision =
	{ ok: true } | { ok: false; status: 403; message: string; captain?: string };

/**
 * How a mutating request with an Authorization header is answered: null when
 * it has none (the page's checks apply), else whether the agent token lets it
 * through. `origin` is this server's own, for the captain's page link.
 */
export function agentDecision(
	request: Request,
	pathname: string,
	origin: string
): AgentDecision | null {
	const header = request.headers.get(AGENT_HEADER);
	// A page's request (it sends an Origin) or one through Wheelhouse Cloud is the page's to
	// prove with the session token, whatever Authorization it carries.
	if (header === null || request.headers.get('origin') !== null || viaRelay(request)) return null;
	const refuse = (message: string) => ({ ok: false as const, status: 403 as const, message });
	const token = /^Bearer ([A-Za-z0-9._~+/=-]+)$/.exec(header)?.[1];
	if (!token) return refuse('Send the agent token as Authorization: Bearer <token>.');
	if (!tokenMatches(token)) {
		return refuse('The agent token is not this Wheelhouse’s. Find it again and retry.');
	}
	const page = captainPage(pathname);
	if (page) {
		const url = `${origin}${page}`;
		return { ok: false, status: 403, message: `captain action: open ${url}`, captain: url };
	}
	if (!agentRoute(request.method, pathname)) {
		return refuse(`${request.method} ${pathname} is not open to the agent token.`);
	}
	return { ok: true };
}
