<script lang="ts">
	/**
	 * What a decision rests on: where the work can be seen (its preview and
	 * board, DecisionWhere), the report its question names (read on demand),
	 * then, behind Evidence, the review's findings, Firstmate's own words, the
	 * pull request and the screenshots. Shared by the decision cards on the
	 * Decisions page and in the chat.
	 */
	import { ChevronDown, FileText, GitPullRequest } from '@lucide/svelte';
	import { markdown } from '$lib/chat/markdown';
	import type { InboxCard } from '$lib/inbox';
	import LinkedText from '$lib/components/wh/LinkedText.svelte';
	import { docHref } from '$lib/docpath';
	import DecisionWhere from './DecisionWhere.svelte';

	let {
		card,
		expanded = false,
		onToggle
	}: { card: InboxCard; expanded?: boolean; onToggle?: () => void } = $props();

	const ev = $derived(card.evidence);
	const choices = $derived(card.choices);
	const hasEvidence = $derived(
		!!(ev.text || ev.findings.length || ev.pr || ev.screenshots.length || ev.file || choices)
	);

	/** The report the question names, read on demand. */
	let report = $state<{ open: boolean; text: string | null; error: string | null }>({
		open: false,
		text: null,
		error: null
	});
	async function toggleReport() {
		report.open = !report.open;
		const url = ev.report?.url;
		if (!report.open || report.text !== null || !url) return;
		try {
			const r = await fetch(url);
			if (!r.ok) throw new Error();
			report.text = await r.text();
			report.error = null;
		} catch {
			report.error = 'The report could not be read.';
		}
	}
</script>

<DecisionWhere {card} />

{#if ev.report}
	<div class="mt-2 text-xs">
		{#if ev.report.url}
			<button
				class="inline-flex cursor-pointer items-center gap-1 text-sea hover:underline"
				aria-expanded={report.open}
				onclick={toggleReport}
				><FileText class="size-3.5 shrink-0" aria-hidden="true" />{report.open
					? 'Hide the report'
					: 'Read the report'}<span class="ml-1 font-mono break-all text-muted-foreground"
					>{ev.report.path}</span
				></button
			>
			<a
				href={docHref(ev.report.path)}
				class="ml-2 text-sea underline-offset-2 hover:underline"
				data-doc-link>Open in the reader</a
			>
		{:else}
			<span class="inline-flex items-center gap-1 text-muted-foreground"
				><FileText class="size-3.5 shrink-0" aria-hidden="true" />Report
				<span class="font-mono break-all">{ev.report.path}</span> (not found)</span
			>
		{/if}
		{#if report.open}
			<div
				class="mt-2 max-h-[28rem] overflow-y-auto rounded-md border bg-background/60 px-3 py-2 text-sm"
			>
				{#if report.error}
					<p class="text-danger" role="alert">{report.error}</p>
				{:else if report.text === null}
					<p class="text-muted-foreground">Reading the report…</p>
				{:else}
					<!-- eslint-disable-next-line svelte/no-at-html-tags -- sanitised by DOMPurify in markdown() -->
					<div class="chat-md">{@html markdown(report.text)}</div>
				{/if}
			</div>
		{/if}
	</div>
{/if}

{#if hasEvidence}
	<button
		class="mt-3 flex cursor-pointer items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"
		aria-expanded={expanded}
		onclick={onToggle}
		>Evidence<ChevronDown
			class="size-3.5 transition-transform {expanded ? 'rotate-180' : ''}"
			aria-hidden="true"
		/>{#if !expanded}<span class="font-normal"
				>{ev.findings.length
					? ` · ${ev.findings.length} ${ev.findings.length === 1 ? 'finding' : 'findings'}`
					: ''}{ev.pr ? ' · pull request' : ''}{ev.screenshots.length
					? ` · ${ev.screenshots.length} ${ev.screenshots.length === 1 ? 'screenshot' : 'screenshots'}`
					: ''}</span
			>{/if}</button
	>
	{#if expanded}
		<div class="mt-2 space-y-3 rounded-md border bg-background/60 p-3 text-sm">
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
			{#if choices}
				<div>
					<p class="text-xs font-medium text-muted-foreground">As Firstmate wrote it</p>
					<p class="mt-0.5 leading-relaxed text-muted-foreground">
						<LinkedText text={card.question} />
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
			{#if ev.screenshots.length}
				<ul class="flex flex-wrap gap-2">
					{#each ev.screenshots as s (s.url)}
						<li>
							<a href={s.url} target="_blank" rel="noreferrer" class="block">
								<img
									src={s.url}
									alt={s.name}
									class="h-20 w-32 rounded border object-cover object-top"
									loading="lazy"
								/>
							</a>
						</li>
					{/each}
				</ul>
			{/if}
		</div>
	{/if}
{/if}
