import { json } from '@sveltejs/kit';
import { NO_STORE, readJson } from '$lib/server/http';
import { chooseRoleProvider } from '$lib/server/runtime';
import { refuse } from '$lib/server/upgrade/requests';
import { ROLES, type Role } from '$lib/plugins/types';
import type { RequestHandler } from './$types';

/**
 * Choose the plugin for a role, `{ role, provider }`, with `provider` null for
 * Wheelhouse's own built-in. It applies without a restart, and the
 * manage-wheelhouse skill is reinstalled to tell Firstmate. Answers with every
 * role as it now stands.
 */
export const POST: RequestHandler = async ({ request }) => {
	const body = await readJson(request, 4 * 1024);
	if (!body.ok) return body.response;
	const { role, provider } = body.body as { role?: unknown; provider?: unknown };
	if (!ROLES.includes(role as Role)) {
		return refuse(`Name a role Wheelhouse has: ${ROLES.join(', ')}.`);
	}
	if (provider !== null && (typeof provider !== 'string' || !provider)) {
		return refuse('Name the plugin to choose, or null for the built-in.');
	}
	const r = await chooseRoleProvider(role as Role, provider);
	if (!r.ok) return refuse(r.error, r.status);
	return json({ roles: r.roles }, { headers: NO_STORE });
};
