<script lang="ts">
	/**
	 * A task record at its permanent address: the report on a sheet of paper,
	 * its linked images inline, any static HTML it links shown in a sandbox with
	 * scripts off, and beside it the permanent link, the task's prototypes (live
	 * things, never part of the record), where it was promoted, and its details
	 * (the only place the task id shows). Promote it into the library, copy its
	 * link, or bring it into a Live discussion.
	 */
	import { browser } from '$app/environment';
	import {
		ArrowLeft,
		BookOpen,
		BookPlus,
		Check,
		Copy,
		FileText,
		Link2,
		MonitorPlay,
		PackageCheck,
		RadioTower,
		ShieldCheck
	} from '@lucide/svelte';
	import { renderDoc } from '$lib/chat/markdown';
	import { fileHref } from '$lib/docpath';
	import {
		docDate,
		libraryHref,
		linkPrototype,
		prototypeHref,
		recordHref,
		shelfName,
		shortHref,
		STATE_WORDS
	} from '$lib/documents';
	import DocSheet from '$lib/components/wh/DocSheet.svelte';
	import PromoteDialog from '$lib/components/wh/docs/PromoteDialog.svelte';
	import LiveDocPicker from '$lib/components/wh/docs/LiveDocPicker.svelte';

	let { data } = $props();
	const view = $derived(data.view);
	const r = $derived(view.record);
	const dir = $derived(view.file.slice(0, view.file.lastIndexOf('/')));
	const filesHref = (rel: string) =>
		`${recordHref(r.key)}/files/${rel.split('/').map(encodeURIComponent).join('/')}`;
	// The title is shown above; drop a matching first heading from the body.
	const body = $derived(
		linkPrototype(view.markdown, r.prototypes[0]).replace(
			/^(?:---\n[\s\S]*?\n---\n)?\s*#\s+(.+)\n/,
			(m, h: string) => (h.trim() === r.title ? '' : m)
		)
	);
	// The files the report links are served from the record itself, which always holds them.
	const html = $derived.by(() => {
		if (!browser) return null;
		let out = renderDoc(body, view.file);
		for (const f of view.files) {
			const from = fileHref(`${dir}/${f.path}`).replace(/&/g, '&amp;');
			out = out.split(`"${from}"`).join(`"${filesHref(f.path)}"`);
		}
		return out;
	});
	const pages = $derived(view.files.filter((f) => /\.html?$/i.test(f.path)));
	const permalink = $derived(recordHref(r.key));

	let copied = $state(false);
	async function copy() {
		await navigator.clipboard?.writeText(new URL(permalink, location.origin).href).catch(() => {});
		copied = true;
		setTimeout(() => (copied = false), 1600);
	}
	let promoting = $state(false);
	let picking = $state(false);
	const kb = (n: number) => (n < 1024 ? `${n} B` : `${(n / 1024).toFixed(1)} KB`);
	const btn =
		'inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-md border px-2.5 text-sm hover:bg-accent disabled:cursor-default disabled:opacity-50';
</script>

<svelte:head><title>{r.title} · Documents · Wheelhouse</title></svelte:head>

<main class="doc-page">
	<div class="doc-bar">
		<a
			href="/documents"
			class="inline-flex shrink-0 items-center gap-1.5 text-muted-foreground hover:text-foreground"
			><ArrowLeft class="size-4" aria-hidden="true" />Documents</a
		>
		<span class="hidden min-w-0 truncate text-muted-foreground sm:inline"
			>/ {shelfName(r.project)} /
			<span class="font-medium text-foreground">{r.title}</span></span
		>
		<span class="ml-auto flex shrink-0 items-center gap-1.5">
			<button type="button" class={btn} onclick={copy} data-copy-link
				>{#if copied}<Check class="size-4" aria-hidden="true" />Copied{:else}<Link2
						class="size-4"
						aria-hidden="true"
					/>Copy link{/if}</button
			>
			<button type="button" class="{btn} max-sm:hidden" onclick={() => (picking = true)}
				><RadioTower class="size-4" aria-hidden="true" />Bring into Live</button
			>
			{#if view.promotedTo}
				<a href={libraryHref(view.promotedTo.key)} class="{btn} border-gold/50 text-gold"
					><BookOpen class="size-4" aria-hidden="true" />In library</a
				>
			{:else}
				<button
					type="button"
					class="{btn} border-gold/60 bg-gold/10 text-gold"
					disabled={!!data.libraryProblem}
					title={data.libraryProblem ?? undefined}
					onclick={() => (promoting = true)}
					data-promote><BookPlus class="size-4" aria-hidden="true" />Promote to library</button
				>
			{/if}
		</span>
	</div>

	<DocSheet {html} text={body}>
		{#snippet header()}
			<p
				class="flex items-center gap-2 font-display text-[1.05rem] tracking-[0.1em] text-muted-foreground [font-variant-caps:all-small-caps]"
			>
				{#if r.kind === 'ship'}<PackageCheck class="size-4" aria-hidden="true" />Ship summary{:else}<FileText
						class="size-4"
						aria-hidden="true"
					/>Report{/if}
				· {shelfName(r.project)}{#if r.mate}<span class="text-working">@{r.mate}</span>{/if}
			</p>
			<h1 id="doc-title" class="mt-3">{r.title}</h1>
			<p class="mt-4 text-sm text-muted-foreground">
				Written {docDate(r.at)}{#if r.tags.length}
					· {#each r.tags as t (t)}<a
							href="/documents?q={encodeURIComponent(`#${t}`)}"
							class="mr-1.5 font-mono text-xs hover:underline">#{t}</a
						>{/each}{/if}
			</p>
		{/snippet}
		{#snippet footer()}
			{#if pages.length}
				<section class="mt-12 grid gap-6" aria-label="Attached pages">
					{#each pages as f (f.path)}
						<figure class="overflow-hidden rounded-md border border-hair" data-attachment={f.path}>
							<figcaption
								class="flex items-center gap-2 border-b border-hair bg-muted px-3 py-1.5 font-sans text-xs text-muted-foreground"
							>
								<ShieldCheck class="size-3.5" aria-hidden="true" /><span
									class="min-w-0 flex-1 truncate font-mono">{f.path}</span
								><span>sandboxed, scripts off</span><a
									href={filesHref(f.path)}
									target="_blank"
									rel="noreferrer"
									class="text-sea hover:underline">Open alone</a
								>
							</figcaption>
							<iframe
								sandbox=""
								src={filesHref(f.path)}
								title={f.path}
								class="h-[28rem] w-full bg-white"
								loading="lazy"
							></iframe>
						</figure>
					{/each}
				</section>
			{/if}
			{#if view.truncated}<p class="mt-10">
					This report is long, so only its start is shown here.
				</p>{/if}
		{/snippet}
		{#snippet aside()}
			<div class="grid grid-cols-[minmax(0,1fr)] gap-4 text-sm">
				<section class="rounded-lg border bg-card p-3.5">
					<p class="mono-label">Permanent link</p>
					<div
						class="mt-2 flex items-center gap-2 rounded-md border border-hair bg-muted px-2 py-1.5"
					>
						<Link2 class="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
						<span class="min-w-0 flex-1 truncate font-mono text-xs" data-permalink>{permalink}</span
						>
						<button
							type="button"
							class="cursor-pointer text-muted-foreground hover:text-foreground"
							aria-label="Copy the link"
							onclick={copy}><Copy class="size-3.5" /></button
						>
					</div>
					<p class="mt-2 text-xs text-muted-foreground">
						Short form for chat: <span class="font-mono"
							>{shortHref(r.mate ? `${r.task}@${r.mate}` : r.task)}</span
						>. The link keeps the task id; the title can change.
					</p>
				</section>
				{#if view.prototypes.length}
					<section class="rounded-lg border bg-card p-3.5">
						<p class="mono-label">Prototypes</p>
						<div class="mt-2 grid grid-cols-[minmax(0,1fr)] gap-1.5">
							{#each view.prototypes as p (p.id)}
								<a
									href={prototypeHref(p.id)}
									class="flex items-center gap-2.5 rounded-md border border-working/30 px-2.5 py-2 hover:bg-accent"
									><MonitorPlay class="size-4 shrink-0 text-working" aria-hidden="true" /><span
										class="min-w-0 flex-1"
										><span class="block truncate font-medium">{p.title}</span><span
											class="block text-xs text-muted-foreground">{STATE_WORDS[p.state]}</span
										></span
									><span class="state-dot" data-state={p.state}></span></a
								>
							{/each}
						</div>
						<p class="mt-2 text-xs text-muted-foreground">
							Not part of the record: a prototype is the live thing, linked here.
						</p>
					</section>
				{/if}
				{#if view.promotedTo}
					<section class="rounded-lg border bg-card p-3.5">
						<p class="mono-label">Promoted to</p>
						<a
							href={libraryHref(view.promotedTo.key)}
							class="mt-2 flex items-center gap-2.5 rounded-md border border-gold/40 px-2.5 py-2 hover:bg-accent"
							><BookOpen class="size-4 shrink-0 text-gold" aria-hidden="true" /><span
								class="min-w-0"
								><span class="block truncate font-medium">{view.promotedTo.title}</span><span
									class="block text-xs text-muted-foreground"
									>library · {view.promotedTo.status}</span
								></span
							></a
						>
					</section>
				{/if}
				<section class="rounded-lg border bg-card p-3.5">
					<p class="mono-label">Details</p>
					<dl class="mt-2 grid grid-cols-[6rem_1fr] gap-x-3 gap-y-1.5 text-xs">
						<dt class="text-muted-foreground">Task id</dt>
						<dd class="font-mono break-all" data-task-id>{r.task}</dd>
						<dt class="text-muted-foreground">Home</dt>
						<dd>{r.mate ? `second mate ${r.mate}` : 'this home'}</dd>
						<dt class="text-muted-foreground">Kind</dt>
						<dd>{r.kind === 'ship' ? 'ship summary' : 'report'}</dd>
						{#if view.finished}<dt class="text-muted-foreground">Finished</dt>
							<dd>{view.finished}</dd>{/if}
						<dt class="text-muted-foreground">Source</dt>
						<dd class="font-mono break-all">{view.source}/</dd>
					</dl>
					<p class="mono-label mt-4">Files</p>
					<ul class="mt-1.5 grid gap-1 text-xs">
						<li class="flex gap-2">
							<a
								href={filesHref('report.md')}
								class="min-w-0 flex-1 truncate font-mono hover:underline">report.md</a
							><span class="text-muted-foreground">{kb(r.bytes)}</span>
						</li>
						{#each view.files as f (f.path)}
							<li class="flex gap-2">
								<a
									href={filesHref(f.path)}
									class="min-w-0 flex-1 truncate font-mono hover:underline">{f.path}</a
								><span class="text-muted-foreground">{kb(f.bytes)}</span>
							</li>
						{/each}
					</ul>
					<p class="mt-2 text-xs text-muted-foreground">The report and the files it links.</p>
				</section>
			</div>
		{/snippet}
	</DocSheet>
</main>

<PromoteDialog bind:open={promoting} record={r} shelves={data.shelves} folders={data.folders} />
<LiveDocPicker bind:open={picking} preselect={r.key} />
