<script lang="ts">
	import { Ship } from '@lucide/svelte';
	import type { TaskSummary } from '$lib/types';

	/**
	 * Where a task runs, for one in a second mate's home: that second mate and,
	 * for a remote one, its host. The captain's own tasks carry none. Words and
	 * an icon, never colour alone.
	 */
	let { task }: { task: Pick<TaskSummary, 'secondMate'> } = $props();
	const m = $derived(task.secondMate ?? null);
</script>

{#if m}
	<span
		class="inline-flex max-w-full items-center gap-1 rounded-sm bg-brass/10 px-1.5 text-xs leading-[1.15rem] font-medium text-brass"
		title={m.where === 'remote'
			? `Runs on second mate ${m.id}, on ${m.host ?? 'another host'}`
			: `Runs on second mate ${m.id}, on this computer`}
		data-second-mate-task={m.id}
		><Ship class="size-3 shrink-0" aria-hidden="true" /><span class="truncate"
			>{m.id}{m.where === 'remote' && m.host ? ` · ${m.host}` : ''}</span
		></span
	>
{/if}
