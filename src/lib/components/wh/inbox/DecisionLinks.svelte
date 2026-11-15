<script lang="ts">
	/**
	 * What a decision rests on, always on show: a link to its task (and the
	 * task it came from), the documents it names or that sit in those tasks'
	 * data folders (each read here, in a closable reader), and where the work
	 * can be seen, with thumbnails of the preview and the screenshots
	 * (DecisionWhere). Shared by the decision cards on the Decisions page and in
	 * the chat; the rest (Firstmate's own words, findings, the pull request)
	 * sits folded under DecisionDetails.
	 */
	import { FileCode, FileText, ListChecks, Link2 } from '@lucide/svelte';
	import { cardTaskHref, type InboxCard, type InboxDoc } from '$lib/inbox';
	import DecisionWhere from './DecisionWhere.svelte';
	import DocModal from './DocModal.svelte';

	let { card }: { card: InboxCard } = $props();

	const docs = $derived(card.evidence.docs ?? []);
	/** The task as its id: the one in a second mate's home, else the second mate's own, else the card's. */
	const taskName = $derived(
		card.secondMate ? (card.secondMate.taskId ?? card.secondMate.id) : card.taskId
	);
	let reading = $state<InboxDoc | null>(null);

	const KIND = { report: 'Report', doc: 'Doc', patch: 'Patch' } as const;
	const fileName = (d: InboxDoc) =>
		d.kind === 'report' ? d.path : (d.path.split('/').pop() ?? d.path);
	const chip =
		'inline-flex min-h-8 max-w-full items-center gap-1.5 rounded-md border bg-background px-2.5 text-[0.8rem] transition-colors hover:bg-accent max-md:min-h-11';
	const mono = 'min-w-0 truncate font-mono text-[0.75rem] text-muted-foreground';
</script>

<div class="mt-2.5 flex flex-wrap items-center gap-1.5" data-decision-links>
	<a
		href={cardTaskHref(card)}
		class="{chip} border-brass/60 font-medium"
		title="Open the task"
		data-decision-task
		><ListChecks class="size-3.5 shrink-0 text-brass" aria-hidden="true" />Task
		<span class={mono}>{taskName}</span></a
	>
	{#if card.origin}
		<a
			href="/tasks/{encodeURIComponent(card.origin)}"
			class={chip}
			title="The task this decision came from"
			data-decision-origin
			><Link2 class="size-3.5 shrink-0" aria-hidden="true" />From
			<span class={mono}>{card.origin}</span></a
		>
	{/if}
	{#each docs as d (d.path)}
		{@const Icon = d.kind === 'patch' ? FileCode : FileText}
		{#if d.url}
			<button
				type="button"
				class="{chip} cursor-pointer"
				aria-haspopup="dialog"
				title="Read {d.path}"
				onclick={() => (reading = d)}
				data-decision-doc={d.kind}
				><Icon class="size-3.5 shrink-0" aria-hidden="true" />{KIND[d.kind]}
				<span class={mono}>{fileName(d)}</span></button
			>
		{:else}
			<span class="{chip} text-muted-foreground hover:bg-background" data-decision-doc="missing"
				><Icon class="size-3.5 shrink-0" aria-hidden="true" />{KIND[d.kind]}
				<span class={mono}>{fileName(d)}</span> (not found)</span
			>
		{/if}
	{/each}
</div>

<DecisionWhere {card} />

<DocModal bind:doc={reading} />
