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

/**
 * Whether a plugin is on now for every project, for none, or mixed: on for
 * some, or on in a project against its every-project choice (say, picked On
 * for one project, or on where a project has its file).
 */
export function onState(v: PluginPageView): 'on' | 'off' | 'mixed' {
	if (v.projects.every((p) => p.on === v.on)) return v.on ? 'on' : 'off';
	return v.projects.some((p) => p.on) ? 'mixed' : 'off';
}

/** Where a plugin is on now, in a few words, for its row; never at odds with its switch. */
export function whereOnWords(v: PluginPageView): string {
	const total = v.projects.length;
	const on = v.projects.filter((p) => p.on).length;
	const state = onState(v);
	if (state === 'off') return 'Off';
	if (state === 'on') return total > 1 ? 'On for every project' : 'On';
	if (on === total) return `On for ${on === 1 ? '1 project' : `${on} projects`}`;
	return `On for ${on} of ${total} projects`;
}

/** What going back to its default did, from the page as it now stands: projects keep their own picks. */
export function backToDefaultWords(v: PluginPageView): string {
	const except = v.projects.some((x) => x.enabled !== null) ? ' except those you set yourself' : '';
	return `${v.plugin.name} is back to its default: ${midSentence(defaultWords(v.plugin))}${except}.`;
}

/** A phrase to use mid-sentence: its first letter lower-case, the rest (a file name, say) kept. */
export const midSentence = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);
