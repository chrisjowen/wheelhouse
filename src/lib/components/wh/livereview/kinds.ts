import { Bug, CircleHelp, Lightbulb, ThumbsUp, Wrench } from '@lucide/svelte';
import type { NoteKind, Severity } from '$lib/livereview';

/** How each kind of note is drawn: its word, icon and tone. */
export const KIND: Record<NoteKind, { word: string; icon: typeof Bug; tone: string }> = {
	problem: { word: 'Problem', icon: Bug, tone: 'text-danger' },
	change: { word: 'Change', icon: Wrench, tone: 'text-sea' },
	idea: { word: 'Idea', icon: Lightbulb, tone: 'text-working' },
	question: { word: 'Question', icon: CircleHelp, tone: 'text-muted-foreground' },
	praise: { word: 'Keep', icon: ThumbsUp, tone: 'text-teal' }
};

export const SEVERITY: Record<Severity, string> = {
	must: 'Must fix',
	should: 'Should fix',
	could: 'Could do',
	none: 'Works well'
};
