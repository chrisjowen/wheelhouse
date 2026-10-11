import { error, json } from '@sveltejs/kit';
import { getRuntime } from '$lib/server/runtime';
import { WORKTREE_GONE } from '$lib/server/firstmate/evidence';
import type { FileDiff } from '$lib/types';
import type { RequestHandler } from './$types';

const MAX_PATH = 1024;

/**
 * One changed file's unified diff from the task worktree, read-only and
 * bounded. Only a path in the task's changed-files list is read; when the
 * worktree is gone the answer says so instead of failing.
 */
export const GET: RequestHandler = async ({ params, url }) => {
	const runtime = await getRuntime();
	if (!runtime.configured) error(503, runtime.error);
	const file = url.searchParams.get('path') ?? '';
	if (!file || file.length > MAX_PATH) error(400, 'Say which file with ?path=.');
	const task = runtime.collector.getFleet().tasks.find((t) => t.id === params.id);
	if (!task) error(404, `There is no task called ${params.id}.`);

	const row = runtime.collector.row(task.id);
	const worktree = row?.worktree.present ? row.worktree.path : null;
	const diff: FileDiff = worktree
		? await runtime.evidence.fileDiff(worktree, file)
		: { available: false, reason: WORKTREE_GONE };
	return json(diff, { headers: { 'cache-control': 'no-store' } });
};
