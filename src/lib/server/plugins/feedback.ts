import {
	MAX_LINE_CHARS,
	MAX_LIST,
	pluginBatchText,
	type SummaryPoint,
	type SummaryRequest
} from '../../previewhelper';
import type { BridgeMessage } from '../../types';
import { validateSend, type SendInput, type SendResult } from '../store/messenger';

/**
 * A plugin's feedback list to Firstmate: the `feedback` capability. A plugin
 * that declares it in its manifest (shown to the captain before install) may
 * have its elements send one list about one task, on the captain's click
 * (`host.sendFeedback`, lib/plugins/elements.ts), to
 * `POST /api/plugins/<id>/feedback`. Wheelhouse, not the plugin, writes the
 * message: the preview feedback list's shape and framing (`pluginBatchText`),
 * attributed to the plugin by its own name and about the task named, and it
 * goes to Firstmate's inbox as one note about that task, exactly as a list
 * sent from the Preview tab does, so it shows in the chat as the captain's
 * card and counts as a change request on the task.
 *
 * Before sending, the same plugin may have the preview helper tidy a list
 * into points (`POST /api/plugins/<id>/feedback/summary`, `summarisePluginFeedback`):
 * the same list, checked the same way, comes back as points for the captain
 * to edit and pick. Nothing is sent.
 */

export const MAX_POINTS_CHARS = 200;
export const MAX_SUBJECT_CHARS = 200;

export interface FeedbackRequest {
	taskId: string;
	/** What the list is about, e.g. "data/x/plan.md: Request changes"; null for nothing more. */
	subject: string | null;
	items: { text: string; points: string | null }[];
}

/** Whether a plugin may send a list about a task: its own name and the task's title, or why not. */
export type FeedbackSender =
	| { ok: true; plugin: { id: string; name: string }; task: { id: string; title: string } }
	| { ok: false; status: 403 | 404; error: string };

const tidy = (s: string) => s.replace(/\s+/g, ' ').trim();
const fits = (s: string, max: number) => [...s].length <= max;

/** A request from a plugin's element, checked; or why it is refused. */
export function readFeedback(
	body: Record<string, unknown>
): { ok: true; value: FeedbackRequest } | { ok: false; error: string } {
	if (typeof body.taskId !== 'string' || !body.taskId) {
		return { ok: false, error: 'Name the task the feedback is about.' };
	}
	let subject: string | null = null;
	if (body.subject !== undefined && body.subject !== null) {
		if (typeof body.subject !== 'string') return { ok: false, error: 'The subject must be text.' };
		subject = tidy(body.subject) || null;
		if (subject && !fits(subject, MAX_SUBJECT_CHARS)) {
			return { ok: false, error: `The subject is longer than ${MAX_SUBJECT_CHARS} characters.` };
		}
	}
	if (!Array.isArray(body.items)) return { ok: false, error: 'Send the feedback as a list.' };
	const items: FeedbackRequest['items'] = [];
	for (const it of body.items as unknown[]) {
		const r = (typeof it === 'object' && it !== null ? it : {}) as Record<string, unknown>;
		if (typeof r.text !== 'string') return { ok: false, error: 'Each line needs its words.' };
		const text = tidy(r.text);
		if (!text) continue;
		if (!fits(text, MAX_LINE_CHARS)) {
			return { ok: false, error: `A line is longer than ${MAX_LINE_CHARS} characters.` };
		}
		if (r.points !== undefined && r.points !== null && typeof r.points !== 'string') {
			return { ok: false, error: 'What a line points at must be text.' };
		}
		const points = typeof r.points === 'string' ? tidy(r.points) || null : null;
		if (points && !fits(points, MAX_POINTS_CHARS)) {
			return {
				ok: false,
				error: `What a line points at is longer than ${MAX_POINTS_CHARS} characters.`
			};
		}
		items.push({ text, points });
	}
	if (!items.length) return { ok: false, error: 'The list is empty.' };
	if (items.length > MAX_LIST) {
		return { ok: false, error: `A list holds at most ${MAX_LIST} lines.` };
	}
	return { ok: true, value: { taskId: body.taskId, subject, items } };
}

export interface FeedbackDeps {
	/** Whether the plugin may send about the task (the registry's `feedbackSender`). */
	sender(pluginId: string, taskId: string): Promise<FeedbackSender>;
	/** Firstmate's inbox, the way every Wheelhouse message goes (the messenger's `send`). */
	send(input: SendInput): Promise<SendResult>;
}

/** Check, frame and send one plugin's list; the message as sent, or why it was not. */
export async function sendPluginFeedback(
	deps: FeedbackDeps,
	pluginId: string,
	requestId: string | null,
	body: Record<string, unknown>
): Promise<
	| { ok: true; created: boolean; message: BridgeMessage }
	| { ok: false; status: number; error: string }
> {
	const req = readFeedback(body);
	if (!req.ok) return { ok: false, status: 400, error: req.error };
	const who = await deps.sender(pluginId, req.value.taskId);
	if (!who.ok) return who;
	const text = pluginBatchText(who.task, who.plugin, req.value.subject, req.value.items);
	const valid = validateSend(requestId, text, who.task.id);
	if (!valid.ok) return valid;
	return deps.send(valid.input);
}

export interface SummaryDeps {
	/** Whether the plugin may send about the task (the registry's `feedbackSender`). */
	sender(pluginId: string, taskId: string): Promise<FeedbackSender>;
	/** The preview helper's summary (server/previewhelper.ts `summariseFeedback`). */
	summarise(
		req: SummaryRequest
	): Promise<{ ok: true; points: SummaryPoint[] } | { ok: false; status: number; error: string }>;
}

/**
 * Check a plugin's list as a send would be checked, and have the preview
 * helper tidy it into points: the points, or why not. It sends nothing.
 */
export async function summarisePluginFeedback(
	deps: SummaryDeps,
	pluginId: string,
	body: Record<string, unknown>
): Promise<{ ok: true; points: SummaryPoint[] } | { ok: false; status: number; error: string }> {
	const req = readFeedback(body);
	if (!req.ok) return { ok: false, status: 400, error: req.error };
	const who = await deps.sender(pluginId, req.value.taskId);
	if (!who.ok) return who;
	return deps.summarise({ task: who.task, subject: req.value.subject, items: req.value.items });
}
