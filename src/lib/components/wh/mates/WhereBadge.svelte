<script lang="ts">
	import { Ship } from '@lucide/svelte';
	import type { TaskSummary } from '$lib/types';

	/**
	 * Where a task runs, for one in a second mate's home: that second mate's
	 * name and, for a remote one, its host as secondary detail. The captain's own
	 * tasks carry none. Cards put it just before the task's project tag, so a
	 * second mate's task reads [second mate][project]. Words and an icon, never
	 * colour alone.
	 */
	let { task }: { task: Pick<TaskSummary, 'secondMate'> } = $props();
	const m = $derived(task.secondMate ?? null);
</script>

{#if m}
	<span
		class="inline-flex max-w-full min-w-0 items-center gap-1 rounded-sm bg-brass/10 px-1.5 text-xs leading-[1.15rem] font-medium text-brass"
		title={m.where === 'remote'
			? `Runs on second mate ${m.id}, on ${m.host ?? 'another host'}`
			: `Runs on second mate ${m.id}, on this computer`}
		data-second-mate-task={m.id}
		><Ship class="size-3 shrink-0" aria-hidden="true" /><span class="truncate"
			>{m.id}{#if m.where === 'remote' && m.host}<span
					class="font-normal opacity-70"
					data-second-mate-host>{` · ${m.host}`}</span
				>{/if}</span
		></span
	>
{/if}
