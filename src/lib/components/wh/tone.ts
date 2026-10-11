import type { TaskSummary } from '$lib/types';

/** One colour rule for every place a task's state is drawn. */
export type Tone = 'you' | 'trouble' | 'landed' | 'firstmate' | 'normal';

export function tone(t: TaskSummary): Tone {
	if (t.attention?.owner === 'captain') return 'you';
	if (['blocked', 'failed', 'lost', 'unknown'].includes(t.status)) return 'trouble';
	if (t.status === 'landed') return 'landed';
	if (t.status === 'with-firstmate') return 'firstmate';
	return 'normal';
}

export const dotClass: Record<Tone, string> = {
	you: 'bg-sea',
	trouble: 'bg-danger',
	landed: 'bg-success',
	firstmate: 'bg-warning',
	normal: 'bg-foreground'
};

export const textClass: Record<Tone, string> = {
	you: 'text-sea',
	trouble: 'text-danger',
	landed: 'text-success',
	firstmate: 'text-warning',
	normal: 'text-foreground'
};
