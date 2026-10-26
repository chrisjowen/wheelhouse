<script lang="ts">
	import { tick } from 'svelte';
	import { ArrowLeft, ArrowRight } from '@lucide/svelte';
	import { Button } from '$lib/components/ui/button';
	import { SPEC_SECTIONS, sectionFilled, type SpecDraft, type SpecImage } from '$lib/spec';
	import SectionFields from './SectionFields.svelte';
	import SpecPreview from './SpecPreview.svelte';

	/**
	 * The quick form: the spec written by hand one section at a time, with the
	 * assembled spec previewed alongside. Edits write straight into `draft`;
	 * the page saves them.
	 */
	let {
		draft,
		projects,
		imageUrl,
		preview,
		asSent,
		onUpload,
		onRemoveImage,
		uploading,
		uploadError
	}: {
		draft: SpecDraft;
		projects: string[];
		imageUrl: (img: SpecImage) => string;
		/** The spec as Markdown, with pictures the page can show. */
		preview: string;
		/** The message as sent. */
		asSent: string;
		onUpload: (files: File[]) => void;
		onRemoveImage: (img: SpecImage) => void;
		uploading: boolean;
		uploadError: string | null;
	} = $props();

	let step = $state(0);
	const section = $derived(SPEC_SECTIONS[step]);
	const filled = $derived(SPEC_SECTIONS.filter((s) => sectionFilled(draft, s.id)).length);

	// Moving to a section brings its heading into view and gives it focus.
	let heading: HTMLHeadingElement | undefined = $state();
	async function go(i: number) {
		step = i;
		await tick();
		if (!heading) return;
		if (heading.getBoundingClientRect().top < 64) heading.scrollIntoView({ block: 'start' });
		heading.focus({ preventScroll: true });
	}
</script>

<div class="grid items-start gap-8 xl:grid-cols-2">
	<section class="min-w-0 scroll-mt-20" aria-labelledby="section-heading">
		<div class="flex flex-wrap items-baseline gap-3">
			<label>
				<span class="sr-only">Section</span>
				<select
					class="h-8 rounded-md border border-input bg-card px-2 text-xs"
					value={step}
					onchange={(e) => go(Number(e.currentTarget.value))}
				>
					{#each SPEC_SECTIONS as s, i (s.id)}
						<option value={i}
							>Step {i + 1} of {SPEC_SECTIONS.length}: {s.title}{sectionFilled(draft, s.id)
								? ' ✓'
								: ''}</option
						>
					{/each}
				</select>
			</label>
			<p class="text-xs text-muted-foreground">
				{filled} of {SPEC_SECTIONS.length} sections written
			</p>
		</div>
		<h2
			id="section-heading"
			bind:this={heading}
			tabindex="-1"
			class="mt-2 scroll-mt-20 font-display text-2xl font-medium outline-none"
		>
			{section.title}
		</h2>
		<p class="mt-1 max-w-prose text-sm text-muted-foreground">{section.prompt}</p>
		<p class="mt-3 max-w-prose border-l-2 border-hair pl-3 text-sm text-muted-foreground italic">
			<span class="not-italic">For example:</span>
			{section.example}
		</p>

		<div class="mt-6">
			{#key section.id}
				<SectionFields
					{draft}
					section={section.id}
					{projects}
					{imageUrl}
					{onUpload}
					{onRemoveImage}
					{uploading}
					{uploadError}
				/>
			{/key}
		</div>

		<div class="mt-8 flex flex-wrap items-center gap-3 border-t border-hair pt-5">
			<Button variant="ghost" onclick={() => go(step - 1)} disabled={step === 0}>
				<ArrowLeft aria-hidden="true" />Back
			</Button>
			{#if step < SPEC_SECTIONS.length - 1}
				<Button variant="outline" onclick={() => go(step + 1)}>
					Next: {SPEC_SECTIONS[step + 1].title}<ArrowRight aria-hidden="true" />
				</Button>
			{:else}
				<p class="text-sm text-muted-foreground">
					That is every section. Read the preview, then send it to build.
				</p>
			{/if}
		</div>
	</section>

	<section class="min-w-0 xl:sticky xl:top-20" aria-labelledby="preview-heading">
		<h2 id="preview-heading" class="section-label">Preview</h2>
		<div class="mt-3">
			<SpecPreview
				text={preview}
				sent={asSent}
				focus={section.id === 'project' ? null : section.title}
			/>
		</div>
	</section>
</div>
