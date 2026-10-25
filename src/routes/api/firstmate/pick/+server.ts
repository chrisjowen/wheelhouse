import { json } from '@sveltejs/kit';
import { getRuntime } from '$lib/server/runtime';
import { NO_STORE, readJson } from '$lib/server/http';
import type { RequestHandler } from './$types';

/**
 * Choose in the menu Claude Code is waiting on in the Firstmate session (its
 * question picker, a permission prompt): `{ signature, press: n }` for an
 * option, or `{ signature, submit: true }` to submit a multi-choice question.
 * `signature` is the menu the page showed; nothing is pressed into a
 * different one. Guarded in hooks.server.ts.
 */
export const POST: RequestHandler = async ({ request }) => {
	const runtime = await getRuntime();
	if (!runtime.configured) {
		return json({ message: runtime.error }, { status: 503, headers: NO_STORE });
	}
	const read = await readJson(request, 4 * 1024);
	if (!read.ok) return read.response;
	const { signature, press, submit } = read.body;
	const action =
		submit === true
			? { submit: true as const }
			: Number.isInteger(press)
				? { press: press as number }
				: null;
	if (typeof signature !== 'string' || !action) {
		return json({ message: 'The choice is not valid.' }, { status: 400, headers: NO_STORE });
	}
	const r = await runtime.firstmate.pick(signature, action);
	if (!r.ok) return json({ message: r.error }, { status: r.status, headers: NO_STORE });
	void runtime.chat.refresh();
	setTimeout(() => void runtime.chat.refresh(), 700);
	return json({ picked: true }, { headers: NO_STORE });
};
