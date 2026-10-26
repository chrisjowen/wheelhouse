<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { currentFleet } from '$lib/client/live.svelte';
	import PassageEditor from '$lib/components/wh/passage/PassageEditor.svelte';
	import { shipPassageDraft } from '$lib/passage-meta';
	import type { PassageEditorFile, PassageTestTask } from '$lib/types';
	import { ArrowLeft } from '@lucide/svelte';

	let { data } = $props();

	const id = $derived(page.params.id!);
	const name = $derived(currentFleet()?.projects.find((p) => p.id === id)?.name ?? id);
	let saved = $state<{ editor: PassageEditorFile; tasks: PassageTestTask[] } | null>(null);
	let note = $state<string | null>(null);
	// A save hands back the file as it is now; a new load (another file) starts over.
	const editor = $derived(
		saved && saved.editor.target === data.editor?.target && saved.editor.projectId === id
			? saved.editor
			: data.editor
	);
	const tasks = $derived(saved && editor === saved.editor ? saved.tasks : data.tasks);

	const FILES = {
		project: {
			name: 'Repository file',
			line: 'The project’s .wheelhouse.yaml, shared with everyone who works on the repository.'
		},
		captain: {
			name: 'Your Wheelhouse config',
			line: 'Your own file for this project, outside the repository. It applies on top of the repository file.'
		}
	} as const;

	function pick(target: 'project' | 'captain') {
		if (target === editor?.target) return;
		note = null;
		goto(`?file=${target}`, { replaceState: true, keepFocus: true, noScroll: true });
	}
</script>

<svelte:head><title>Edit {name} passage · Wheelhouse</title></svelte:head>

<main class="px-4 pt-6 pb-24 sm:px-6 lg:px-10">
	<!-- The page reads on one solid sheet; the graph paper shows only in the gutter. -->
	<div class="surface px-5 py-6 sm:px-8 sm:py-8">
		<a
			href="/projects/{encodeURIComponent(id)}/passage"
			class="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
			><ArrowLeft class="size-4" aria-hidden="true" />{name} passage</a
		>

		{#if !editor}
			<p class="mt-10 text-muted-foreground">{data.problem ?? 'Loading…'}</p>
		{:else}
			<p class="mt-6 text-sm text-muted-foreground">{name}</p>
			<h1 class="mt-1 text-2xl font-semibold tracking-tight">Edit passage</h1>
			<p class="mt-2 max-w-3xl leading-relaxed text-muted-foreground">
				Add, rename and reorder the steps this project’s tasks pass through, and the checks that
				move them along. Test your edits on a real task before you save.
			</p>

			<div class="mt-6" role="radiogroup" aria-label="Which file to edit">
				<div class="flex flex-wrap gap-3">
					{#each ['project', 'captain'] as const as t (t)}
						{@const on = editor.target === t}
						{@const ok = editor.targets[t].available}
						<button
							type="button"
							role="radio"
							aria-checked={on}
							disabled={!ok}
							class="w-full max-w-sm rounded-lg border px-4 py-3 text-left transition-colors sm:w-auto {on
								? 'border-primary bg-card shadow-xs'
								: 'border-border hover:bg-muted/60'} disabled:opacity-60"
							onclick={() => pick(t)}
						>
							<span class="block text-sm font-medium">{FILES[t].name}</span>
							<span class="mt-0.5 block text-xs text-muted-foreground"
								>{ok ? FILES[t].line : editor.targets[t].why}</span
							>
						</button>
					{/each}
				</div>
				<p class="mt-3 max-w-3xl text-sm" data-file-state>
					{#if editor.target === 'project'}
						{#if !editor.file.exists}
							There is no repository file yet; saving creates one.
						{:else if editor.inEffect}
							<span class="text-success">This is the version Wheelhouse uses now.</span>
						{:else}
							<span class="text-warning"
								>This version is saved in the clone but not yet on {editor.defaultRef?.replace(
									/^origin\//,
									''
								) ?? 'the default branch'}, so Wheelhouse does not use it yet.</span
							>
							<a
								class="ml-1 text-sea hover:underline"
								href="/?draft={encodeURIComponent(shipPassageDraft(name))}"
								>Ask Firstmate to ship it</a
							>
						{/if}
					{:else if !editor.file.exists}
						You have no config for this project yet; saving creates it.
					{:else if editor.inEffect}
						<span class="text-success">In use.</span>
					{:else}
						<span class="text-danger">Not in use: it has problems.</span>
					{/if}
				</p>
				{#if editor.file.location}
					<details class="mt-1 text-xs text-muted-foreground">
						<summary class="cursor-pointer">Where the file is</summary>
						<p class="mt-1 font-mono break-all">{editor.file.location}</p>
					</details>
				{/if}
				{#if editor.file.problem}<p class="mt-2 text-sm text-danger">{editor.file.problem}</p>{/if}
				{#if note}<p class="mt-2 text-sm text-success" role="status">{note}</p>{/if}
			</div>

			{#key `${editor.target}|${editor.file.digest}`}
				<PassageEditor
					{editor}
					{tasks}
					onsaved={(e, t) => {
						saved = { editor: e, tasks: t };
						note =
							e.target === 'project'
								? `Saved to the repository file. Wheelhouse uses it once it is on ${e.defaultRef?.replace(/^origin\//, '') ?? 'the default branch'}.`
								: 'Saved to your config. Wheelhouse uses it within a minute.';
					}}
				/>
			{/key}
		{/if}
	</div>
</main>
