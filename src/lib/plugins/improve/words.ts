import type { Kind, StatusGroup, Visibility } from './types';

/** improve's words for things, said plainly. Pure functions. */

const STATUS: Record<string, string> = {
	draft: 'Being drafted',
	proposed: 'Waiting for your call',
	approved: 'Approved, not applied yet',
	applying: 'Being applied',
	validated: 'Applied and checked',
	rejected: 'Rejected',
	'rolled-back': 'Rolled back'
};

export const statusLabel = (status: string) => STATUS[status] ?? status;

const SHORT: Record<string, string> = {
	draft: 'Draft',
	proposed: 'Your call',
	approved: 'Approved',
	applying: 'Applying',
	validated: 'Applied',
	rejected: 'Rejected',
	'rolled-back': 'Rolled back'
};

export const statusShort = (status: string) => SHORT[status] ?? status;

export function statusGroup(status: string): StatusGroup {
	if (status === 'proposed') return 'waiting';
	if (status === 'approved' || status === 'applying') return 'approved';
	if (status === 'validated') return 'done';
	if (status === 'rejected' || status === 'rolled-back') return 'declined';
	return 'drafting';
}

export const GROUPS: { id: StatusGroup; label: string }[] = [
	{ id: 'waiting', label: 'Waiting for your call' },
	{ id: 'drafting', label: 'Being drafted' },
	{ id: 'approved', label: 'Approved, not applied yet' },
	{ id: 'done', label: 'Applied' },
	{ id: 'declined', label: 'Rejected or rolled back' }
];

const KIND_OF_SURFACE: Record<string, Kind> = {
	contract: 'instructions',
	'brief-scaffold': 'script',
	skill: 'skill',
	'public-skill': 'skill',
	script: 'script',
	docs: 'docs',
	'brief-include': 'preference',
	'captain-preferences': 'preference',
	learnings: 'memory',
	'home-data': 'memory',
	'improve-record': 'memory',
	'claude-config': 'settings',
	'agent-config': 'settings',
	'home-config': 'settings'
};
const KIND_OF_LAYER: Record<string, Kind> = {
	instructions: 'instructions',
	delegation: 'instructions',
	skills: 'skill',
	tools: 'script',
	hooks: 'script',
	permissions: 'settings',
	context: 'preference',
	memory: 'memory'
};

/** The kind of change: its first surface as improve classified it, else its layer. */
export function kindOf(surfaces: string[], layer: string | null): Kind {
	for (const s of surfaces) if (KIND_OF_SURFACE[s]) return KIND_OF_SURFACE[s];
	return (layer && KIND_OF_LAYER[layer]) || 'other';
}

export const KIND_LABEL: Record<Kind, string> = {
	instructions: 'Instructions',
	skill: 'Skill',
	script: 'Script',
	preference: 'Preference',
	memory: 'Memory',
	settings: 'Settings',
	docs: 'Docs',
	other: 'Change'
};

/** The first sentence, at most `max` characters. */
export function firstSentence(text: string | null, max = 140): string | null {
	if (!text) return null;
	const s = text.match(/^.*?[.!?](?=\s|$)/)?.[0] ?? text;
	return s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s;
}

const SURFACE: Record<string, string> = {
	contract: 'Firstmate’s contract',
	'brief-scaffold': 'the brief every worker starts from',
	skill: 'a Firstmate skill',
	'claude-config': 'Claude Code settings',
	'public-skill': 'a published skill',
	script: 'a Firstmate script',
	docs: 'Firstmate’s docs',
	'brief-include': 'your additions to every brief',
	'captain-preferences': 'your preferences',
	learnings: 'Firstmate’s learnings',
	'home-data': 'your home’s records',
	'home-config': 'your home’s settings',
	'improve-record': 'improve’s own records',
	'agent-config': 'agent settings'
};

export const surfaceLabel = (surface: string) => SURFACE[surface] ?? surface;

export function visibilityLabel(v: Visibility): string {
	if (v === 'captain-private') return 'Private to you';
	if (v === 'shared-tracked') return 'Shared Firstmate code';
	if (v === 'mixed') return 'Mixes private and shared files';
	return 'Not classified';
}

export function visibilityShort(v: Visibility): string {
	if (v === 'captain-private') return 'Private';
	if (v === 'shared-tracked') return 'Shared';
	if (v === 'mixed') return 'Mixed';
	return 'Unclassified';
}

/** What improve read, by kind, for a bar; only the kinds it found any of. */
export function countMix(
	c: Record<string, unknown>
): { key: string; label: string; value: number }[] {
	const rows: [string, string][] = [
		['ask_user_findings', 'Review questions'],
		['decisions', 'Decisions'],
		['blockers', 'Blockers'],
		['captain_preferences', 'Your preferences'],
		['learnings', 'Learnings']
	];
	return rows
		.filter(([k]) => typeof c[k] === 'number' && (c[k] as number) > 0)
		.map(([k, label]) => ({ key: k, label, value: c[k] as number }));
}

export function deliveryLabel(v: Visibility, refused: string | null = null): string {
	if (v === 'captain-private') return 'Once you approve it, improve edits your home’s own files.';
	if (v === 'shared-tracked')
		return 'Once you approve it, the change goes to Firstmate as a pull request; nothing is edited in place.';
	if (v === 'mixed') return 'improve will split it into one proposal per side before you decide.';
	return refused
		? `improve will not file it: it ${refused}.`
		: 'improve has not classified it yet.';
}

/** A visibility from a delivery improve recorded when it filed the proposal. */
export function visibilityOfDelivery(delivery: unknown): Visibility {
	if (delivery === 'local-apply') return 'captain-private';
	if (delivery === 'upstream-pr') return 'shared-tracked';
	if (delivery === 'split') return 'mixed';
	return null;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** "a, b and c". */
export function list(items: string[]): string {
	if (items.length <= 1) return items.join('');
	return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

/** The import's counts as one sentence, the ones that matter first. */
export function countsSentence(c: Record<string, unknown>): string | null {
	const n = (k: string) => (typeof c[k] === 'number' ? (c[k] as number) : 0);
	if (typeof c.tasks !== 'number') return null;
	const parts = [
		n('ask_user_findings') && plural(n('ask_user_findings'), 'review question'),
		n('decisions') && plural(n('decisions'), 'decision'),
		n('blockers') && plural(n('blockers'), 'blocker')
	].filter((p): p is string => !!p);
	const home = [
		n('captain_preferences') && plural(n('captain_preferences'), 'preference') + ' of yours',
		n('learnings') && plural(n('learnings'), 'learning')
	].filter((p): p is string => !!p);
	let s = `improve has read ${plural(n('tasks'), 'task')}`;
	if (parts.length) s += ` with ${list(parts)}`;
	if (home.length) s += `, and ${list(home)}`;
	return `${s}.`;
}

/** The counts the Improvements page lists, in order. */
export function countRows(c: Record<string, unknown>): { label: string; value: number }[] {
	const rows: [string, string][] = [
		['tasks', 'Tasks'],
		['ask_user_findings', 'Review questions'],
		['decisions', 'Decisions'],
		['blockers', 'Blockers'],
		['open', 'Still open'],
		['captain_preferences', 'Your preferences'],
		['learnings', 'Learnings'],
		['stale_wakes', 'Stale wake-ups'],
		['spawn_failures', 'Failed launches'],
		['teardown_refusals', 'Refused clean-ups']
	];
	// Tasks always; the rest only when improve found some.
	return rows
		.filter(([k]) => typeof c[k] === 'number' && (k === 'tasks' || (c[k] as number) > 0))
		.map(([k, label]) => ({ label, value: c[k] as number }));
}

const quote = (s: string) => {
	const t = s.replace(/\s+/g, ' ').trim();
	return `“${t.length > 140 ? `${t.slice(0, 139).trimEnd()}…` : t}”`;
};

/** A repeated pattern from the import, as one sentence. */
export function patternSentence(
	kind: 'ask-user' | 'decision',
	count: number,
	tasks: number,
	example: string
) {
	const where = tasks > 1 ? `in ${plural(tasks, 'task')}` : `${plural(count, 'time')} in one task`;
	return kind === 'ask-user'
		? `The automated review asked the same question ${where}: ${quote(example)}`
		: `Firstmate asked you the same thing ${where}: ${quote(example)}`;
}

/** "3 days ago", from an ISO time. */
export function since(iso: string, now: number): string {
	const s = Math.max(0, (now - Date.parse(iso)) / 1000);
	if (s < 3600) return 'within the hour';
	if (s < 86400) return plural(Math.floor(s / 3600), 'hour') + ' ago';
	return plural(Math.floor(s / 86400), 'day') + ' ago';
}
