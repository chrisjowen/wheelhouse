<script lang="ts">
	/**
	 * A decision's internals, folded under Details: its id, when it was asked
	 * and where it came from, the question as Firstmate wrote it, Firstmate's
	 * other words about it, the review's findings, and the pull request. Shared
	 * by the decision cards on the Decisions page and in the chat.
	 */
	import { ChevronDown, FileText, GitPullRequest } from '@lucide/svelte';
	import type { InboxCard } from '$lib/inbox';
	import LinkedText from '$lib/components/wh/LinkedText.svelte';

	let {
		card,
		expanded = false,
		onToggle
	}: { card: InboxCard; expanded?: boolean; onToggle?: () => void } = $props();

	const ev = $derived(card.evidence);
	/** The id Firstmate knows it by: the held task's id, else the task and its decision key. */
	const decisionId = $derived(card.kind === 'hold' ? card.key : `${card.taskId} · ${card.key}`);
	const wrote = $derived(card.question !== card.title ? card.question : null);
	const asked = $derived(
		card.askedAt
			? new Date(card.askedAt).toLocaleString([], {
					day: 'numeric',
					month: 'short',
					hour: '2-digit',
					minute: '2-digit'
				})
			: null
	);
</script>

<button
	class="touch-target mt-3 flex cursor-pointer items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"
	aria-expanded={expanded}
	onclick={onToggle}
	data-details
	>Details<ChevronDown
		class="size-3.5 transition-transform {expanded ? 'rotate-180' : ''}"
		aria-hidden="true"
	/>{#if !expanded}<span class="font-normal"
			>{ev.findings.length
				? ` · ${ev.findings.length} ${ev.findings.length === 1 ? 'finding' : 'findings'}`
				: ''}{ev.pr ? ' · pull request' : ''}</span
		>{/if}</button
>
{#if expanded}
	<div class="mt-2 space-y-3 rounded-md border bg-background/60 p-3 text-sm" data-details-panel>
		<dl class="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
			<dt class="text-muted-foreground">Decision</dt>
			<dd class="min-w-0 font-mono break-all">{decisionId}</dd>
			{#if asked}
				<dt class="text-muted-foreground">Asked</dt>
				<dd>{asked}</dd>
			{/if}
			<dt class="text-muted-foreground">Raised by</dt>
			<dd class="min-w-0 break-words">
				{card.origin ? `Firstmate, from ${card.origin}` : card.taskTitle}
			</dd>
		</dl>
		{#if ev.findings.length}
			<ol class="space-y-2.5">
				{#each ev.findings as f (f.id)}
					<li>
						<p class="leading-snug">
							{#if f.serious}<span
									class="mr-1.5 rounded bg-danger/10 px-1 text-xs font-medium text-danger"
									>Serious</span
								>{/if}<LinkedText text={f.summary} />
						</p>
						{#if f.where}<p class="mt-0.5 font-mono text-xs text-muted-foreground">
								{f.where}
							</p>{/if}
						{#if f.detail}<p class="mt-1 text-xs leading-relaxed text-muted-foreground">
								<LinkedText text={f.detail} />
							</p>{/if}
					</li>
				{/each}
			</ol>
		{/if}
		{#if wrote}
			<div>
				<p class="text-xs font-medium text-muted-foreground">As Firstmate wrote it</p>
				<p class="mt-0.5 leading-relaxed text-muted-foreground">
					<LinkedText text={wrote} />
				</p>
			</div>
		{/if}
		{#if ev.text}<p class="leading-relaxed whitespace-pre-line text-muted-foreground">
				<LinkedText text={ev.text} />
			</p>{/if}
		{#if ev.pr || ev.file}
			<ul class="flex flex-col gap-1 text-xs">
				{#if ev.pr}
					<li>
						<a
							href={ev.pr.url}
							target="_blank"
							rel="noreferrer"
							class="inline-flex items-center gap-1 break-all text-sea hover:underline"
							><GitPullRequest class="size-3.5 shrink-0" aria-hidden="true" />{ev.pr.url}</a
						>{#if ev.checks}<span class="ml-1.5 text-muted-foreground">· checks {ev.checks}</span
							>{/if}
					</li>
				{/if}
				{#if ev.file}
					<li class="inline-flex items-center gap-1 text-muted-foreground">
						<FileText class="size-3.5 shrink-0" aria-hidden="true" />Findings file
						<span class="font-mono break-all">{ev.file}</span>
					</li>
				{/if}
			</ul>
		{/if}
	</div>
{/if}
