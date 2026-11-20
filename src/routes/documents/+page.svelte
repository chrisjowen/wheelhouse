<script lang="ts">
	/**
	 * Documents: every task's report, sealed by its permanent link and listed by
	 * title (never the task id), with the prototypes tasks left behind; and the
	 * Library, documents promoted from records into folders with tags. One
	 * search box filters either tab with words, #tags and key:value filters.
	 */
	import { page } from '$app/state';
	import { replaceState } from '$app/navigation';
	import {
		BookOpen,
		FileText,
		Folder,
		LibraryBig,
		MonitorPlay,
		PackageCheck
	} from '@lucide/svelte';
	import {
		docDate,
		libraryHref,
		prototypeHref,
		recordHref,
		shelfName,
		STATE_WORDS,
		type DocPrototype,
		type DocRecord,
		type LibraryDoc
	} from '$lib/documents';
	import {
		libraryFacts,
		parseQuery,
		prototypeFacts,
		queryText,
		recordFacts,
		search,
		knownToken,
		filterValues,
		groupBy,
		countBy,
		type Facts,
		type SearchTab,
		type Token
	} from '$lib/docsearch';
	import { documents } from '$lib/client/documents.svelte';
	import DocSearch from '$lib/components/wh/docs/DocSearch.svelte';

	let { data } = $props();
	const index = $derived(data.index);
	$effect(() => documents.seed(data.index));

	// Where the page starts: the tab, order and query in its address.
	const params = page.url.searchParams;
	const startTab: SearchTab = params.get('tab') === 'library' ? 'library' : 'records';
	const first = parseQuery(params.get('q') ?? '', startTab);
	const typed = { toks: first.toks, text: first.words.join(' ') };
	const blank = { toks: [] as Token[], text: '' };
	let tab = $state<SearchTab>(startTab);
	let byProject = $state(params.get('view') === 'project');
	let q = $state<Record<SearchTab, { toks: Token[]; text: string }>>({
		records: startTab === 'records' ? typed : { ...blank },
		library: startTab === 'library' ? typed : { ...blank }
	});

	type Item =
		| { type: 'record'; r: DocRecord; facts: Facts }
		| { type: 'proto'; p: DocPrototype; facts: Facts };
	const recordItems = $derived<Item[]>(
		index
			? [
					...index.records.map((r) => ({ type: 'record' as const, r, facts: recordFacts(r) })),
					...index.prototypes.map((p) => ({
						type: 'proto' as const,
						p,
						facts: prototypeFacts(p, index.records.find((r) => r.key === p.record) ?? null)
					}))
				]
			: []
	);
	const libItems = $derived((index?.library ?? []).map((d) => ({ d, facts: libraryFacts(d) })));
	const facts = $derived(
		tab === 'records' ? recordItems.map((i) => i.facts) : libItems.map((i) => i.facts)
	);

	/** The chips, and the filters typed in full: a half-typed one waits. */
	function queryOf(t: SearchTab, all: Facts[]) {
		const typed = parseQuery(q[t].text, t);
		const values = filterValues(t, all);
		return {
			toks: [
				...q[t].toks,
				...typed.toks.filter((k) => k.k === 'tag' || k.k === 'kind' || knownToken(k, values))
			],
			words: typed.words
		};
	}
	const recordHits = $derived(
		search(
			recordItems,
			(i) => i.facts,
			queryOf(
				'records',
				recordItems.map((i) => i.facts)
			)
		).sort((a, b) => b.item.facts.when.localeCompare(a.item.facts.when))
	);
	const libHits = $derived(
		search(
			libItems,
			(i) => i.facts,
			queryOf(
				'library',
				libItems.map((i) => i.facts)
			)
		)
	);

	// The query stays in the address, so a filtered list can be linked to.
	$effect(() => {
		const u = new URL(page.url);
		const text = queryText({ toks: q[tab].toks, words: q[tab].text.split(/\s+/).filter(Boolean) });
		u.searchParams.set('tab', tab);
		if (text) u.searchParams.set('q', text);
		else u.searchParams.delete('q');
		if (tab === 'records' && byProject) u.searchParams.set('view', 'project');
		else u.searchParams.delete('view');
		if (u.search !== page.url.search) replaceState(u, page.state);
	});

	/** Click a #tag, @mate or state on a row (or a folder) to add it as a filter, or take it off. */
	function toggle(tok: Token, only: string[] = []) {
		const cur = q[tab].toks;
		const has = cur.some((t) => t.k === tok.k && t.v === tok.v);
		const rest = cur.filter((t) => !only.includes(t.k));
		q[tab].toks = has
			? cur.filter((t) => !(t.k === tok.k && t.v === tok.v))
			: [...(only.length ? rest : cur), tok];
	}
	const on = (k: string, v: string) => q[tab].toks.some((t) => t.k === k && t.v === v);

	const groups = $derived(groupBy(recordHits, (h) => h.item.facts.project));

	// The library's shelves and their folders, with counts, for the folder tree.
	const shelves = $derived(
		groupBy(index?.library ?? [], (d) => d.shelf).map(([shelf, docs]) => ({
			shelf,
			count: docs.length,
			folders: groupBy(docs, (d) => d.folder).map(([f, ds]) => [f, ds.length] as const)
		}))
	);
	const tagCloud = $derived(countBy((index?.library ?? []).flatMap((d) => d.tags)));
	const libGroups = $derived(
		groupBy(
			libHits.map((h) => h.item.d),
			(d) => `${d.shelf}/${d.folder}`
		)
	);
	const whyOf = (d: LibraryDoc) => libHits.find((h) => h.item.d === d)?.why ?? null;

	const QUICK: Record<SearchTab, string[]> = {
		records: ['#prototype', 'since:7d', '#ship', 'state:running'],
		library: ['status:draft', 'status:current', 'since:30d']
	};
	// A variable, not a literal: Svelte trims the space at the start of a block.
	const mateNote = ' Rows marked @mate are second mates’ records, gathered by this home.';
	const mates = $derived(new Set(index?.records.filter((r) => r.mate).map((r) => r.mate)));
	const segment = (active: boolean) =>
		`inline-flex items-center gap-1.5 rounded-sm px-3 py-1.5 ${active ? 'bg-primary font-medium text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}`;
</script>

<svelte:head><title>Documents · Wheelhouse</title></svelte:head>

{#snippet tags(list: string[])}
	{#each list as t (t)}<button
			type="button"
			class="relative z-10 cursor-pointer font-mono text-xs hover:underline {on('tag', t)
				? 'text-gold'
				: 'text-muted-foreground'}"
			title="Filter by #{t}"
			onclick={() => toggle({ k: 'tag', v: t })}
			data-row-tag={t}>#{t}</button
		>{/each}
{/snippet}

{#snippet recordRow(item: Item, why: string | null)}
	<li
		class="group relative grid grid-cols-[1.75rem_1fr_auto] gap-x-3 gap-y-1 px-4 py-3 hover:bg-accent/40"
		data-doc-row={item.type}
	>
		{#if item.type === 'record'}
			{@const r = item.r}
			<span class="row-span-2 pt-0.5 text-teal"
				>{#if r.kind === 'ship'}<PackageCheck class="size-5" aria-hidden="true" />{:else}<FileText
						class="size-5"
						aria-hidden="true"
					/>{/if}</span
			>
			<span class="flex min-w-0 items-baseline gap-2">
				<a
					href={recordHref(r.key)}
					class="truncate font-medium group-hover:underline after:absolute after:inset-0 after:content-['']"
					data-doc-title>{r.title}</a
				>
				{#if r.promotedTo}<span
						class="shrink-0 rounded border border-gold/40 px-1.5 text-[0.7rem] text-gold"
						title="Promoted to the library">in library</span
					>{/if}
			</span>
			<span class="tabular text-xs whitespace-nowrap text-muted-foreground">{docDate(r.at)}</span>
			<span
				class="col-span-2 flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-0.5 text-xs text-muted-foreground"
			>
				<span class="text-sea">{shelfName(r.project)}</span>
				<span class="font-mono">{r.slug}</span>
				{#if r.mate}<button
						type="button"
						class="relative z-10 cursor-pointer rounded bg-working/10 px-1 text-working hover:underline"
						title="A second mate's record, gathered by this home"
						onclick={() => toggle({ k: 'mate', v: r.mate! })}>@{r.mate}</button
					>{/if}
				<span>· {r.kind === 'ship' ? 'ship summary' : 'report'}</span>
				{@render tags(r.tags)}
				{#if why}<span class="italic" data-match>matched {why}</span>{/if}
			</span>
		{:else}
			{@const p = item.p}
			<span class="row-span-2 pt-0.5 text-working"
				><span class="relative inline-block"
					><MonitorPlay class="size-5" aria-hidden="true" /><span
						class="state-dot absolute -right-0.5 -bottom-0.5"
						data-state={p.state}
					></span></span
				></span
			>
			<span class="flex min-w-0 items-baseline gap-2">
				<a
					href={prototypeHref(p.id)}
					class="truncate font-medium group-hover:underline after:absolute after:inset-0 after:content-['']"
					data-doc-title>{p.title}</a
				>
				<span class="shrink-0 rounded border border-working/40 px-1.5 text-[0.7rem] text-working"
					>prototype</span
				>
			</span>
			<span class="tabular text-xs whitespace-nowrap text-muted-foreground">{docDate(p.at)}</span>
			<span
				class="col-span-2 flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-0.5 text-xs text-muted-foreground"
			>
				<span class="text-sea">{shelfName(p.project)}</span>
				<span class="font-mono">{p.slug}</span>
				{#if p.mate}<span class="rounded bg-working/10 px-1 text-working">@{p.mate}</span>{/if}
				<button
					type="button"
					class="relative z-10 cursor-pointer hover:underline"
					onclick={() => toggle({ k: 'state', v: p.state })}
					>· <span class="state-dot mr-1 inline-block align-middle" data-state={p.state}
					></span>{STATE_WORDS[p.state]}</button
				>
				{#if why}<span class="italic" data-match>matched {why}</span>{/if}
			</span>
		{/if}
	</li>
{/snippet}

<main class="px-4 pt-6 pb-24 sm:px-6 lg:px-10">
	<header
		class="-mx-4 -mt-6 border-b border-hair bg-panel px-4 py-6 sm:-mx-6 sm:px-6 lg:-mx-10 lg:px-10"
	>
		<div class="flex flex-wrap items-end justify-between gap-6">
			<div class="max-w-4xl">
				<p class="font-display text-base text-muted-foreground italic">
					Every task’s report and prototype, and the library, by title
				</p>
				<h1 class="mt-2 text-[2.1rem] leading-tight text-balance">
					Fleet <em class="text-gold">documents</em>
				</h1>
			</div>
			<div class="flex rounded-md border bg-card p-0.5 text-sm" role="tablist" aria-label="Show">
				<button
					type="button"
					role="tab"
					aria-selected={tab === 'records'}
					class="cursor-pointer {segment(tab === 'records')}"
					onclick={() => (tab = 'records')}
					><FileText class="size-4" aria-hidden="true" />Records
					<span class="tabular text-xs opacity-70"
						>{(index?.records.length ?? 0) + (index?.prototypes.length ?? 0)}</span
					></button
				>
				<button
					type="button"
					role="tab"
					aria-selected={tab === 'library'}
					class="cursor-pointer {segment(tab === 'library')}"
					onclick={() => (tab = 'library')}
					><LibraryBig class="size-4" aria-hidden="true" />Library
					<span class="tabular text-xs opacity-70">{index?.library.length ?? 0}</span></button
				>
			</div>
		</div>
	</header>

	<div class="py-6">
		{#if !index}
			<p class="text-muted-foreground">{data.problem}</p>
		{:else if tab === 'records'}
			<div class="flex flex-wrap items-start gap-3">
				<div class="min-w-0 flex-1">
					<DocSearch
						tab="records"
						{facts}
						bind:toks={q.records.toks}
						bind:text={q.records.text}
						placeholder="Search titles, or filter with #prototype project:wheelhouse since:7d"
						quick={QUICK.records}
					/>
				</div>
				<div class="flex rounded-md border bg-card p-0.5 text-sm" role="group" aria-label="Order">
					<button
						type="button"
						class="cursor-pointer {segment(!byProject)}"
						aria-pressed={!byProject}
						onclick={() => (byProject = false)}>Newest first</button
					>
					<button
						type="button"
						class="cursor-pointer {segment(byProject)}"
						aria-pressed={byProject}
						onclick={() => (byProject = true)}>By project</button
					>
				</div>
			</div>

			<p class="mt-4 text-xs text-muted-foreground" data-doc-count>
				{recordHits.length} of {recordItems.length}
			</p>
			{#if !recordItems.length}
				<div class="mt-2 rounded-lg border bg-card p-6 text-sm text-muted-foreground">
					No reports yet. When a task writes <span class="font-mono"
						>data/&lt;task&gt;/report.md</span
					>
					in the Firstmate home, it is listed here by its title.
				</div>
			{:else if !recordHits.length}
				<div class="mt-2 rounded-lg border bg-card p-6 text-sm text-muted-foreground">
					Nothing matches in titles or metadata. Remove a chip, or try a filter above; full-text
					search comes later.
				</div>
			{:else if byProject}
				<div class="mt-2 space-y-4">
					{#each groups as [project, hits] (project)}
						<section class="overflow-hidden rounded-lg border bg-card">
							<h2
								class="flex items-center gap-2 border-b border-hair bg-panel px-4 py-2 text-sm font-semibold"
							>
								{shelfName(project)}
								<span class="font-normal text-muted-foreground">{hits.length}</span>
							</h2>
							<ul class="divide-y divide-hair">
								{#each hits as h (h.item.type === 'record' ? h.item.r.key : h.item.p.id)}
									{@render recordRow(h.item, h.why)}
								{/each}
							</ul>
						</section>
					{/each}
				</div>
			{:else}
				<ul class="mt-2 divide-y divide-hair overflow-hidden rounded-lg border bg-card">
					{#each recordHits as h (h.item.type === 'record' ? h.item.r.key : h.item.p.id)}
						{@render recordRow(h.item, h.why)}
					{/each}
				</ul>
			{/if}
			<p class="mt-3 text-xs text-muted-foreground">
				Each record opens at a permanent link that keeps working after its task closes, its preview
				stops or its decision is answered.{#if mates.size}{mateNote}{/if} Click a #tag, @mate or state
				on a row to filter by it.
			</p>
		{:else}
			<DocSearch
				tab="library"
				{facts}
				bind:toks={q.library.toks}
				bind:text={q.library.text}
				placeholder="Search titles, or filter with #tag folder:wheelhouse/guides status:draft"
				quick={QUICK.library}
			/>
			{#if index.libraryProblem}
				<p class="mt-4 rounded-lg border border-danger/40 bg-card p-4 text-sm">
					{index.libraryProblem}
				</p>
			{:else if !index.library.length}
				<div class="mt-4 rounded-lg border bg-card p-6 text-sm text-muted-foreground">
					The library is empty. Open a record and choose <b class="text-foreground"
						>Promote to library</b
					> to keep it here, in a folder with tags, to work on with Firstmate.
				</div>
			{:else}
				{#if tagCloud.length}
					<div class="mt-4 flex flex-wrap items-center gap-1.5" data-tag-cloud>
						<span class="mono-label mr-1">Tags</span>
						{#each tagCloud as [t, n] (t)}
							<button
								type="button"
								class="cursor-pointer rounded-md border px-2 py-0.5 font-mono text-xs {on('tag', t)
									? 'border-gold bg-gold/10 text-gold'
									: 'border-hair bg-card text-muted-foreground hover:text-foreground'}"
								onclick={() => toggle({ k: 'tag', v: t })}
								>#{t} <span class="opacity-60">{n}</span></button
							>
						{/each}
					</div>
				{/if}
				<div class="mt-4 grid gap-4 md:grid-cols-[15rem_1fr]">
					<nav
						class="h-fit rounded-lg border bg-card p-2 text-sm"
						aria-label="Folders"
						data-folders
					>
						<p class="mono-label px-2 pt-1 pb-2">Folders</p>
						<button
							type="button"
							class="frow {!q.library.toks.some((t) => t.k === 'folder' || t.k === 'project')
								? 'frow-on'
								: ''}"
							onclick={() =>
								(q.library.toks = q.library.toks.filter(
									(t) => t.k !== 'folder' && t.k !== 'project'
								))}
							><LibraryBig class="size-3.5" aria-hidden="true" /><span class="flex-1"
								>All documents</span
							><span class="text-xs text-muted-foreground">{index.library.length}</span></button
						>
						{#each shelves as s (s.shelf)}
							<button
								type="button"
								class="frow font-medium {on('project', s.shelf) ? 'frow-on' : ''}"
								onclick={() => toggle({ k: 'project', v: s.shelf }, ['folder', 'project'])}
								><BookOpen class="size-3.5" aria-hidden="true" /><span class="flex-1"
									>{shelfName(s.shelf)}</span
								><span class="text-xs text-muted-foreground">{s.count}</span></button
							>
							{#each s.folders as [f, n] (f)}
								<button
									type="button"
									class="frow frow-sub {on('folder', `${s.shelf}/${f}`) ? 'frow-on' : ''}"
									onclick={() =>
										toggle({ k: 'folder', v: `${s.shelf}/${f}` }, ['folder', 'project'])}
									data-folder="{s.shelf}/{f}"
									><Folder class="size-3.5" aria-hidden="true" /><span class="flex-1">{f}</span
									><span class="text-xs text-muted-foreground">{n}</span></button
								>
							{/each}
						{/each}
						<p class="px-2 pt-2 pb-1 text-xs text-muted-foreground">
							New folders come from promoting into one; ask Firstmate in chat to move or retag a
							document.
						</p>
					</nav>
					<div class="min-w-0">
						<p class="text-xs text-muted-foreground" data-doc-count>
							{libHits.length} of {index.library.length} documents
						</p>
						{#if !libHits.length}
							<div class="mt-2 rounded-lg border bg-card p-6 text-sm text-muted-foreground">
								No library documents match these filters.
							</div>
						{:else}
							<div class="mt-2 space-y-4">
								{#each libGroups as [g, docs] (g)}
									<section class="overflow-hidden rounded-lg border bg-card">
										<h2
											class="flex items-center gap-2 border-b border-hair bg-panel px-4 py-2 text-sm font-semibold"
										>
											{shelfName(g.split('/')[0])}
											<span class="text-muted-foreground">/</span>
											<Folder class="size-3.5 text-muted-foreground" aria-hidden="true" />{g.split(
												'/'
											)[1]}
											<span class="font-normal text-muted-foreground">{docs.length}</span>
										</h2>
										<ul class="divide-y divide-hair">
											{#each docs as d (d.key)}
												{@const why = whyOf(d)}
												<li
													class="group relative grid grid-cols-[1.75rem_1fr_auto] gap-x-3 gap-y-1 px-4 py-3 hover:bg-accent/40"
													data-doc-row="library"
												>
													<span class="row-span-2 pt-0.5 text-gold"
														><BookOpen class="size-5" aria-hidden="true" /></span
													>
													<span class="flex min-w-0 items-baseline gap-2">
														<a
															href={libraryHref(d.key)}
															class="truncate font-medium group-hover:underline after:absolute after:inset-0 after:content-['']"
															data-doc-title>{d.title}</a
														>
														<span class="status-chip" data-status={d.status}>{d.status}</span>
													</span>
													<span class="tabular text-xs whitespace-nowrap text-muted-foreground"
														>{docDate(d.updated)}</span
													>
													<span
														class="col-span-2 flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-0.5 text-xs text-muted-foreground"
													>
														<span class="font-mono">{d.slug}.md</span>
														<span>· {d.commits} {d.commits === 1 ? 'commit' : 'commits'}</span>
														{@render tags(d.tags)}
														{#if why}<span class="italic" data-match>matched {why}</span>{/if}
													</span>
												</li>
											{/each}
										</ul>
									</section>
								{/each}
							</div>
						{/if}
						<p class="mt-3 text-xs text-muted-foreground">
							A private git repository Wheelhouse keeps for this home. Folders are real folders;
							tags are in each document’s front matter. Edits go through Firstmate in chat.
						</p>
					</div>
				</div>
			{/if}
		{/if}
	</div>
</main>

<style>
	.frow {
		display: flex;
		width: 100%;
		cursor: pointer;
		align-items: center;
		gap: 0.5rem;
		border-radius: 0.375rem;
		padding: 0.35rem 0.5rem;
		text-align: left;
	}
	.frow-sub {
		padding-left: 1.75rem;
	}
	.frow:hover {
		background: var(--accent);
	}
	.frow-on {
		background: color-mix(in oklab, var(--gold) 12%, var(--card));
		color: var(--foreground);
	}
</style>
