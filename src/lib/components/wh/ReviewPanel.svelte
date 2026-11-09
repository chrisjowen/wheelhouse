<script lang="ts">
	import type { TaskSummary } from '$lib/types';
	import { Button } from '$lib/components/ui/button';
	import { reviewView, type ReviewShot } from '$lib/review';
	import { pullRequests } from '$lib/client/pullrequests';
	import { previewChecks } from '$lib/client/previewchecks.svelte';
	import type { Box } from '$lib/motion';
	import { Compass, ExternalLink, ImageOff, MonitorOff, MonitorPlay } from '@lucide/svelte';
	import Lightbox from './Lightbox.svelte';
	import PreviewStudio from './PreviewStudio.svelte';

	let { task, shots }: { task: TaskSummary; shots: ReviewShot[] } = $props();
	const rv = $derived(reviewView(task, shots));
	const prLink = $derived(rv.pr ? pullRequests.review(task.projectId, rv.pr) : null);

	// The worker's own preview is checked, and not linked while it has stopped (a declared link,
	// such as a preview deployment, is not on this machine and is linked as it is).
	const own = $derived(!!task.preview && rv.preview?.url === task.preview.url);
	$effect(() => {
		if (own) return previewChecks.watch(task.id);
	});
	const stopped = $derived(own && previewChecks.stopped(task.id));

	let enlarged = $state<number | null>(null);

	// The worker's own preview opens in place, growing out of the screenshot (else the button).
	let picture = $state<HTMLElement>();
	let studio = $state<{ from: Box | null } | null>(null);
	function openPreview(e: MouseEvent) {
		studio = { from: (picture ?? (e.currentTarget as HTMLElement)).getBoundingClientRect() };
	}
</script>

<!-- What the captain reviews with: screenshots, the live preview and the PR, up front. -->
<section class="rounded-2xl border border-sea/40 p-3" aria-labelledby="review-evidence">
	<h2 id="review-evidence" class="px-1 pt-1 text-sm font-medium text-sea">Review evidence</h2>

	{#if rv.shots.length}
		<button
			type="button"
			class="mt-3 block w-full cursor-zoom-in"
			bind:this={picture}
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
		{#if stopped}
			<span
				class="inline-flex items-center gap-1.5 text-sm text-muted-foreground"
				data-review="preview"
				><MonitorOff class="size-4" aria-hidden="true" />Preview stopped. {previewChecks.checks[
					task.id
				]?.reason ?? ''}</span
			>
		{:else if rv.preview && own}
			<Button onclick={openPreview} aria-haspopup="dialog" data-open-preview
				><MonitorPlay />Open preview</Button
			>
		{:else if rv.preview}
			<Button href={rv.preview.url} target="_blank" rel="noreferrer"
				>Open preview<ExternalLink /></Button
			>
		{:else}
			<span class="text-sm text-muted-foreground" data-review="preview">{rv.previewText}</span>
		{/if}
		{#if rv.pr && prLink}
			<!-- A plugin's review tab while one is on for the project, else the PR on GitHub. -->
			<Button
				variant={rv.preview && !stopped ? 'outline' : 'default'}
				href={prLink.href}
				target={prLink.external ? '_blank' : undefined}
				rel={prLink.external ? 'noreferrer' : undefined}
				data-review-pr
				>{#if !prLink.external}<Compass />{/if}Review {rv.pr
					.label}{#if prLink.external}<ExternalLink />{/if}</Button
			>
			{#if !prLink.external}
				<Button variant="outline" href={rv.pr.url} target="_blank" rel="noreferrer"
					>On GitHub<ExternalLink /></Button
				>
			{/if}
		{:else}
			<span class="text-sm text-muted-foreground" data-review="pr">{rv.prText}</span>
		{/if}
		{#if rv.preview && !stopped}
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
{#if studio && task.preview}
	<PreviewStudio
		taskId={task.id}
		title={task.shortTitle}
		url={task.preview?.url ?? ''}
		from={studio?.from ?? null}
		onclose={() => (studio = null)}
	/>
{/if}
