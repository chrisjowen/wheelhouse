import type { PluginPageView, PluginStatus, Slot } from './types';

/**
 * Plugins in plain words for the Plugins pages: what a plugin adds, where it
 * is on by default, and where it is on now; never slot names or file paths.
 */

const SLOT_WORDS: Record<Slot, string> = {
	'project.tab': 'a tab on each project',
	'harbour.card': 'a card in the Harbour',
	'task.section': 'a section on each task',
	'step.evidence': 'notes on a task’s steps',
	'bridge.card': 'a card in the Firstmate chat',
	'home.card': 'a tab beside the Firstmate chat',
	'header.indicator': 'a sign in the header',
	'nav.page': 'a page of its own in the menu'
};

/** What a plugin adds to the pages ("A tab on each project and a card in the Harbour"). */
export function addsWords(slots: Slot[]): string {
	const words = [...new Set(slots.map((s) => SLOT_WORDS[s]))];
	if (!words.length) return 'Nothing on the pages';
	const list =
		words.length === 1
			? words[0]
			: `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`;
	return list.charAt(0).toUpperCase() + list.slice(1);
}

/** Where a plugin is on when the captain has not said: its own rule. */
export function defaultWords(p: PluginStatus): string {
	if (p.enabledWhenHomeFile) return 'On while Firstmate uses it';
	if (p.enabledWhenFile) return `On for projects that have a ${p.enabledWhenFile} file`;
	return p.enabledByDefault ? 'On for every project' : 'Off until you turn it on';
}

/** Where a plugin is on now, in a few words, for its row. */
export function whereOnWords(v: PluginPageView): string {
	const total = v.projects.length;
	const on = v.projects.filter((p) => p.on).length;
	if (!total) return v.on ? 'On' : 'Off';
	if (on === total) return total === 1 ? 'On' : 'On for every project';
	if (on === 0) return 'Off';
	return `On for ${on} of ${total} projects`;
}

/** A phrase to use mid-sentence: its first letter lower-case, the rest (a file name, say) kept. */
export const midSentence = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);
