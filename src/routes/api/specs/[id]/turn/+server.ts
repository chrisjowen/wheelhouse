import { json } from '@sveltejs/kit';
import { NO_STORE, readJson } from '$lib/server/http';
import { notFound, specInterviewer, specStoreOrResponse } from '$lib/server/specs/access';
import type { RequestHandler } from './$types';

/**
 * One turn of the spec interview: `{ answer }` is what the captain said (left
 * out to have the agent address new comments, or to try a failed turn again).
 * Streams server-sent events: `text` (the agent's message as it is written),
 * `reset` (it started its message over), `tool` (it read part of the
 * project), then `done` with the saved draft or `error` with why. The turn
 * finishes and is saved even if the page goes away meanwhile.
 * Origin and session token are checked in hooks.server.ts.
 */
export const POST: RequestHandler = async ({ params, request }) => {
	const store = await specStoreOrResponse();
	if (store instanceof Response) return store;
	const read = await readJson(request, 64 * 1024);
	if (!read.ok) return read.response;
	const answer = typeof read.body.answer === 'string' ? read.body.answer : null;
	if (!(await store.get(params.id))) return notFound();
	const interviewer = specInterviewer(store);
	if (interviewer.isBusy(params.id)) {
		return json(
			{ message: 'The interviewer is already working on this spec.' },
			{ status: 409, headers: NO_STORE }
		);
	}

	const encoder = new TextEncoder();
	const stream = new ReadableStream<Uint8Array>({
		start(controller) {
			let open = true;
			const send = (event: string, data: unknown) => {
				if (!open) return;
				try {
					controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
				} catch {
					open = false;
				}
			};
			void interviewer
				.turn(params.id, answer, (e) => send(e.type, e))
				.then((r) =>
					r.ok
						? send('done', { draft: r.draft })
						: send('error', { message: r.message, draft: r.draft })
				)
				.catch((err: unknown) =>
					send('error', { message: err instanceof Error ? err.message : String(err), draft: null })
				)
				.finally(() => {
					if (!open) return;
					open = false;
					try {
						controller.close();
					} catch {
						// already closed
					}
				});
		},
		cancel() {
			// The page went away; the turn carries on and is saved.
		}
	});
	return new Response(stream, {
		headers: {
			'content-type': 'text/event-stream; charset=utf-8',
			'cache-control': 'no-store',
			'x-accel-buffering': 'no'
		}
	});
};
