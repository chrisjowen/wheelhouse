import type { CalmEntry } from '$lib/calls';
import { QUIET_REPLY, type Item } from '$lib/chat/fold';
import { firstWords } from '$lib/chat/progress';

/**
 * What Live mode streams in while the captain talks: Firstmate's own reports
 * from the chat (each turn's first line, all-clears left out) and what moved
 * on the fleet (lib/calls.ts calmOf's log), newest last. Each can be raised in
 * the discussion. Pure, so it is unit-tested.
 */
export interface LiveUpdate {
	id: string;
	from: 'firstmate' | 'task';
	/** Who or what it is about: Firstmate, or the task's short title. */
	title: string;
	text: string;
	at: string;
	taskId: string | null;
}

export function liveUpdates(
	moved: CalmEntry[],
	items: Item[],
	since: number,
	limit = 12
): LiveUpdate[] {
	const out: LiveUpdate[] = [];
	for (const it of items) {
		if (it.kind !== 'turn' || !it.done || Date.parse(it.at) < since) continue;
		const texts = it.parts.flatMap((p) => (p.kind === 'text' && p.text.trim() ? [p.text] : []));
		const last = texts[texts.length - 1];
		if (!last || QUIET_REPLY.test(last.trim())) continue;
		const text = firstWords(last);
		if (text)
			out.push({ id: it.id, from: 'firstmate', title: 'Firstmate', text, at: it.at, taskId: null });
	}
	for (const e of moved) {
		if (Date.parse(e.at) < since) continue;
		out.push({
			id: `${e.taskId}|${e.at}`,
			from: 'task',
			title: e.task,
			text: e.text,
			at: e.at,
			taskId: e.taskId
		});
	}
	out.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
	return out.slice(-limit);
}

/** What the captain says to raise an update in the discussion. */
export function aboutUpdate(u: LiveUpdate): string {
	return u.from === 'firstmate'
		? `Firstmate just reported: “${u.text}”. What does that mean, and does it need anything from me?`
		: `There's an update on “${u.title}”: ${u.text}. What's the story there?`;
}
