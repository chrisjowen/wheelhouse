import type { BridgeMessage } from '$lib/types';

/** The header that carries this launch's session token on mutating requests. */
export const SESSION_HEADER = 'x-wheelhouse-session';

export type PostResult =
	{ ok: true; message: BridgeMessage } | { ok: false; reachable: boolean; error: string };

/**
 * Send a message to Firstmate through Wheelhouse. The request id is the
 * Idempotency-Key: calling this again with the same id and text is a safe
 * retry that returns the original message instead of sending another.
 */
export async function postMessage(
	input: { requestId: string; text: string; taskId: string | null },
	sessionToken: string
): Promise<PostResult> {
	let res: Response;
	try {
		res = await fetch('/api/firstmate/messages', {
			method: 'POST',
			headers: {
				'content-type': 'application/json',
				'idempotency-key': input.requestId,
				[SESSION_HEADER]: sessionToken
			},
			body: JSON.stringify({ text: input.text, taskId: input.taskId })
		});
	} catch {
		return { ok: false, reachable: false, error: 'Could not reach the Wheelhouse server.' };
	}
	const body = await res.json().catch(() => null);
	if (res.ok && body?.message?.requestId) return { ok: true, message: body.message };
	return {
		ok: false,
		reachable: true,
		error: typeof body?.message === 'string' ? body.message : `Wheelhouse answered ${res.status}.`
	};
}
