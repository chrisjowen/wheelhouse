import { json, type Handle, type ServerInit } from '@sveltejs/kit';
import { getRuntime } from '$lib/server/runtime';
import { cleanUploads, uploadsDir } from '$lib/server/uploads';
import { oldTaskLink } from '$lib/server/oldlinks';
import { isMutating, LOOPBACK_HOST, refuseMutation, servedOrigin } from '$lib/server/session';
import { opensSetup } from '$lib/server/setup/redirect';
import { cloudSignInPending } from '$lib/server/setup/cloud';
import { featureForPath, featureSettings } from '$lib/server/features';
import { remoteStarter } from '$lib/server/cloud/starter';
import { relayResponse } from '$lib/server/cloud/remote';
import { agentDecision } from '$lib/server/agentauth';

// Start the shared collector as soon as the server boots, not on the first request,
// delete chat attachments past their keeping time, and resume a configured Gateway pairing.
export const init: ServerInit = async () => {
	void cleanUploads(uploadsDir(process.env));
	if ((await featureSettings()).remotes) void remoteStarter().resume();
	await getRuntime();
};

// Wheelhouse only listens on loopback; any other Host means a DNS-rebinding page.
// Anything that changes state must also come from the served origin with this
// launch's session token (see lib/server/session.ts), or, for the routes open to
// agents, carry the agent token instead (lib/server/agentauth.ts).
export const handle: Handle = async ({ event, resolve }) => {
	const host = event.request.headers.get('host') ?? '';
	if (!LOOPBACK_HOST.test(host)) {
		return new Response('Misdirected request', { status: 421 });
	}
	if (isMutating(event.request.method)) {
		const origin = servedOrigin(event.request);
		const agent = agentDecision(event.request, event.url.pathname, origin);
		if (agent && !agent.ok) {
			return json({ message: agent.message, captain: agent.captain }, { status: agent.status });
		}
		const refused = agent ? null : refuseMutation(event.request, origin);
		if (refused) return json({ message: refused }, { status: 403 });
	}
	const flags = await featureSettings();
	const feature = featureForPath(event.url.pathname);
	if (feature && !flags[feature]) {
		return new Response('Not found', { status: 404 });
	}
	const moved = oldTaskLink(event);
	if (moved) return new Response(null, { status: 307, headers: { location: moved } });
	// No Firstmate yet, or a cloud machine's agent not signed in yet: a page opens the setup wizard instead.
	if (
		opensSetup(event.request, event.url.pathname) &&
		(!(await getRuntime()).configured || cloudSignInPending(process.env))
	) {
		return new Response(null, { status: 307, headers: { location: '/setup' } });
	}
	// Through Wheelhouse Cloud, a redirect to an address on this computer goes to it on the relay.
	return relayResponse(event.request, await resolve(event));
};
