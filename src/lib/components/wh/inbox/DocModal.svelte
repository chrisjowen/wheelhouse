<script lang="ts">
	/**
	 * A document a decision rests on (a report, another Markdown file, or a
	 * patch), read in the page over the decision: X, Esc or a click outside
	 * closes it. Markdown is rendered; a patch is shown as written, its added
	 * and removed lines marked. The text comes from the inbox's own reader
	 * (InboxDoc.url), read when it opens.
	 */
	import { ExternalLink, X } from '@lucide/svelte';
	import { markdown } from '$lib/chat/markdown';
	import { DOC_EXT, docHref } from '$lib/docpath';
	import type { InboxDoc } from '$lib/inbox';

	let { doc = $bindable(null) }: { doc?: InboxDoc | null } = $props();

	let dialog = $state<HTMLDialogElement | null>(null);
	let read = $state<{ url: string; text: string | null; error: string | null } | null>(null);
	const name = $derived(doc ? (doc.path.split('/').pop() ?? doc.path) : '');
	const isMarkdown = $derived(!!doc && DOC_EXT.test(doc.path));

	$effect(() => {
		if (!dialog) return;
		if (doc && !dialog.open) dialog.showModal();
		else if (!doc && dialog.open) dialog.close();
	});

	$effect(() => {
		const url = doc?.url;
		if (!url || read?.url === url) return;
		read = { url, text: null, error: null };
		void fetch(url)
			.then(async (r) => {
				if (!r.ok) throw new Error();
				const text = await r.text();
				if (read?.url === url) read = { url, text, error: null };
			})
			.catch(() => {
				if (read?.url === url) read = { url, text: null, error: 'It could not be read.' };
			});
	});

	const lineClass = (l: string) =>
		l.startsWith('+') && !l.startsWith('+++')
			? 'text-success'
			: l.startsWith('-') && !l.startsWith('---')
				? 'text-danger'
				: l.startsWith('@@')
					? 'text-sea'
					: '';
</script>

<dialog
	bind:this={dialog}
	class="m-auto flex max-h-[90vh] w-[min(94vw,56rem)] flex-col overflow-hidden rounded-xl border bg-background p-0 text-foreground shadow-xl backdrop:bg-black/60 [&:not([open])]:hidden"
	onclose={() => (doc = null)}
	onclick={(e) => e.target === dialog && dialog?.close()}
	aria-label={name || 'Document'}
	data-doc-modal
>
	{#if doc}
		<div class="flex items-center gap-2 border-b px-4 py-2.5 text-sm">
			<span class="min-w-0 flex-1">
				<span class="block truncate font-medium">{name}</span>
				<span class="block truncate font-mono text-xs text-muted-foreground">{doc.path}</span>
			</span>
			{#if isMarkdown}
				<a
					href={docHref(doc.path)}
					target="_blank"
					rel="noreferrer"
					class="inline-flex items-center gap-1 rounded px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
					>Open in a new tab<ExternalLink class="size-3.5" aria-hidden="true" /></a
				>
			{/if}
			<button
				type="button"
				class="flex size-9 cursor-pointer items-center justify-center rounded hover:bg-accent"
				onclick={() => dialog?.close()}
				aria-label="Close"><X class="size-4" /></button
			>
		</div>
		<div class="min-h-0 flex-1 overflow-y-auto px-4 py-3 text-sm sm:px-6">
			{#if read?.error}
				<p class="text-danger" role="alert">{read.error}</p>
			{:else if !read || read.text === null}
				<p class="text-muted-foreground">Reading it…</p>
			{:else if isMarkdown}
				<!-- eslint-disable-next-line svelte/no-at-html-tags -- sanitised by DOMPurify in markdown() -->
				<div class="chat-md">{@html markdown(read.text, { docLinks: true })}</div>
			{:else}
				<pre
					class="font-mono text-xs leading-relaxed whitespace-pre-wrap"
					data-patch>{#each read.text.split('\n') as l, i (i)}<span class={lineClass(l)}
							>{`${l}\n`}</span
						>{/each}</pre>
			{/if}
		</div>
	{/if}
</dialog>
