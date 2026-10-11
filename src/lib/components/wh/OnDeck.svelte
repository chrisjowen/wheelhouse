<script lang="ts">
	import type { TaskSummary } from '$lib/types';
	import { onDeck } from '$lib/bridge';
	import { textClass, tone } from './tone';

	let { tasks, now }: { tasks: TaskSummary[]; now: number } = $props();
	const d = $derived(onDeck(tasks, now));
	const LIST = 8;
	const rows = $derived([
		{ label: 'Needs you', n: d.counts.needsYou, cls: d.counts.needsYou ? 'text-sea' : '' },
		{ label: 'Under way', n: d.counts.underWay, cls: '' },
		{ label: 'Queued', n: d.counts.queued, cls: '' },
		{ label: 'Landed today', n: d.counts.landed, cls: '' }
	]);
	const href = (t: TaskSummary) => `/tasks/${encodeURIComponent(t.id)}`;
	// A moving task's line says why it is worth a look; ordinary progress stays quiet.
	const note = (t: TaskSummary) => (tone(t) === 'normal' ? null : t.statusLabel);
</script>

<!-- Fleet-wide summary beside the conversation (not scoped by project). -->
<div class="text-sm">
	<h2 class="font-medium">On deck</h2>
	<dl class="mt-4 space-y-3">
		{#each rows as r (r.label)}
			<div class="flex justify-between gap-4">
				<dt class="text-muted-foreground">{r.label}</dt>
				<dd class="tabular {r.cls}">{r.n}</dd>
			</div>
		{/each}
	</dl>

	{#if d.needsYou.length}
		<h3 class="mt-8 font-medium">Needs you</h3>
		<ul class="mt-3 space-y-2">
			{#each d.needsYou.slice(0, LIST) as t (t.id)}
				<li><a href={href(t)} class="block truncate text-sea hover:underline">{t.title}</a></li>
			{/each}
		</ul>
		{#if d.needsYou.length > LIST}<a href="/" class="mt-2 block text-xs text-muted-foreground"
				>{d.needsYou.length - LIST} more on the Harbour</a
			>{/if}
	{/if}

	{#if d.underWay.length}
		<h3 class="mt-8 font-medium">Under way</h3>
		<ul class="mt-3 space-y-3">
			{#each d.underWay.slice(0, LIST) as t (t.id)}
				<li>
					<a href={href(t)} class="block truncate hover:underline">{t.title}</a>
					{#if note(t)}<p class="mt-0.5 truncate text-xs {textClass[tone(t)]}">{note(t)}</p>{/if}
				</li>
			{/each}
		</ul>
		{#if d.underWay.length > LIST}<a href="/" class="mt-2 block text-xs text-muted-foreground"
				>{d.underWay.length - LIST} more on the Harbour</a
			>{/if}
	{/if}
</div>
