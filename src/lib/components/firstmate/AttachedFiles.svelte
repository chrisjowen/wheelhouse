<script lang="ts">
	import { CircleAlert, FileText, LoaderCircle, X } from '@lucide/svelte';
	import { fileSize, kindLabel } from '$lib/chat/attachments';
	import { attachments } from '$lib/client/attach.svelte';

	/**
	 * The files waiting to go with the message, under the text in the composer:
	 * one hairline-ruled row each, with a thumbnail for an image, its kind and
	 * size (or how far it has uploaded, or why it failed) and a way to remove it.
	 */
</script>

{#if attachments.drafts.length}
	<ul
		class="mx-2 mb-1 flex flex-col divide-y divide-hair border-t border-hair"
		aria-label="Attached files"
	>
		{#each attachments.drafts as d (d.id)}
			<li class="flex items-center gap-2.5 px-1.5 py-1.5 text-sm" data-attachment={d.state}>
				{#if d.preview}
					<img
						src={d.preview}
						alt=""
						class="size-7 shrink-0 rounded border border-hair object-cover"
					/>
				{:else}
					<span
						class="flex size-7 shrink-0 items-center justify-center rounded bg-sea/10 text-sea"
						aria-hidden="true"><FileText class="size-3.5" /></span
					>
				{/if}
				<span class="min-w-0 truncate font-medium" title={d.name}>{d.name}</span>
				<span
					class="flex shrink-0 items-center gap-1 text-xs {d.state === 'failed'
						? 'text-danger'
						: 'text-muted-foreground'}"
					role={d.state === 'failed' ? 'alert' : undefined}
				>
					{#if d.state === 'uploading'}
						<LoaderCircle class="size-3 animate-spin" aria-hidden="true" />Uploading {Math.round(
							d.progress * 100
						)}%
					{:else if d.state === 'failed'}
						<CircleAlert class="size-3" aria-hidden="true" />{d.error}
					{:else}
						{kindLabel(d)} · {fileSize(d.size)}
					{/if}
				</span>
				<button
					type="button"
					class="ml-auto flex size-7 shrink-0 cursor-pointer items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
					aria-label="Remove {d.name}"
					title="Remove"
					onclick={() => attachments.remove(d.id)}><X class="size-3.5" /></button
				>
			</li>
		{/each}
	</ul>
{/if}
