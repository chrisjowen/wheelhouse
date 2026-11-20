import { json } from '@sveltejs/kit';
import { getRuntime } from '$lib/server/runtime';
import { NO_STORE, readJson } from '$lib/server/http';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async () => {
	const r = await getRuntime();
	if (!r.configured) return json({ message: r.error }, { status: 503, headers: NO_STORE });
	if (!r.events || !r.eventsConnection)
		return json({ message: 'Not found' }, { status: 404, headers: NO_STORE });
	return json(
		{ ...(await r.events.view()), ...(await r.eventsConnection.view()) },
		{ headers: NO_STORE }
	);
};
/** hooks.server.ts checks Origin and the per-launch session token; cloud sessions are signature-checked by the connector. */
export const POST: RequestHandler = async ({ request }) => {
	const r = await getRuntime();
	if (!r.configured) return json({ message: r.error }, { status: 503, headers: NO_STORE });
	if (!r.events || !r.eventsConnection)
		return json({ message: 'Not found' }, { status: 404, headers: NO_STORE });
	const read = await readJson(request, 32768);
	if (!read.ok) return read.response;
	try {
		if (!r.events.store) throw new Error(r.events.problem!);
		if (read.body.action === 'connect') {
			const access = await r.events.store.accessProblem();
			if (access) throw new Error(access);
			if (read.body.trustSameUserCode !== true || read.body.artifactReferences !== true)
				throw new Error('Confirm trusted same-user code and artifact-reference consent.');
			await r.eventsConnection.connect(r.events.store.outbox);
		} else if (read.body.action === 'disconnect') await r.eventsConnection.disconnect();
		else await r.events.change(read.body);
		return json(
			{ ...(await r.events.view()), ...(await r.eventsConnection.view()) },
			{ headers: NO_STORE }
		);
	} catch (e) {
		return json({ message: (e as Error).message }, { status: 400, headers: NO_STORE });
	}
};
