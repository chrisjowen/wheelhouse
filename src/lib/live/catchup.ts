/**
 * The catch-up at the end of a Live mode discussion, shared by the server and
 * the chat: what moved on the fleet while the captain talked, one item per
 * change, gathered by task for the list. Pure, so it is unit-tested.
 */

export interface CatchUpItem {
	kind: 'new' | 'moved' | 'decision' | 'cleared';
	task: string;
	title: string;
	/** The task's project, when known. */
	project: string | null;
	/** The state it left and the state it is in now, in plain words. */
	from?: string;
	to?: string;
	/** One line for the list: a decision's short heading. */
	summary: string;
	/** The whole of it: a decision's question as Firstmate wrote it. */
	text: string;
}

export interface CatchUpGroup {
	task: string;
	title: string;
	project: string | null;
	/** The latest state change, if the task moved or is new. */
	moved: CatchUpItem | null;
	decisions: CatchUpItem[];
	cleared: CatchUpItem[];
}

/** The same words once a leading "<project>:" is set aside. */
const sameTitle = (summary: string, title: string) =>
	!!title &&
	summary.replace(/^[\w.-]+:\s*/, '').trim() === title.replace(/^[\w.-]+:\s*/, '').trim();

/**
 * The items gathered by task, tasks with a decision waiting on the captain
 * first and otherwise in the order they came. Items from before the fields
 * were added fall back to their text.
 */
export function groupCatchUp(items: CatchUpItem[]): CatchUpGroup[] {
	const groups = new Map<string, CatchUpGroup>();
	for (const raw of items) {
		const summary = raw.summary ?? raw.text;
		const i: CatchUpItem = {
			...raw,
			project: raw.project ?? null,
			// A heading that only repeats the task's title says nothing: the question does.
			summary: sameTitle(summary, raw.title) ? raw.text : summary,
			text: raw.kind === 'cleared' && sameTitle(raw.text, raw.title) ? summary : raw.text
		};
		let g = groups.get(i.task);
		if (!g) {
			g = {
				task: i.task,
				title: i.title,
				project: i.project,
				moved: null,
				decisions: [],
				cleared: []
			};
			groups.set(i.task, g);
		}
		if (!g.title && i.title) g.title = i.title;
		g.project ??= i.project;
		if (i.kind === 'decision') g.decisions.push(i);
		else if (i.kind === 'cleared') g.cleared.push(i);
		else g.moved = i;
	}
	const all = [...groups.values()];
	return [...all.filter((g) => g.decisions.length), ...all.filter((g) => !g.decisions.length)];
}
