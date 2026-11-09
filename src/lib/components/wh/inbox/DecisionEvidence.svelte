<script lang="ts">
	/**
	 * What a decision rests on: the report its question names (read on demand),
	 * then, behind Evidence, the review's findings, Firstmate's own words, the
	 * pull request, the preview and the screenshots. Shared by the decision
	 * cards on the Decisions page and in the chat.
	 */
	import {
		ChevronDown,
		ExternalLink,
		FileText,
		GitPullRequest,
		MonitorOff,
		MonitorPlay
	} from '@lucide/svelte';
	import { previewChecks } from '$lib/client/previewchecks.svelte';
	import { markdown } from '$lib/chat/markdown';
	import type { InboxCard } from '$lib/inbox';
	import LinkedText from '$lib/components/wh/LinkedText.svelte';
	import { docHref } from '$lib/docpath';
	import type { Box } from '$lib/motion';
	import PreviewStudio from '$lib/components/wh/PreviewStudio.svelte';

	let {
		card,
		expanded = false,
		onToggle
	}: { card: InboxCard; expanded?: boolean; onToggle?: () => void } = $props();

	const ev = $derived(card.evidence);
	const choices = $derived(card.choices);
	const hasEvidence = $derived(
		!!(
			ev.text ||
			ev.findings.length ||
			ev.pr ||
			ev.preview ||
			ev.screenshots.length ||
			ev.file ||
			choices
		)
	);

	// While the evidence is open its preview is checked, and not linked once it has stopped.
	$effect(() => {
		if (expanded && ev.preview) return previewChecks.watch(card.taskId);
	});
	const stopped = $derived(!!ev.preview && previewChecks.stopped(card.taskId));
	// The preview opens here, full size with its helper, growing out of the line that opened it.
	let studio = $state<{ from: Box | null } | null>(null);

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
					: ''}{ev.pr ? ' · pull request' : ''}{ev.preview ? ' · preview' : ''}{ev.screenshots
					.length
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
			{#if ev.pr || ev.preview || ev.file}
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
					{#if ev.preview}
						{#if !stopped}<li>
								<button
									type="button"
									class="inline-flex cursor-pointer items-center gap-1 text-sea hover:underline"
									aria-haspopup="dialog"
									onclick={(e) => (studio = { from: e.currentTarget.getBoundingClientRect() })}
									><MonitorPlay class="size-3.5 shrink-0" aria-hidden="true" />Open the preview here</button
								>
							</li>{/if}
						<li>
							{#if stopped}
								<span class="inline-flex items-center gap-1 text-muted-foreground"
									><MonitorOff class="size-3.5 shrink-0" aria-hidden="true" />Preview stopped. {previewChecks
										.checks[card.taskId]?.reason ?? ''}</span
								>
							{:else}
								<a
									href={ev.preview}
									target="_blank"
									rel="noreferrer"
									class="inline-flex items-center gap-1 break-all text-sea hover:underline"
									><ExternalLink class="size-3.5 shrink-0" aria-hidden="true" />{ev.preview}</a
								>
							{/if}
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

{#if studio && ev.preview}
	<PreviewStudio
		taskId={card.taskId}
		title={card.taskTitle}
		url={ev.preview}
		from={studio?.from ?? null}
		onclose={() => (studio = null)}
	/>
{/if}
