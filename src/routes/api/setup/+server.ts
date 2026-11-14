import { json } from '@sveltejs/kit';
import { NO_STORE, readJson } from '$lib/server/http';
import { isAgentAuth, isAgentProvider, isSetupAgent } from '$lib/agent';
import { setupService, type ActionResult } from '$lib/server/setup/service';
import { setupRefuses } from '$lib/server/setup/terminal';
import type { RequestHandler } from './$types';

/**
 * The setup wizard's requests. GET is the wizard's view; POST `{ action, … }`
 * does one step's work (changes need the page's session token, as every
 * change does: hooks.server.ts). Both answer only a caller on this computer,
 * never one reaching it through Wheelhouse Cloud, except on a cloud machine
 * (see setup/cloud.ts).
 *
 *   inspect { dir }        what is at a folder: new, empty, Firstmate, or occupied
 *   get-firstmate          clone Firstmate to ~/firstmate and use it (or use the one already there)
 *   clone { dir }          clone Firstmate to a new or empty folder, and use it
 *   use { dir }            use a Firstmate checkout already there
 *   session-backend { backend }  what runs the Firstmate session: tmux, herdr, or null to follow Firstmate
 *   tools                  Firstmate's own bootstrap check
 *   install { tool }       a tool's one-click install, as Firstmate's check gives it
 *   agent-choose { agent, auth, provider }  the agent Firstmate runs in, and how it is paid for
 *   agent                  the chosen agent's status (also `claude`, its older name)
 *   agent-install          install the chosen agent with npm (also `claude-install`)
 *   agent-test             the tiny non-interactive test; closes the sign-in terminal (also `claude-test`)
 *   agent-key { value, replace? }  the chosen agent's API key: kept in the vault as WHEELHOUSE_AGENT_…,
 *                          and the agent signed in with it; a name already there is kept
 *                          (answered `exists: true`) unless `replace` is true
 *   check                  Firstmate's own checks and Wheelhouse's
 *   plugins                the plugins to suggest
 *   plugin { id, on }      turn a bundled plugin on or off for every project
 *   finish                 start Firstmate
 */

const refuse = (message: string, status = 400) => json({ message }, { status, headers: NO_STORE });
const answer = <T>(r: ActionResult<T>) =>
	r.ok ? json(r.value, { headers: NO_STORE }) : refuse(r.error, 409);
const ok = <T>(value: T) => json(value, { headers: NO_STORE });

const away = (request: Request, address: string) =>
	setupRefuses(address, request.headers.get('x-wheelhouse-remote'));

export const GET: RequestHandler = async ({ request, getClientAddress }) => {
	if (away(request, getClientAddress())) return refuse('Setup only runs on this computer.', 403);
	return ok(await setupService().view());
};

export const POST: RequestHandler = async ({ request, getClientAddress }) => {
	if (away(request, getClientAddress())) return refuse('Setup only runs on this computer.', 403);
	const body = await readJson(request, 16 * 1024);
	if (!body.ok) return body.response;
	const b = body.body;
	const text = (k: string) => (typeof b[k] === 'string' ? (b[k] as string) : null);
	const s = setupService();
	switch (b.action) {
		case 'inspect': {
			const dir = text('dir');
			return dir === null ? refuse('Say which folder.') : ok(s.inspect(dir));
		}
		case 'get-firstmate':
			return answer(await s.getFirstmate());
		case 'clone': {
			const dir = text('dir');
			return dir === null ? refuse('Say which folder.') : answer(await s.clone(dir));
		}
		case 'use': {
			const dir = text('dir');
			return dir === null ? refuse('Say which folder.') : answer(await s.use(dir));
		}
		case 'session-backend': {
			const backend = b.backend;
			if (backend !== null && backend !== 'tmux' && backend !== 'herdr')
				return refuse('Say tmux, herdr, or null to follow Firstmate.');
			return answer(await s.chooseBackend(backend));
		}
		case 'tools':
			return answer(await s.tools());
		case 'install': {
			const tool = text('tool');
			return tool === null ? refuse('Say which tool.') : answer(await s.installTool(tool));
		}
		case 'agent-choose': {
			const { agent, auth, provider } = b;
			if (
				!isSetupAgent(agent) ||
				!isAgentAuth(auth) ||
				!(provider === null || isAgentProvider(provider))
			)
				return refuse('Say which agent, and how it is paid for.');
			return answer(await s.chooseAgent({ agent, auth, provider }));
		}
		case 'agent':
		case 'claude':
			return ok(await s.agentStatus());
		case 'agent-install':
		case 'claude-install':
			return answer(await s.installAgent());
		case 'agent-test':
		case 'claude-test':
			return answer(await s.testAgent());
		case 'agent-key': {
			const value = text('value');
			return value === null
				? refuse('Paste the API key.')
				: answer(await s.agentKey(value, b.replace === true));
		}
		case 'check':
			return answer(await s.check());
		case 'plugins':
			return ok(await s.plugins());
		case 'plugin': {
			const id = text('id');
			if (id === null || typeof b.on !== 'boolean')
				return refuse('Say which plugin, and on or off.');
			return answer(await s.switchPlugin(id, b.on));
		}
		case 'finish':
			return answer(await s.finish());
		default:
			return refuse('Unknown setup action.');
	}
};
