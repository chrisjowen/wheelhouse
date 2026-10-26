<script lang="ts">
	import { BookOpen, ExternalLink, FileText, Scale } from '@lucide/svelte';
	import { DOC_KIND_LABEL, type DocRef } from '$lib/buildlog';
	import type { Available } from '$lib/types';

	let { docs, taskId }: { docs: Available<DocRef[]>; taskId: string } = $props();

	const href = (d: DocRef) =>
		`/tasks/${encodeURIComponent(taskId)}/doc?path=${encodeURIComponent(d.path)}`;
	const groups = $derived(
		docs.available
			? [
					{ label: 'Decision records', items: docs.value.filter((d) => d.kind === 'decision') },
					{ label: 'Docs', items: docs.value.filter((d) => d.kind !== 'decision') }
				].filter((g) => g.items.length)
			: []
	);
	const how = (d: DocRef) => {
		if (!d.changed) return 'Read by the worker';
		if (d.additions === null) return 'Changed in this task';
		if (!d.deletions) return `${d.additions} ${d.additions === 1 ? 'line' : 'lines'} added`;
		return `${d.additions} added, ${d.deletions} removed`;
	};
</script>

<section aria-labelledby="task-docs" class="max-w-4xl">
	<h2 id="task-docs" class="sr-only">Docs and decisions</h2>
	{#if !docs.available}
		<p class="text-sm text-muted-foreground">{docs.reason}</p>
	{:else if !docs.value.length}
		<div class="rounded-xl border border-dashed p-6 text-muted-foreground">
			<BookOpen class="size-5" aria-hidden="true" />
			<p class="mt-2 text-sm font-medium text-foreground">No docs touched yet</p>
			<p class="mt-1 text-sm">
				Decision records and docs the worker reads or changes for this task show here.
			</p>
		</div>
	{:else}
		<p class="text-sm text-muted-foreground">
			The decision records and docs this task’s work read or changed. Open one to read it here.
		</p>
		{#each groups as g (g.label)}
			<h3 class="section-label mt-6">{g.label}</h3>
			<ul class="mt-3 divide-y divide-hair rounded-lg border bg-card">
				{#each g.items as d (d.path)}
					<li class="flex items-start gap-3 px-4 py-3" data-doc={d.kind}>
						{#if d.kind === 'decision'}<Scale
								class="mt-0.5 size-4 shrink-0 text-muted-foreground"
								aria-hidden="true"
							/>{:else}<FileText
								class="mt-0.5 size-4 shrink-0 text-muted-foreground"
								aria-hidden="true"
							/>{/if}
						<div class="min-w-0 flex-1">
							<a href={href(d)} class="font-medium hover:underline">{d.title}</a>
							<p class="mt-0.5 text-xs text-muted-foreground">
								{DOC_KIND_LABEL[d.kind]}{d.kind === 'readme' ? '' : ` · ${d.name}`} ·
								<span class={d.changed ? 'text-foreground/80' : ''}>{how(d)}</span>
							</p>
						</div>
						{#if d.github}
							<a
								href={d.github}
								target="_blank"
								rel="noreferrer"
								class="inline-flex shrink-0 items-center gap-1 text-xs text-sea hover:underline"
								aria-label="Open {d.title} on GitHub"
								>GitHub<ExternalLink class="size-3" aria-hidden="true" /></a
							>
						{/if}
					</li>
				{/each}
			</ul>
		{/each}
		<p class="mt-2 text-xs text-muted-foreground">From {docs.source}.</p>
	{/if}
</section>
