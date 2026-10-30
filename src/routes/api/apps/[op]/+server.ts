import { error, json } from '@sveltejs/kit';
import type { AppCallView, AppOpenView, AppRef } from '$lib/apps/types';
import { NO_STORE, readJson } from '$lib/server/http';
import { getRuntime } from '$lib/server/runtime';
import type { RequestHandler } from './$types';

/**
 * MCP apps (see src/lib/server/apps/host.ts). Every route is a POST, so the
 * Origin and session token checks in hooks.server.ts cover each request that
 * reaches an MCP server; the body names the app's contribution where it shows
 * (`{ plugin, contribution, project?, task? }`):
 *
 * - `open`: the app's HTML, policy, tool and arguments, or its service's status
 * - `run`: Wheelhouse's own call of the app's tool, with the provider's arguments
 * - `call` `{ name, arguments, confirmed? }`: a `tools/call` the app made;
 *   409 with `confirm` when the captain must agree to it first, 403 when
 *   Wheelhouse's policy refuses it
 * - `read` `{ uri }`: a `resources/read` the app made
 *
 * A server that fails or cannot be reached answers 502, with the reason.
 */

const MAX_REQUEST_BYTES = 256 * 1024;

const str = (v: unknown) => (typeof v === 'string' && v ? v : null);

function ref(body: Record<string, unknown>): AppRef {
	const plugin = str(body.plugin);
	const contribution = str(body.contribution);
	if (!plugin || !contribution) error(400, 'Name the plugin and the contribution.');
	return { plugin, contribution, project: str(body.project), task: str(body.task) };
}

export const POST: RequestHandler = async ({ params, request }) => {
	const r = await getRuntime();
	if (!r.configured) return json({ message: r.error }, { status: 503, headers: NO_STORE });
	const read = await readJson(request, MAX_REQUEST_BYTES);
	if (!read.ok) return read.response;
	const body = read.body;
	const at = ref(body);
	const answer = (v: AppOpenView | AppCallView<unknown> | null) => {
		if (!v) error(404, 'No such app here.');
		const status = !('ok' in v) || v.ok ? 200 : v.confirm ? 409 : v.refused ? 403 : 502;
		return json(v, { status, headers: NO_STORE });
	};
	switch (params.op) {
		case 'open':
			return answer(await r.apps.open(at));
		case 'run':
			return answer(await r.apps.run(at));
		case 'call': {
			const name = str(body.name);
			if (!name) error(400, 'Name the tool to call.');
			const args = body.arguments ?? {};
			if (typeof args !== 'object' || args === null || Array.isArray(args)) {
				error(400, 'The arguments must be an object.');
			}
			return answer(
				await r.apps.call(at, name, args as Record<string, unknown>, body.confirmed === true)
			);
		}
		case 'read': {
			const uri = str(body.uri);
			if (!uri) error(400, 'Name the resource to read.');
			return answer(await r.apps.read(at, uri));
		}
		default:
			error(404, 'No such app request.');
	}
};
