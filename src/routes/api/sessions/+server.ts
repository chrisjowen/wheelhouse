import { json } from '@sveltejs/kit';
import { currentSessions, getRuntime } from '$lib/server/runtime';
import { UNASSIGNED } from '$lib/server/firstmate/model';
import { validateLaunch } from '$lib/server/sessions/sessions';
import type { RequestHandler } from './$types';

const headers = { 'cache-control': 'no-store' };
const MAX_REQUEST_BYTES = 32 * 1024;

/** The captain's own Claude Code sessions, newest first, with whether each is still running. */
export const GET: RequestHandler = async () => json(await currentSessions(), { headers });

/**
 * Start a new session: `{ projectId?, prompt? }`. Wheelhouse starts `claude` in
 * a detached tmux session, which the captain uses through the session page's
 * live terminal (`/api/sessions/:id/terminal`). The project
 * must be one Wheelhouse knows; its path comes from Firstmate, never from the
 * request. Origin and session token are checked in hooks.server.ts.
 */
export const POST: RequestHandler = async ({ request }) => {
	const runtime = await getRuntime();
	if (!runtime.configured) return json({ message: runtime.error }, { status: 503, headers });
	if (!(request.headers.get('content-type') ?? '').includes('application/json')) {
		return json({ message: 'Send the request as JSON.' }, { status: 415, headers });
	}
	const raw = await request.text();
	if (Buffer.byteLength(raw) > MAX_REQUEST_BYTES) {
		return json({ message: 'The request is too large.' }, { status: 413, headers });
	}
	let body: unknown;
	try {
		body = JSON.parse(raw);
	} catch {
		return json({ message: 'The request is not valid JSON.' }, { status: 400, headers });
	}
	const fields = (typeof body === 'object' && body !== null ? body : {}) as Record<string, unknown>;
	const projects = runtime.collector
		.getFleet()
		.projects.filter((p) => p.id !== UNASSIGNED)
		.map((p) => ({ id: p.id, name: p.name, path: p.path }));
	const valid = validateLaunch(fields, projects);
	if (!valid.ok) return json({ message: valid.error }, { status: valid.status, headers });

	const r = await runtime.sessions.launch(valid.input);
	if (!r.ok) return json({ message: r.error }, { status: r.status, headers });
	return json({ session: r.session, warning: r.warning }, { status: 201, headers });
};
