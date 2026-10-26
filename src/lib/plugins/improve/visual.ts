import {
	BookOpen,
	FileText,
	GitPullRequest,
	Lock,
	NotebookPen,
	ScrollText,
	Settings2,
	SlidersHorizontal,
	Split,
	SquareTerminal,
	Wrench
} from '@lucide/svelte';
import type { Kind, StatusGroup, Visibility } from './types';

/** How the Improve panels draw things: one icon per kind of change, chip styles and bar colours. */

export const KIND_ICON: Record<Kind, typeof Wrench> = {
	instructions: ScrollText,
	skill: BookOpen,
	script: SquareTerminal,
	preference: SlidersHorizontal,
	memory: NotebookPen,
	settings: Settings2,
	docs: FileText,
	other: Wrench
};

export const VIS_CHIP: Record<Exclude<Visibility, null>, { icon: typeof Lock; cls: string }> = {
	'captain-private': { icon: Lock, cls: 'border-hair bg-muted text-foreground' },
	'shared-tracked': { icon: GitPullRequest, cls: 'border-sea/40 bg-sea/10 text-sea' },
	mixed: { icon: Split, cls: 'border-warning/40 bg-warning/10 text-warning' }
};

export const STATUS_CHIP: Record<StatusGroup, string> = {
	waiting: 'border-sea bg-sea text-white dark:text-slate-950',
	drafting: 'border-dashed border-input text-muted-foreground',
	approved: 'border-success/40 bg-success/10 text-success',
	done: 'border-success bg-success text-white dark:text-slate-950',
	declined: 'border-hair text-muted-foreground'
};

/** One colour per kind of evidence, from the theme's own segment tokens. */
export const MIX_COLOR: Record<string, string> = {
	ask_user_findings: 'var(--seg-review)',
	decisions: 'var(--sea)',
	blockers: 'var(--warning)',
	captain_preferences: 'var(--brass)',
	learnings: 'var(--seg-ci)'
};

/** The repeated question, short enough for a chip. */
export const chipText = (s: string, max = 56) =>
	s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s;
