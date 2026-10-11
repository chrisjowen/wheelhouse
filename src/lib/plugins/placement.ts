import type { SlotEntry } from './types';

/**
 * Split a task's task.section entries: those pinned to a step this passage has
 * sit right after that step; the rest (and any pinned to a missing step) go by order.
 */
export function placeTaskSections(
	entries: SlotEntry[],
	stepKeys: string[]
): { afterStep: Record<string, SlotEntry[]>; byOrder: SlotEntry[] } {
	const steps = new Set(stepKeys);
	const afterStep: Record<string, SlotEntry[]> = {};
	const byOrder: SlotEntry[] = [];
	for (const e of entries) {
		if (e.slot !== 'task.section') continue;
		if (e.step !== null && steps.has(e.step)) (afterStep[e.step] ??= []).push(e);
		else byOrder.push(e);
	}
	return { afterStep, byOrder };
}
