import { error, json } from '@sveltejs/kit';
import { getRuntime } from '$lib/server/runtime';
import { PEEK_DEFAULT_LINES, PEEK_MAX_LINES } from '$lib/server/firstmate/adapter';
import type { TaskOutput } from '$lib/types';
import type { RequestHandler } from './$types';

const DEDUPE_MS = 2_000;
const recent = new Map<string, { at: number; value: Promise<TaskOutput> }>();

/**
 * Bounded, read-only worker terminal output via fm-peek.sh. Output is sampled
 * only when this endpoint is called, which the UI does only while a task's
 * output inspector is open. Concurrent viewers share one sample.
 */
export const GET: RequestHandler = async ({ params, url }) => {
	const runtime = await getRuntime();
	if (!runtime.configured) error(503, runtime.error);
	const task = runtime.collector.getFleet().tasks.find((t) => t.id === params.id);
	if (!task) error(404, `There is no task called ${params.id}.`);

	const asked = Number(url.searchParams.get('lines') ?? PEEK_DEFAULT_LINES);
	const lines = Math.min(
		PEEK_MAX_LINES,
		Math.max(1, Number.isFinite(asked) ? Math.floor(asked) : PEEK_DEFAULT_LINES)
	);
	const headers = { 'cache-control': 'no-store' };

	if (!task.outputAvailable) {
		const out: TaskOutput = {
			available: false,
			reason: task.outputNote ?? 'No terminal is available for this task.',
			lines: [],
			capturedAt: null,
			requested: lines
		};
		return json(out, { headers });
	}

	const key = `${task.id}:${lines}`;
	const hit = recent.get(key);
	if (hit && Date.now() - hit.at < DEDUPE_MS) return json(await hit.value, { headers });
	const value = runtime.adapter.peek(task.id, lines).then((r): TaskOutput =>
		r.ok
			? {
					available: true,
					reason: null,
					lines: r.value.lines,
					capturedAt: r.observedAt,
					requested: lines
				}
			: {
					available: false,
					reason: `Could not read the worker’s terminal: ${r.error.message}`,
					lines: [],
					capturedAt: r.observedAt,
					requested: lines
				}
	);
	recent.set(key, { at: Date.now(), value });
	for (const [k, v] of recent) if (Date.now() - v.at > DEDUPE_MS * 5) recent.delete(k);
	return json(await value, { headers });
};
