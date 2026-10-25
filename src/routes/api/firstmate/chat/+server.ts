import { getRuntime, unavailableFirstmate } from '$lib/server/runtime';
import type { FeedEvent } from '$lib/server/sessions/transcript';
import type { RequestHandler } from './$types';

const HEARTBEAT_MS = 15_000;

/**
 * Server-sent events for the chat: `session` (where the Firstmate session
 * stands), `reset` (which transcript is followed; the page starts over), and
 * `records` (transcript records, oldest first, as they are written).
 */
export const GET: RequestHandler = async ({ request }) => {
	const runtime = await getRuntime();
	const encoder = new TextEncoder();
	let cleanup = () => {};

	const stream = new ReadableStream<Uint8Array>({
		start(controller) {
			let closed = false;
			const send = (chunk: string) => {
				if (closed) return;
				try {
					controller.enqueue(encoder.encode(chunk));
				} catch {
					cleanup();
				}
			};
			const event = (e: FeedEvent) => send(`event: ${e.type}\ndata: ${JSON.stringify(e.data)}\n\n`);

			send('retry: 3000\n\n');
			const unsubscribe = runtime.configured
				? runtime.chat.subscribe(event)
				: (event({ type: 'session', data: unavailableFirstmate(runtime.error) }), () => {});
			const heartbeat = setInterval(() => send(': keep-alive\n\n'), HEARTBEAT_MS);
			cleanup = () => {
				if (closed) return;
				closed = true;
				clearInterval(heartbeat);
				unsubscribe();
				try {
					controller.close();
				} catch {
					// already closed
				}
			};
			request.signal.addEventListener('abort', () => cleanup());
		},
		cancel() {
			cleanup();
		}
	});

	return new Response(stream, {
		headers: {
			'content-type': 'text/event-stream; charset=utf-8',
			'cache-control': 'no-store',
			connection: 'keep-alive',
			'x-accel-buffering': 'no'
		}
	});
};
