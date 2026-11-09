<script lang="ts">
	import { ArrowUpRight, Eye, GitPullRequest, Hand, RefreshCw } from '@lucide/svelte';
	import { ago } from '$lib/format';
	import type { MatePeek, MateTask, SecondMate } from '$lib/types';
	import MateHealthPill from './MateHealthPill.svelte';

	/**
	 * One second mate on the Second mates page: its health, projects, the work
	 * in flight in its home (with live status), its queue, what landed and the
	 * pull requests it names, how many questions it has open (each is a card
	 * in Decisions), and, only when the captain asks, a bounded read-only look
	 * at its own terminal. Nothing here steers or messages it.
	 */
	let { mate, now }: { mate: SecondMate; now: number } = $props();

	let peek = $state<MatePeek | null>(null);
	let looking = $state(false);
	async function look() {
		if (looking) return;
		looking = true;
		try {
			const r = await fetch(`/api/second-mates/${encodeURIComponent(mate.id)}/peek?lines=40`);
			peek = r.ok
				? ((await r.json()) as MatePeek)
				: {
						available: false,
						offline: false,
						reason: `Wheelhouse answered ${r.status}.`,
						lines: [],
						capturedAt: null,
						requested: 40
					};
		} catch {
			peek = {
				available: false,
				offline: false,
				reason: 'Could not reach the Wheelhouse server.',
				lines: [],
				capturedAt: null,
				requested: 40
			};
		} finally {
			looking = false;
		}
	}

	const STATUS_TONE: Partial<Record<MateTask['status'], string>> = {
		'needs-decision': 'text-sea',
		blocked: 'text-danger',
		failed: 'text-danger',
		unknown: 'text-warning',
		working: 'text-foreground'
	};
	const edge = $derived(
		mate.tone === 'captain'
			? 'border-l-sea'
			: mate.tone === 'trouble'
				? 'border-l-warning'
				: 'border-l-border'
	);
</script>

{#snippet taskList(list: MateTask[], empty: string)}
	{#if list.length}
		<ul class="divide-y rounded-lg border bg-card">
			{#each list as t (t.id)}
				<li class="px-3 py-2 text-sm" data-mate-task={t.id}>
					<div class="flex flex-wrap items-baseline gap-x-2">
						<span class="font-medium {STATUS_TONE[t.status] ?? 'text-muted-foreground'}"
							>{t.statusLabel}</span
						>
						<span class="min-w-0 flex-1 truncate" title={t.id}>{t.title}</span>
						{#if t.projectId}
							<span class="shrink-0 rounded border px-1 font-mono text-xs leading-4"
								>{t.projectId}</span
							>
						{/if}
					</div>
					{#if t.doing}
						<p class="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{t.doing}</p>
					{/if}
					{#if t.pr}
						<a
							href={t.pr.url}
							target="_blank"
							rel="noreferrer"
							class="mt-0.5 block text-xs break-all text-sea hover:underline">{t.pr.url}</a
						>
					{/if}
				</li>
			{/each}
		</ul>
	{:else}
		<p class="text-sm text-muted-foreground">{empty}</p>
	{/if}
{/snippet}

<article
	id="mate-{mate.id}"
	class="surface scroll-mt-24 border-l-[3px] p-5 sm:p-6 {edge}"
	data-second-mate={mate.id}
>
	<header class="flex flex-wrap items-center gap-2">
		<h2 class="text-xl">{mate.id}</h2>
		<MateHealthPill health={mate.health} />
		<span class="text-sm text-muted-foreground">
			{mate.where === 'remote' ? `Remote, on ${mate.host ?? 'another host'}` : 'On this computer'}
			· {mate.stateLabel}
		</span>
	</header>

	<dl class="mt-3 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-[auto_1fr]">
		<dt class="text-muted-foreground">Health</dt>
		<dd>
			{mate.health.text}{mate.health.observedAt
				? ` · read ${ago(mate.health.observedAt, now)}`
				: ''}
			{#if mate.health.reason && mate.health.online !== 'online'}
				<span class="block text-xs text-muted-foreground">{mate.health.reason}</span>
			{/if}
		</dd>
		<dt class="text-muted-foreground">Host load</dt>
		<dd>
			{#if mate.health.host.cpu || mate.health.host.memory || mate.health.host.disk}
				CPU {mate.health.host.cpu ?? '–'} · memory {mate.health.host.memory ?? '–'} · disk {mate
					.health.host.disk ?? '–'}
			{:else}
				<span class="text-muted-foreground">Not available.</span>
				{#if mate.health.hostNote}
					<span class="block text-xs text-muted-foreground">{mate.health.hostNote}</span>
				{/if}
			{/if}
		</dd>
		<dt class="text-muted-foreground">Projects</dt>
		<dd>
			{#if mate.projects.length}
				{mate.projects.join(', ')}
			{:else}
				<span class="text-muted-foreground">None of its work names a project.</span>
			{/if}
		</dd>
		{#if mate.home}
			<dt class="text-muted-foreground">Home</dt>
			<dd class="font-mono text-xs break-all">{mate.home}</dd>
		{/if}
		{#if mate.lastReport}
			<dt class="text-muted-foreground">Last report</dt>
			<dd>
				{mate.lastReport.text}{mate.lastReport.ageSeconds !== null
					? ` (${ago(new Date(now - mate.lastReport.ageSeconds * 1000).toISOString(), now)})`
					: ''}
			</dd>
		{/if}
	</dl>

	{#if mate.decisions}
		<a
			href="/inbox"
			class="mt-4 flex items-center gap-1.5 rounded-lg border bg-card px-3 py-2 text-sm hover:border-foreground/20"
		>
			<Hand class="size-4 text-sea" aria-hidden="true" />
			{`${mate.decisions} ${mate.decisions === 1 ? 'open question' : 'open questions'}${
				mate.captainDecisions ? `, ${mate.captainDecisions} waiting on you` : ''
			}, in Decisions`}
			<ArrowUpRight class="ml-auto size-3.5" />
		</a>
	{/if}

	<section class="mt-5" aria-label="In flight">
		<h3 class="section-label mb-2">
			In flight <span class="tabular">{mate.inFlight.length}</span>
		</h3>
		{@render taskList(mate.inFlight, 'Nothing in flight.')}
	</section>

	<section class="mt-5" aria-label="Queued">
		<h3 class="section-label mb-2">Queued <span class="tabular">{mate.queued.length}</span></h3>
		{@render taskList(mate.queued, 'Nothing queued.')}
	</section>

	<section class="mt-5" aria-label="Pull requests and previews">
		<h3 class="section-label mb-2">Pull requests and previews</h3>
		{#if mate.prs.length}
			<ul class="flex flex-col gap-1 text-sm">
				{#each mate.prs as pr (pr.url)}
					<li class="flex items-baseline gap-2">
						<GitPullRequest class="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
						<a href={pr.url} target="_blank" rel="noreferrer" class="text-sea hover:underline"
							>{pr.number ? `#${pr.number}` : pr.url}</a
						>
						<span class="min-w-0 truncate text-muted-foreground">{pr.title}</span>
						{#if pr.landed}<span class="text-xs text-success">Landed</span>{/if}
					</li>
				{/each}
			</ul>
		{:else}
			<p class="text-sm text-muted-foreground">No pull requests in what it reports.</p>
		{/if}
		{#if mate.previews.length}
			<ul class="mt-2 flex flex-col gap-1 text-sm">
				{#each mate.previews as p (p.url)}
					<li><a href={p.url} class="text-sea hover:underline">{p.url}</a></li>
				{/each}
			</ul>
		{:else if mate.previewNote}
			<p class="mt-1 text-xs text-muted-foreground">Previews not available. {mate.previewNote}</p>
		{/if}
	</section>

	<section class="mt-5" aria-label="Landed">
		<h3 class="section-label mb-2">Landed <span class="tabular">{mate.landed.length}</span></h3>
		{@render taskList(mate.landed, 'Nothing landed that it reports.')}
	</section>

	{#if mate.omitted.length}
		<p class="mt-3 text-xs text-muted-foreground">
			Firstmate’s summary leaves out {mate.omitted.join(', ')}.
		</p>
	{/if}

	<section class="mt-5" aria-label="A look at it">
		<div class="flex flex-wrap items-center gap-2">
			<h3 class="section-label flex-1">What it is doing</h3>
			{#if mate.peek.available}
				<button
					class="flex cursor-pointer items-center gap-1 rounded-md border px-2 py-1 text-xs hover:bg-muted disabled:opacity-60"
					onclick={look}
					disabled={looking}
				>
					{#if peek}
						<RefreshCw class="size-3.5" />Look again
					{:else}
						<Eye class="size-3.5" />Look at its terminal
					{/if}
				</button>
			{/if}
		</div>
		{#if !mate.peek.available}
			<p class="mt-1 text-sm text-muted-foreground">
				Not available. {mate.peek.reason ?? 'Its terminal cannot be read.'}
			</p>
		{:else if looking && !peek}
			<p class="mt-1 text-sm text-muted-foreground" aria-busy="true">Looking…</p>
		{:else if peek}
			{#if peek.available}
				<pre
					class="mt-2 max-h-80 overflow-auto rounded-lg border bg-muted/40 p-3 font-mono text-xs leading-snug whitespace-pre-wrap">{peek.lines.join(
						'\n'
					)}</pre>
				<p class="mt-1 text-xs text-muted-foreground">
					The last {peek.lines.length} lines{peek.capturedAt
						? `, ${ago(peek.capturedAt, now)}`
						: ''}. Read-only.
				</p>
			{:else}
				<p class="mt-1 text-sm {peek.offline ? 'text-warning' : 'text-muted-foreground'}">
					{peek.reason}
				</p>
			{/if}
		{:else}
			<p class="mt-1 text-sm text-muted-foreground">
				A read-only look at the last lines of its own terminal, when you ask.
			</p>
		{/if}
	</section>
</article>
