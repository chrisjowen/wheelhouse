import { json } from '@sveltejs/kit';
import { NO_STORE, readJson } from '$lib/server/http';
import { setupService, type ActionResult } from '$lib/server/setup/service';
import { refusesSetup } from '$lib/server/setup/terminal';
import type { RequestHandler } from './$types';

/**
 * The setup wizard's requests. GET is the wizard's view; POST `{ action, … }`
 * does one step's work (changes need the page's session token, as every
 * change does: hooks.server.ts). Both answer only a caller on this computer,
 * never one reaching it through Wheelhouse Cloud.
 *
 *   inspect { dir }        what is at a folder: new, empty, Firstmate, or occupied
 *   clone { dir }          clone Firstmate to a new or empty folder, and use it
 *   use { dir }            use a Firstmate checkout already there
 *   tools                  Firstmate's own bootstrap check
 *   install { tool }       a tool's one-click install, as Firstmate's check gives it
 *   claude                 Claude Code's status
 *   claude-install         install Claude Code with npm
 *   claude-test            the tiny non-interactive test (closes the sign-in terminal)
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
	refusesSetup(address, request.headers.get('x-wheelhouse-remote'));

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
		case 'clone': {
			const dir = text('dir');
			return dir === null ? refuse('Say which folder.') : answer(await s.clone(dir));
		}
		case 'use': {
			const dir = text('dir');
			return dir === null ? refuse('Say which folder.') : answer(await s.use(dir));
		}
		case 'tools':
			return answer(await s.tools());
		case 'install': {
			const tool = text('tool');
			return tool === null ? refuse('Say which tool.') : answer(await s.installTool(tool));
		}
		case 'claude':
			return ok(await s.claude());
		case 'claude-install':
			return answer(await s.installClaude());
		case 'claude-test':
			return answer(await s.testClaude());
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
