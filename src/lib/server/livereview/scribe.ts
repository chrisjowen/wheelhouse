import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
	NOTES_SCHEMA,
	NOTES_SYSTEM,
	PACK_SCHEMA,
	PACK_SYSTEM,
	REPLY_SCHEMA,
	REPLY_SYSTEM,
	notesPrompt,
	packPrompt,
	readAnswer,
	readNotes,
	readPack,
	replyPrompt,
	type Note,
	type Pack,
	type ReplyRequest,
	type ReviewContext
} from '$lib/livereview';
import { parseMateTaskId } from '../firstmate/matetasks';
import { runHelper, type HelperDeps, type HelperFailure } from '../previewhelper';
import { getRuntime } from '../runtime';
import { defaultStateDir } from '../store/store';
import { runBounded } from '../firstmate/exec';
import { which } from '../sessions/tmux';

/**
 * The scribe's side of a live review (see lib/livereview.ts): the task it is
 * about, one `claude -p` run for each round of notes, each answer and the
 * tidied pack (the preview helper's runner: no session, no settings, no
 * tools), and the session's files when the captain sends the pack.
 *
 * Notes and answers use a fast model (`WHEELHOUSE_LIVE_REVIEW_MODEL`, default
 * haiku) so the scribe keeps up with the captain; the pack uses the preview
 * helper's (`WHEELHOUSE_PREVIEW_MODEL`, default sonnet).
 */

const ANSWER_TIMEOUT_MS = 45_000;
const NOTES_TIMEOUT_MS = 90_000;
const SHOT_MAX_BYTES = 3 * 1024 * 1024;

const defaults = (): HelperDeps => ({
	env: process.env,
	run: runBounded,
	fetch,
	find: (name) => which(name, process.env.PATH)
});

type Found = { ok: true; ctx: ReviewContext } | HelperFailure;

/** The task a review is about: its title, project, instructions and preview. */
export async function reviewContext(taskId: string): Promise<Found> {
	const runtime = await getRuntime();
	if (!runtime.configured) return { ok: false, status: 503, error: runtime.error };
	if (parseMateTaskId(taskId)) {
		const m = await runtime.mateTasks.helperContext(taskId);
		if (!m.ok) return m;
		return {
			ok: true,
			ctx: {
				task: { id: m.task.id, title: m.task.title, project: m.task.project },
				url: m.preview,
				brief: null
			}
		};
	}
	const fleet = runtime.collector.getFleet();
	const task = fleet.tasks.find((t) => t.id === taskId);
	if (!task) return { ok: false, status: 404, error: `There is no task called ${taskId}.` };
	if (!task.preview)
		return { ok: false, status: 409, error: 'This task has no preview to review.' };
	return {
		ok: true,
		ctx: {
			task: {
				id: task.id,
				title: task.shortTitle,
				project: fleet.projects.find((p) => p.id === task.projectId)?.name ?? task.projectId
			},
			url: task.preview.url,
			brief: runtime.collector.backlog(task.id)?.body ?? null
		}
	};
}

const fast = (deps: HelperDeps) => deps.env.WHEELHOUSE_LIVE_REVIEW_MODEL || 'haiku';
const unreadable = (what: string): HelperFailure => ({
	ok: false,
	status: 502,
	error: `The scribe’s ${what} could not be read. Try again.`
});

/** A round of notes: the whole list as the scribe now has it. */
export async function takeNotes(
	ctx: ReviewContext,
	req: { timeline: string[]; notes: Note[] },
	deps: HelperDeps = defaults()
): Promise<{ ok: true; notes: Note[]; heard: string } | HelperFailure> {
	const r = await runHelper(
		notesPrompt(ctx, req),
		[],
		{
			system: NOTES_SYSTEM,
			schema: NOTES_SCHEMA,
			read: false,
			model: fast(deps),
			timeoutMs: NOTES_TIMEOUT_MS
		},
		deps
	);
	if (!r.ok) return r;
	const out = readNotes(r.stdout);
	return out ? { ok: true, ...out } : unreadable('notes');
}

/** The scribe's answer to what the captain just said ('' when it stays quiet). */
export async function answer(
	ctx: ReviewContext,
	req: ReplyRequest,
	deps: HelperDeps = defaults()
): Promise<{ ok: true; reply: string } | HelperFailure> {
	const r = await runHelper(
		replyPrompt(ctx, req),
		[],
		{
			system: REPLY_SYSTEM,
			schema: REPLY_SCHEMA,
			read: false,
			model: fast(deps),
			timeoutMs: ANSWER_TIMEOUT_MS
		},
		deps
	);
	if (!r.ok) return r;
	const reply = readAnswer(r.stdout);
	return reply === null ? unreadable('answer') : { ok: true, reply };
}

/** The notes tidied into the feedback pack. */
export async function tidyPack(
	ctx: ReviewContext,
	req: { timeline: string[]; notes: Note[] },
	deps: HelperDeps = defaults()
): Promise<{ ok: true; pack: Pack } | HelperFailure> {
	const r = await runHelper(
		packPrompt(ctx, req),
		[],
		{ system: PACK_SYSTEM, schema: PACK_SCHEMA, read: false },
		deps
	);
	if (!r.ok) return r;
	const pack = readPack(r.stdout);
	return pack ? { ok: true, pack } : unreadable('pack');
}

/** Where a session's files go: Wheelhouse's state directory, one folder per session. */
export const reviewsDir = (env: NodeJS.ProcessEnv): string =>
	path.join(defaultStateDir(env), 'live-review');

/**
 * Keep a session as it goes to Firstmate: its record (every event, remark
 * and note) and its screenshots, in a new folder. Returns the files' paths,
 * which the message names so Firstmate and the worker can read them.
 */
export async function saveSession(
	taskId: string,
	session: unknown,
	shots: Record<string, string>,
	env: NodeJS.ProcessEnv = process.env,
	now = new Date()
): Promise<{ dir: string; session: string; shots: Record<string, string> }> {
	const stamp = now.toISOString().replace(/[:.]/g, '-').slice(0, 19);
	const dir = path.join(
		reviewsDir(env),
		`${stamp}-${taskId.replace(/[^a-z0-9._-]/gi, '-').slice(0, 80)}`
	);
	await mkdir(path.join(dir, 'shots'), { recursive: true });
	const saved: Record<string, string> = {};
	for (const [id, data] of Object.entries(shots)) {
		const m = /^data:image\/(jpeg|png);base64,([A-Za-z0-9+/=]+)$/.exec(data);
		if (!m) continue;
		const bytes = Buffer.from(m[2], 'base64');
		if (bytes.length > SHOT_MAX_BYTES) continue;
		const file = path.join(dir, 'shots', `${id}.${m[1] === 'png' ? 'png' : 'jpg'}`);
		await writeFile(file, bytes, { mode: 0o600 });
		saved[id] = file;
	}
	const record = path.join(dir, 'session.json');
	await writeFile(record, `${JSON.stringify(session ?? {}, null, 2)}\n`, { mode: 0o600 });
	return { dir, session: record, shots: saved };
}
