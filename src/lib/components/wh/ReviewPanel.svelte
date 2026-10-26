<script lang="ts">
	import type { TaskSummary } from '$lib/types';
	import { Button } from '$lib/components/ui/button';
	import { reviewView, type ReviewShot } from '$lib/review';
	import { Compass, ExternalLink, ImageOff } from '@lucide/svelte';
	import Lightbox from './Lightbox.svelte';

	let { task, shots }: { task: TaskSummary; shots: ReviewShot[] } = $props();
	const rv = $derived(reviewView(task, shots));

	let enlarged = $state<number | null>(null);
</script>

<!-- What the captain reviews with: screenshots, the live preview and the PR, up front. -->
<section class="rounded-2xl border border-sea/40 p-3" aria-labelledby="review-evidence">
	<h2 id="review-evidence" class="px-1 pt-1 text-sm font-medium text-sea">Review evidence</h2>

	{#if rv.shots.length}
		<button
			type="button"
			class="mt-3 block w-full cursor-zoom-in"
			onclick={() => (enlarged = 0)}
			aria-label="Enlarge {rv.shots[0].name}"
		>
			<img
				src={rv.shots[0].url}
				alt={rv.shots[0].name}
				class="aspect-[16/10] w-full rounded-xl border object-cover object-top"
			/>
		</button>
		{#if rv.shots.length > 1}
			<div class="mt-3 flex flex-wrap gap-2">
				{#each rv.shots.slice(1) as s, i (s.url)}
					<button
						type="button"
						class="w-20 shrink-0 cursor-zoom-in"
						onclick={() => (enlarged = i + 1)}
						aria-label="Enlarge {s.name}"
						><img
							src={s.url}
							alt={s.name}
							loading="lazy"
							class="aspect-[16/10] w-full rounded-md border object-cover object-top"
						/></button
					>
				{/each}
			</div>
		{/if}
		<p class="mt-2 px-1 text-xs text-muted-foreground" data-review="screenshots">
			{rv.shotsText}; select one to enlarge.
		</p>
	{:else}
		<div
			class="mt-3 grid aspect-[16/10] w-full place-items-center rounded-xl border border-dashed bg-muted/40 text-center"
			data-review="screenshots"
		>
			<div class="text-muted-foreground">
				<ImageOff class="mx-auto size-6" aria-hidden="true" />
				<p class="mt-2 text-sm font-medium">{rv.shotsText}</p>
				<p class="mt-1 text-xs">The worker has not saved any screenshots for this task.</p>
			</div>
		</div>
	{/if}

	<div class="mt-3 flex flex-wrap items-center gap-2 px-1 pb-1">
		{#if rv.preview}
			<Button href={rv.preview.url} target="_blank" rel="noreferrer"
				>Open preview<ExternalLink /></Button
			>
		{:else}
			<span class="text-sm text-muted-foreground" data-review="preview">{rv.previewText}</span>
		{/if}
		{#if rv.pr}
			<Button
				variant={rv.preview ? 'outline' : 'default'}
				href={rv.pr.url}
				target="_blank"
				rel="noreferrer">Review {rv.pr.label}<ExternalLink /></Button
			>
			<Button variant="outline" href="/tasks/{encodeURIComponent(task.id)}/review"
				><Compass />Guided review</Button
			>
		{:else}
			<span class="text-sm text-muted-foreground" data-review="pr">{rv.prText}</span>
		{/if}
		{#if rv.preview}
			<a
				href={rv.preview.url}
				target="_blank"
				rel="noreferrer"
				class="ml-auto truncate font-mono text-xs text-muted-foreground hover:underline"
				>{rv.preview.url}</a
			>
		{/if}
	</div>
</section>

<Lightbox shots={rv.shots} bind:index={enlarged} />
