<script lang="ts">
	/**
	 * The report a decision rests on, embedded in the decision at the part it
	 * points at (lib/docsection.ts): the section its words name, else the one
	 * holding the captain's calls, else the whole report, in a scrolling sheet.
	 * The whole file opens in the reader (DocModal). The report is the one the
	 * question names, else the first report among the documents it rests on,
	 * read through the inbox's own reader; nothing shows when there is none.
	 */
	import { FileText } from '@lucide/svelte';
	import { markdown } from '$lib/chat/markdown';
	import { sectionFor } from '$lib/docsection';
	import type { InboxCard, InboxDoc } from '$lib/inbox';
	import DocModal from './DocModal.svelte';

	let { card }: { card: InboxCard } = $props();

	const docs = $derived(card.evidence.docs ?? []);
	const named = $derived(card.evidence.report?.path ?? null);
	const doc = $derived(
		docs.find((d) => d.kind === 'report' && d.url && d.path === named) ??
			docs.find((d) => d.kind === 'report' && d.url) ??
			null
	);

	let read = $state<{ url: string; text: string | null } | null>(null);
	let reading = $state<InboxDoc | null>(null);

	$effect(() => {
		const url = doc?.url;
		if (!url || read?.url === url) return;
		read = { url, text: null };
		void fetch(url)
			.then((r) => (r.ok ? r.text() : null))
			.catch(() => null)
			.then((text) => {
				if (read?.url === url) read = { url, text };
			});
	});

	const section = $derived(
		read?.text ? sectionFor(read.text, [card.question, card.title, card.evidence.text]) : null
	);
</script>

{#if doc && read && read.text !== null && section}
	<div class="overflow-hidden rounded-lg border bg-card" data-decision-source>
		<div class="flex flex-wrap items-center gap-x-2 gap-y-1 border-b bg-panel px-3 py-2 text-xs">
			<FileText class="size-3.5 shrink-0 text-brass" aria-hidden="true" />
			<span class="font-medium">{section.heading ?? 'Report'}</span>
			<span class="min-w-0 flex-1 truncate font-mono text-muted-foreground">{doc.path}</span>
			<button
				type="button"
				class="cursor-pointer rounded px-2 py-1 text-muted-foreground hover:bg-accent hover:text-foreground max-md:min-h-11"
				aria-haspopup="dialog"
				onclick={() => (reading = doc)}
				data-source-whole>Read the whole report</button
			>
		</div>
		<div
			class="max-h-[30rem] overflow-y-auto px-4 py-3 text-sm sm:px-6"
			data-source-section={section.heading ?? ''}
		>
			<!-- eslint-disable-next-line svelte/no-at-html-tags -- sanitised by DOMPurify in markdown() -->
			<div class="chat-md">{@html markdown(section.text, { docLinks: true })}</div>
		</div>
	</div>
{/if}

<DocModal bind:doc={reading} />
