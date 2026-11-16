import { json } from '@sveltejs/kit';
import { NO_STORE } from '$lib/server/http';
import { liveSession } from '$lib/server/live/sessions';
import type { RequestHandler } from './$types';

const HEARTBEAT_MS = 15_000;

/** Server-sent events for one discussion: the crew's reply as it streams (`delta`), `tool`, `done`, `gone`. */
export const GET: RequestHandler = async ({ params, request }) => {
	const session = liveSession(params.id);
	if (!session) return json({ message: 'No such discussion.' }, { status: 404, headers: NO_STORE });
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
			send('retry: 2000\n\n');
			const off = session.crew.on((e) => send(`data: ${JSON.stringify(e)}\n\n`));
			const heartbeat = setInterval(() => send(': keep-alive\n\n'), HEARTBEAT_MS);
			cleanup = () => {
				if (closed) return;
				closed = true;
				clearInterval(heartbeat);
				off();
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
