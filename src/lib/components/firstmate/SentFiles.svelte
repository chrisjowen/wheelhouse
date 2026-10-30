<script lang="ts">
	import { FileText } from '@lucide/svelte';
	import { fileSize, kindLabel, thumbUrl, type Attachment } from '$lib/chat/attachments';
	import Lightbox from '$lib/components/wh/Lightbox.svelte';

	/**
	 * A sent message's files, as a card under its bubble: "N files attached",
	 * then one row per file with a thumbnail for an image (click to enlarge),
	 * its name, kind and size. Thumbnails come from Wheelhouse's uploads route,
	 * which serves only real images; a file whose thumbnail cannot load (deleted
	 * after a week, or not an image) shows the plain file icon.
	 */
	let { files, pending = false }: { files: Attachment[]; pending?: boolean } = $props();

	let broken = $state<Record<string, boolean>>({});
	const thumb = (a: Attachment) => (broken[a.path] ? null : thumbUrl(a));
	const images = $derived(files.filter((a) => thumb(a)));
	let open = $state<number | null>(null);
</script>

<div
	class="mt-1.5 w-full max-w-[min(85%,62ch)] min-w-0 rounded-lg border border-hair bg-card px-3 py-2 sm:min-w-72 {pending
		? 'border-dashed opacity-60'
		: ''}"
	data-sent-files
>
	<p
		class="mb-0.5 text-[0.8rem] font-semibold tracking-[0.08em] text-muted-foreground"
		style="font-variant-caps: all-small-caps"
	>
		{files.length === 1 ? '1 file attached' : `${files.length} files attached`}
	</p>
	<ul class="flex flex-col divide-y divide-hair">
		{#each files as a (a.path)}
			{@const src = thumb(a)}
			<li class="flex items-center gap-2.5 py-1.5 text-sm">
				{#if src}
					<button
						type="button"
						class="shrink-0 cursor-zoom-in rounded"
						aria-label="Enlarge {a.name}"
						onclick={() => (open = images.indexOf(a))}
					>
						<img
							{src}
							alt=""
							loading="lazy"
							class="size-10 rounded border border-hair bg-muted object-cover"
							onerror={() => (broken[a.path] = true)}
						/>
					</button>
				{:else}
					<span
						class="flex size-10 shrink-0 items-center justify-center rounded bg-sea/10 text-sea"
						aria-hidden="true"><FileText class="size-4" /></span
					>
				{/if}
				<span class="min-w-0 truncate font-medium" title={a.name}>{a.name}</span>
				<span class="ml-auto shrink-0 pl-2 text-xs text-muted-foreground"
					>{kindLabel(a)} · {fileSize(a.size)}</span
				>
			</li>
		{/each}
	</ul>
</div>

{#if images.length}
	<Lightbox shots={images.map((a) => ({ name: a.name, url: thumb(a) ?? '' }))} bind:index={open} />
{/if}
