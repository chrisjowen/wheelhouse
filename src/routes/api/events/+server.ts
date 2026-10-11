import { getRuntime, unconfiguredFleet, unconfiguredHealth } from '$lib/server/runtime';
import type { CollectorEvent } from '$lib/server/collector/collector';
import type { RequestHandler } from './$types';

const HEARTBEAT_MS = 15_000;

/** Server-sent events: the current fleet and health on connect, then every collector round. */
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
			const event = (e: CollectorEvent) =>
				send(`event: ${e.type}\ndata: ${JSON.stringify(e.data)}\n\n`);

			send('retry: 3000\n\n');
			if (runtime.configured) {
				event({ type: 'fleet', data: runtime.collector.getFleet() });
				event({ type: 'health', data: runtime.collector.health() });
			} else {
				event({ type: 'fleet', data: unconfiguredFleet(runtime.error) });
				event({ type: 'health', data: unconfiguredHealth(runtime.error) });
			}
			const unsubscribe = runtime.configured ? runtime.collector.subscribe(event) : () => {};
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
