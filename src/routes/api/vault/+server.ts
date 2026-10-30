import { json } from '@sveltejs/kit';
import { NO_STORE, readJson } from '$lib/server/http';
import { getRuntime } from '$lib/server/runtime';
import { MAX_VALUE_BYTES, parseChange } from '$lib/server/vault';
import type { RequestHandler } from './$types';

/** A name, a value at its longest, a few project names and the JSON around them. */
const MAX_REQUEST_BYTES = MAX_VALUE_BYTES * 6 + 8 * 1024;

/**
 * Change the vault from its page: `{ action: 'set', name, value, projects? }`
 * stores a value (granting it to `projects` too), `grant` and `revoke` take
 * `name` and `projects`, `remove` takes `name`. Origin and session token are
 * checked in hooks.server.ts. The answer says what happened and lists names,
 * grants and dates; it never holds the value, and nothing here logs the request.
 */
export const POST: RequestHandler = async ({ request }) => {
	const runtime = await getRuntime();
	if (!runtime.configured)
		return json({ message: runtime.error }, { status: 503, headers: NO_STORE });
	const read = await readJson(request, MAX_REQUEST_BYTES);
	if (!read.ok) return read.response;
	const known = new Set(runtime.collector.getFleet().projects.map((p) => p.id));
	const parsed = parseChange(read.body, known);
	if (!parsed.ok) return json({ message: parsed.message }, { status: 400, headers: NO_STORE });
	const r = await runtime.vault.change(parsed.change);
	// Whatever happened, the Vault plugin's pages read the vault afresh.
	runtime.plugins.forget('vault');
	if (!r.ok) return json({ message: r.message }, { status: r.status, headers: NO_STORE });
	return json(
		{ message: r.message, secrets: r.secrets, observedAt: r.observedAt },
		{ headers: NO_STORE }
	);
};
