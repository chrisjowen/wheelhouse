import {
	currentMessages,
	getRuntime,
	unconfiguredFleet,
	unconfiguredHealth
} from '$lib/server/runtime';
import type { CollectorEvent } from '$lib/server/collector/collector';
import type { BellEvent } from '$lib/server/bell/bell';
import type { ShipAlert } from '$lib/types';
import type { RequestHandler } from './$types';

const HEARTBEAT_MS = 15_000;

/**
 * Server-sent events: the current fleet, health, messages and recent ship's
 * bell alerts (`alerts`) on connect, then fleet and health every collector
 * round, messages whenever they change, each new alert (`alert`) as the bell
 * raises it, and the id of a session question once it is answered
 * (`settled`). A browser opens one of these and its tabs share it (see
 * lib/client/live.svelte.ts).
 */
export const GET: RequestHandler = async ({ request }) => {
	const runtime = await getRuntime();
	const messages = await currentMessages();
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
			const event = (e: CollectorEvent | BellEvent | { type: 'alerts'; data: ShipAlert[] }) =>
				send(`event: ${e.type}\ndata: ${JSON.stringify(e.data)}\n\n`);

			send('retry: 3000\n\n');
			if (runtime.configured) {
				event({ type: 'fleet', data: runtime.collector.getFleet() });
				event({ type: 'health', data: runtime.collector.health() });
				event({ type: 'alerts', data: runtime.bell.recent() });
			} else {
				event({ type: 'fleet', data: unconfiguredFleet(runtime.error) });
				event({ type: 'health', data: unconfiguredHealth(runtime.error) });
			}
			event({ type: 'messages', data: messages });
			const unsubscribe = runtime.configured ? runtime.collector.subscribe(event) : () => {};
			const unring = runtime.configured ? runtime.bell.subscribe(event) : () => {};
			const heartbeat = setInterval(() => send(': keep-alive\n\n'), HEARTBEAT_MS);
			cleanup = () => {
				if (closed) return;
				closed = true;
				clearInterval(heartbeat);
				unsubscribe();
				unring();
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
