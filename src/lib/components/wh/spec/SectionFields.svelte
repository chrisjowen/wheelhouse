<script lang="ts">
	import { ImagePlus, LoaderCircle, X } from '@lucide/svelte';
	import { Textarea } from '$lib/components/ui/textarea';
	import type { SpecDraft, SpecImage, SpecSectionId } from '$lib/spec';
	import ListField from './ListField.svelte';

	/**
	 * The fields of one spec section. `draft` is the page's live draft; edits
	 * write straight into it and the page saves them.
	 */
	let {
		draft,
		section,
		projects,
		imageUrl,
		onUpload,
		onRemoveImage,
		uploading = false,
		uploadError = null
	}: {
		draft: SpecDraft;
		section: SpecSectionId;
		/** Project names Firstmate knows, offered as suggestions. */
		projects: string[];
		imageUrl: (img: SpecImage) => string;
		onUpload: (files: File[]) => void;
		onRemoveImage: (img: SpecImage) => void;
		uploading?: boolean;
		uploadError?: string | null;
	} = $props();

	const input =
		'h-9 w-full min-w-0 rounded-md border border-input bg-card px-2.5 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50';
	let dragging = $state(false);
	const newProject = $derived(
		!!draft.project.trim() &&
			projects.length > 0 &&
			!projects.some((p) => p.toLowerCase() === draft.project.trim().toLowerCase())
	);
	let picker: HTMLInputElement | undefined = $state();

	const images = (list: FileList | null | undefined) =>
		[...(list ?? [])].filter((f) => /^image\/(png|jpeg|webp|gif)$/.test(f.type));

	function ondrop(e: DragEvent) {
		e.preventDefault();
		dragging = false;
		const files = images(e.dataTransfer?.files);
		if (files.length) onUpload(files);
	}
	function onpaste(e: ClipboardEvent) {
		const files = images(e.clipboardData?.files);
		if (files.length) {
			e.preventDefault();
			onUpload(files);
		}
	}
</script>

{#snippet field(id: string, label: string, hint: string)}
	<label for={id} class="block text-sm font-medium">{label}</label>
	<p class="mt-0.5 text-xs text-muted-foreground">{hint}</p>
{/snippet}

<div class="space-y-6">
	{#if section === 'project'}
		<div>
			{@render field('spec-project', 'Project', 'Pick one Firstmate knows, or type a new name.')}
			<input
				id="spec-project"
				class="{input} mt-2"
				list="spec-projects"
				autocomplete="off"
				bind:value={draft.project}
			/>
			<datalist id="spec-projects">
				{#each projects as p (p)}<option value={p}></option>{/each}
			</datalist>
			{#if newProject}
				<p class="mt-1.5 text-xs text-muted-foreground">
					A project Firstmate does not know yet; it will ask where it lives.
				</p>
			{/if}
		</div>
		<div>
			{@render field('spec-title', 'Title', 'A short name for the work.')}
			<input id="spec-title" class="{input} mt-2" bind:value={draft.title} />
		</div>
		<div>
			{@render field('spec-summary', 'In one sentence', 'What it is, as you would say it aloud.')}
			<Textarea id="spec-summary" class="mt-2 bg-card" rows={2} bind:value={draft.summary} />
		</div>
	{:else if section === 'problem'}
		<div>
			{@render field('spec-problem', 'The problem', 'What is wrong or missing today.')}
			<Textarea id="spec-problem" class="mt-2 min-h-28 bg-card" bind:value={draft.problem} />
		</div>
		<div>
			{@render field('spec-goal', 'The goal', 'What will be true once this is done.')}
			<Textarea id="spec-goal" class="mt-2 min-h-24 bg-card" bind:value={draft.goal} />
		</div>
	{:else if section === 'audience'}
		<div>
			{@render field(
				'spec-audience',
				'Who it is for',
				'Who uses it, what they are trying to get done, and how often.'
			)}
			<Textarea id="spec-audience" class="mt-2 min-h-32 bg-card" bind:value={draft.audience} />
		</div>
	{:else if section === 'journeys'}
		<ListField
			bind:items={draft.journeys}
			label="Journeys"
			item="Journey"
			addLabel="Add a journey"
			placeholder="Describe one journey, step by step"
			numbered
			multiline
		/>
	{:else if section === 'scope'}
		<div>
			{@render field('spec-scope', 'In scope', 'What this piece of work includes.')}
			<Textarea id="spec-scope" class="mt-2 min-h-24 bg-card" bind:value={draft.scope} />
		</div>
		<div>
			{@render field('spec-non-goals', 'Not in scope', 'What it deliberately leaves for later.')}
			<Textarea id="spec-non-goals" class="mt-2 min-h-24 bg-card" bind:value={draft.nonGoals} />
		</div>
	{:else if section === 'requirements'}
		<ListField
			bind:items={draft.requirements}
			label="Requirements"
			item="Requirement"
			addLabel="Add a requirement"
			placeholder="One thing that must be true when it is done"
		/>
	{:else if section === 'ui'}
		<div>
			{@render field('spec-ui', 'Look and feel', 'Layout, tone, anything to match or avoid.')}
			<Textarea id="spec-ui" class="mt-2 min-h-24 bg-card" bind:value={draft.uiNotes} />
		</div>
		<ListField
			bind:items={draft.links}
			label="References"
			item="Reference"
			addLabel="Add a link"
			placeholder="https://… or the name of a page to follow"
		/>
		<div>
			<p class="text-sm font-medium">Screenshots</p>
			<p class="mt-0.5 text-xs text-muted-foreground">
				Drop pictures here, paste them, or choose files. Firstmate receives each one with its
				caption.
			</p>
			<!-- svelte-ignore a11y_no_static_element_interactions -->
			<div
				class="mt-2 rounded-lg border border-dashed p-4 transition-colors {dragging
					? 'border-sea bg-sea/5'
					: 'border-hair'}"
				ondragover={(e) => {
					e.preventDefault();
					dragging = true;
				}}
				ondragleave={() => (dragging = false)}
				{ondrop}
				{onpaste}
			>
				{#if draft.images.length}
					<ul class="mb-4 grid grid-cols-[repeat(auto-fill,minmax(10rem,1fr))] gap-3">
						{#each draft.images as img (img.name)}
							<li class="min-w-0 rounded-md border bg-card p-2">
								<div class="relative">
									<img
										src={imageUrl(img)}
										alt={img.caption || 'Screenshot'}
										class="aspect-video w-full rounded-sm bg-muted object-cover"
										loading="lazy"
									/>
									<button
										type="button"
										class="absolute top-1 right-1 rounded-full bg-background/90 p-1 text-muted-foreground shadow-sm hover:text-foreground"
										aria-label="Remove this screenshot"
										onclick={() => onRemoveImage(img)}><X class="size-3.5" /></button
									>
								</div>
								<input
									class="mt-2 h-8 w-full min-w-0 rounded-sm border border-transparent bg-transparent px-1 text-xs outline-none hover:border-input focus-visible:border-ring"
									bind:value={img.caption}
									placeholder="Caption"
									aria-label="Caption"
								/>
							</li>
						{/each}
					</ul>
				{/if}
				<button
					type="button"
					class="inline-flex items-center gap-2 rounded-md px-2 py-1 text-sm text-sea hover:bg-muted"
					onclick={() => picker?.click()}
					disabled={uploading}
				>
					{#if uploading}<LoaderCircle class="size-4 animate-spin" aria-hidden="true" />Adding…
					{:else}<ImagePlus class="size-4" aria-hidden="true" />Choose screenshots{/if}
				</button>
				<input
					bind:this={picker}
					type="file"
					accept="image/png,image/jpeg,image/webp,image/gif"
					multiple
					class="hidden"
					onchange={(e) => {
						const files = images(e.currentTarget.files);
						e.currentTarget.value = '';
						if (files.length) onUpload(files);
					}}
				/>
				{#if uploadError}<p class="mt-2 text-sm text-danger" role="alert">{uploadError}</p>{/if}
			</div>
		</div>
	{:else if section === 'constraints'}
		<div>
			{@render field(
				'spec-constraints',
				'Constraints',
				'Rules it must follow: technology, data, permissions, deadlines.'
			)}
			<Textarea
				id="spec-constraints"
				class="mt-2 min-h-24 bg-card"
				bind:value={draft.constraints}
			/>
		</div>
		<div>
			{@render field('spec-risks', 'Risks', 'What could go wrong, or needs extra care.')}
			<Textarea id="spec-risks" class="mt-2 min-h-24 bg-card" bind:value={draft.risks} />
		</div>
	{:else if section === 'questions'}
		<ListField
			bind:items={draft.questions}
			label="Questions"
			item="Question"
			addLabel="Add a question"
			placeholder="Something still to decide"
		/>
	{/if}
</div>
