<script lang="ts">
	import type { TaskSummary } from '$lib/types';
	import { live } from '$lib/client/live.svelte';
	import { agentLine, consoleInImage, nowLine, type ConsoleSample } from '$lib/card';
	import { ago, plural } from '$lib/format';
	import ConsoleWindow from './ConsoleWindow.svelte';
	import StageTrack from './StageTrack.svelte';
	import Thumb from './Thumb.svelte';
	import { tone, textClass } from './tone';

	let { task, projectName = null }: { task: TaskSummary; projectName?: string | null } = $props();
	const t = $derived(tone(task));
	let sample = $state<ConsoleSample | null>(null);
	const showConsole = $derived(consoleInImage(task));
	const now = $derived(nowLine(task, showConsole ? sample : null, live.now));
	const who = $derived(
		agentLine(task.worker) ?? (task.status === 'queued' ? 'Not started' : 'Crew unknown')
	);
	// Trouble and Firstmate states lead with the state itself; the Now line says why.
	const lead = $derived(t === 'trouble' || t === 'firstmate' ? task.statusLabel : null);
	const age = $derived(
		!now?.at
			? null
			: now.source === 'console'
				? 'live'
				: now.source === 'pipeline'
					? `started ${ago(now.at, live.now)}`
					: ago(now.at, live.now)
	);
</script>

<a
	href="/tasks/{encodeURIComponent(task.id)}"
	class="group block min-w-0 rounded-2xl border bg-card p-3 transition-shadow duration-200 hover:shadow-md focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
>
	{#if showConsole}
		<ConsoleWindow {task} onsample={(s) => (sample = s)} class="rounded-xl" />
	{:else}
		<Thumb {task} class="rounded-xl" />
	{/if}
	<div class="px-1 pt-4 pb-1">
		<p class="truncate text-xs text-muted-foreground" title={who}>
			{#if projectName}<span class="text-sea">{projectName}</span> ·
			{/if}{who}
		</p>
		<p
			class="mt-0.5 line-clamp-2 leading-snug font-medium group-hover:underline"
			title={task.title}
		>
			{task.shortTitle}
		</p>
		{#if now}
			<p
				class="mt-1 line-clamp-2 text-sm {lead ? textClass[t] : 'text-muted-foreground'}"
				data-now={now.source}
			>
				{#if lead}<span class="font-medium">{lead}.</span>{/if}
				<span class="font-medium {lead ? '' : 'text-foreground/80'}">Now:</span>
				{now.text}{#if age}<span class="text-muted-foreground">{` · ${age}`}</span>{/if}
			</p>
		{:else}
			<p
				class="mt-1 line-clamp-1 text-sm {lead ? textClass[t] : 'text-muted-foreground'}"
				title={task.summary ?? undefined}
			>
				{lead ?? task.summary ?? task.statusLabel}
			</p>
		{/if}
		<div class="mt-4"><StageTrack {task} /></div>
		{#if task.filesChanged}
			<p class="tabular mt-3 text-xs text-muted-foreground">
				{task.filesChanged}
				{plural(task.filesChanged, 'file', 'files')} changed
			</p>
		{/if}
	</div>
</a>
