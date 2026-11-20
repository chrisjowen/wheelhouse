import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { EventsStore } from './store';
import { HOUR, renderBatch } from './pipeline';

/** Request identity advances only after Firstmate's durable capture. Never consume on first poll. */
export async function poll(store: EventsStore, requestId: string, waitMs = 55000) {
	const end = Date.now() + waitMs;
	do {
		const problem = await store.accessProblem();
		const output = await store.change((s) => {
			if (s.delivery?.requestId === requestId && s.delivery.output) return s.delivery.output;
			if (problem || s.settings.paused || s.settings.source.paused) return null;
			if (s.delivery?.batchId) {
				const previous = s.batches.find((b) => b.id === s.delivery!.batchId);
				if (previous) previous.capturedAt = new Date().toISOString();
			}
			// Enforce the delivery cap as well as the creation cap, including a backlog after downtime.
			if (
				s.batches.filter((b) => b.capturedAt && Date.parse(b.capturedAt) > Date.now() - HOUR)
					.length >= 12
			) {
				s.delivery = { requestId, batchId: null, output: null };
				return null;
			}
			const batch = s.batches.find((b) => !b.capturedAt);
			if (!batch) {
				s.delivery = { requestId, batchId: null, output: null };
				return null;
			}
			const rendered = renderBatch(s, batch);
			s.delivery = { requestId, batchId: batch.id, output: rendered };
			return rendered;
		});
		if (output) return { status: 'result', output };
		if (Date.now() >= end) break;
		await delay(Math.min(500, end - Date.now()));
	} while (Date.now() <= end);
	return { status: 'no-result', output: '' };
}

export async function protocol(verb: string, req: Record<string, unknown>) {
	if (verb === 'handshake') {
		if (
			req.schema !== 'firstmate.extension-handshake-request.v1' ||
			req.extension_id !== 'io.wheelhouse.events'
		)
			throw new Error('Invalid handshake.');
		return {
			schema: 'firstmate.extension-handshake-response.v1',
			request_id: req.request_id,
			extension_id: req.extension_id,
			extension_version: req.extension_version,
			host_protocol: 1,
			capability: 'process-event-adapter',
			capability_version: 1,
			adapter_names: ['wheelhouse-events']
		};
	}
	if (
		verb !== 'invoke' ||
		req.schema !== 'firstmate.extension-request.v1' ||
		req.extension_id !== 'io.wheelhouse.events' ||
		req.host_protocol !== 1 ||
		req.capability !== 'process-event-adapter' ||
		req.capability_version !== 1 ||
		req.adapter !== 'wheelhouse-events' ||
		typeof req.request_id !== 'string' ||
		!/^sha256:[a-f0-9]{64}$/.test(req.request_id)
	)
		throw new Error('Invalid request.');
	const input = req.input as Record<string, unknown>;
	if (!input || input.source_id !== 'wh-events') throw new Error('Invalid source.');
	let result: unknown;
	switch (req.operation) {
		case 'source.poll': {
			if (typeof input.config_ref !== 'string' || !path.isAbsolute(input.config_ref))
				throw new Error('Invalid outbox reference.');
			const store = new EventsStore(input.config_ref);
			await store.initialize();
			result = await poll(store, req.request_id);
			break;
		}
		case 'result.classify': {
			const match =
				typeof input.content === 'string' &&
				/^wheelhouse-events\.v1 (notify|digest|paused-notice) notify-only /.exec(input.content);
			result = { classification: match ? match[1] : 'notify' };
			break;
		}
		case 'result.silent':
			result = { value: input.content === '' };
			break;
		case 'result.terminal':
			result = { value: false };
			break;
		default:
			throw new Error('Unknown operation.');
	}
	return {
		schema: 'firstmate.extension-response.v1',
		request_id: req.request_id,
		ok: true,
		result,
		error: null
	};
}
