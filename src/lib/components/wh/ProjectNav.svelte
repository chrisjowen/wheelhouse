<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import * as Tooltip from '$lib/components/ui/tooltip';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
	import { pins } from '$lib/client/pins.svelte';
	import { aliases } from '$lib/client/aliases.svelte';
	import { matchProjects, pickerSections } from '$lib/picker';
	import { projectLabels, runs, type ProjectLabel } from '$lib/projectnames';
	import type { ProjectStats } from '$lib/views';
	import type { Project } from '$lib/types';
	import {
		ChevronDown,
		ChevronRight,
		ChevronUp,
		Ellipsis,
		Layers,
		Pencil,
		Pin,
		RotateCcw,
		Search,
		X
	} from '@lucide/svelte';

	/**
	 * The left panel's projects: All projects, the pinned ones, then the most active,
	 * a few in all. "Find a project…" searches every project in place, and "Show all"
	 * lists the rest. Projects sharing a name prefix sit under a folding group heading
	 * ("ai-innovations" › "chat-agent"), each with a two-letter monogram of its own part.
	 * Each row's menu pins it or gives it a friendly name, kept in this browser. Folded to
	 * the icon rail, only the pinned and top ones show.
	 */
	let {
		projects,
		stats,
		current,
		needCount,
		href,
		rail = false,
		pad = ''
	}: {
		projects: Project[];
		stats: Map<string, ProjectStats>;
		current: string;
		needCount: (id: string) => number;
		href: (id: string) => string;
		rail?: boolean;
		pad?: string;
	} = $props();

	let query = $state('');
	let showAll = $state(false);

	let folded = $state<string[]>([]);
	let editing = $state<string | null>(null);
	let draft = $state('');

	onMount(() => {
		pins.load();
		aliases.load();
	});

	const sections = $derived(pickerSections(projects, stats, { pinned: pins.ids, current }));
	const searching = $derived(!rail && !!query.trim());
	const labels = $derived(projectLabels(projects, aliases.names));
	// Siblings sit together, so Enter opens the first row as shown.
	const matches = $derived(
		searching
			? runs(matchProjects(projects, query, pins.ids, aliases.names), labels).flatMap(
					(r) => r.items
				)
			: []
	);
	const labelOf = (p: { id: string; name: string }): ProjectLabel =>
		labels.get(p.id) ?? { group: null, label: p.name, full: p.name, monogram: '?', hue: 0 };

	function rename(id: string) {
		draft = aliases.names[id] ?? labelOf({ id, name: id }).label;
		editing = id;
	}
	function save() {
		const plain = editing && projectLabels(projects).get(editing)?.label;
		if (editing) aliases.set(editing, draft.trim() === plain ? '' : draft);
		editing = null;
	}
	const focusSelect = (el: HTMLInputElement) => {
		el.focus();
		el.select();
	};

	function onkeydown(e: KeyboardEvent) {
		if (e.key === 'Escape' && query) {
			e.preventDefault();
			query = '';
		} else if (e.key === 'Enter' && matches.length) {
			e.preventDefault();
			const to = href(matches[0].id);
			query = '';
			goto(to);
		}
	}
</script>

{#snippet tip(label: string)}
	<Tooltip.Content side="right" sideOffset={8}>{label}</Tooltip.Content>
{/snippet}

{#snippet name(l: ProjectLabel, grouped: boolean)}
	{#if l.group && !grouped && l.label !== l.full}
		<span class="nav-label project-name">
			<span class="project-prefix">{l.group} ›</span><span class="truncate">{l.label}</span>
		</span>
	{:else}
		<span class="nav-label flex-1 truncate">{l.label}</span>
	{/if}
{/snippet}

{#snippet row(p: { id: string; name: string }, grouped = false)}
	{@const n = needCount(p.id)}
	{@const pinned = pins.has(p.id)}
	{@const l = labelOf(p)}
	{@const tipText = l.label === l.full ? l.full : `${l.label} · ${l.full}`}
	<div class="group/row relative" data-project={p.id}>
		{#if editing === p.id}
			<form
				class="nav-item nav-rename"
				onsubmit={(e) => {
					e.preventDefault();
					save();
				}}
			>
				<span class="project-tile" data-hue={l.hue} aria-hidden="true">{l.monogram}</span>
				<input
					bind:value={draft}
					use:focusSelect
					onblur={save}
					onkeydown={(e) => {
						if (e.key === 'Escape') {
							e.preventDefault();
							editing = null;
						}
					}}
					aria-label="Friendly name for {l.full}"
					placeholder={l.full}
					class="min-w-0 flex-1 rounded border border-ring bg-card px-1.5 py-0.5 text-sm text-foreground outline-none"
				/>
			</form>
		{:else}
			<Tooltip.Root>
				<Tooltip.Trigger>
					{#snippet child({ props })}
						<a
							{...props}
							href={href(p.id)}
							class="nav-item {p.id === 'all' ? '' : 'nav-pinnable'} {grouped ? 'nav-child' : ''}"
							aria-current={current === p.id ? 'true' : undefined}
							aria-label={n ? `${l.full}, ${n} need you` : l.full}
							onclick={() => (query = '')}
						>
							<span class="relative shrink-0">
								{#if p.id === 'all'}
									<Layers class="size-[1.1rem]" strokeWidth={1.75} aria-hidden="true" />
								{:else}
									<span class="project-tile" data-hue={l.hue} aria-hidden="true">{l.monogram}</span>
								{/if}
								{#if n}<span
										class="nav-dot absolute -top-0.5 -right-0.5 size-2 rounded-full bg-sea ring-2 ring-panel"
										aria-hidden="true"
									></span>{/if}
							</span>
							{@render name(l, grouped)}
							{#if n}<span
									class="nav-label tabular rounded-full bg-sea/15 px-1.5 text-xs leading-5 font-medium text-sea"
									aria-hidden="true">{n}</span
								>{/if}
						</a>
					{/snippet}
				</Tooltip.Trigger>
				{@render tip(n ? `${tipText} · ${n} need you` : tipText)}
			</Tooltip.Root>
			{#if p.id !== 'all'}
				<DropdownMenu.Root>
					<DropdownMenu.Trigger
						class="nav-label nav-pin absolute top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground transition-opacity outline-none hover:text-foreground focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring data-[state=open]:opacity-100 {pinned
							? 'opacity-70'
							: 'opacity-0 group-hover/row:opacity-100 pointer-coarse:opacity-100'}"
						aria-label="Options for {l.full}"
					>
						{#if pinned}
							<Pin
								class="size-3.5 group-hover/row:hidden"
								fill="currentColor"
								aria-label="Pinned"
							/>
							<Ellipsis class="hidden size-3.5 group-hover/row:block" aria-hidden="true" />
						{:else}
							<Ellipsis class="size-3.5" aria-hidden="true" />
						{/if}
					</DropdownMenu.Trigger>
					<DropdownMenu.Content align="start" side="right" class="w-48">
						<DropdownMenu.Label class="truncate text-xs font-normal text-muted-foreground"
							>{l.full}</DropdownMenu.Label
						>
						<DropdownMenu.Item onSelect={() => pins.toggle(p.id)}>
							<Pin class="size-4" fill={pinned ? 'currentColor' : 'none'} />{pinned
								? 'Unpin'
								: 'Pin'}
						</DropdownMenu.Item>
						<DropdownMenu.Item onSelect={() => setTimeout(() => rename(p.id))}>
							<Pencil class="size-4" />Rename…
						</DropdownMenu.Item>
						{#if aliases.names[p.id]}
							<DropdownMenu.Item onSelect={() => aliases.set(p.id, '')}>
								<RotateCcw class="size-4" />Use the full name
							</DropdownMenu.Item>
						{/if}
					</DropdownMenu.Content>
				</DropdownMenu.Root>
			{/if}
		{/if}
	</div>
{/snippet}

{#snippet list(items: { id: string; name: string }[])}
	{#if rail}
		{#each items as p (p.id)}{@render row(p)}{/each}
	{:else}
		{#each runs(items, labels) as r (r.group ? `g:${r.group}` : `p:${r.items[0].id}`)}
			{#if r.group}
				{@const open = searching || !folded.includes(r.group)}
				{@const g = r.group}
				<button
					type="button"
					class="nav-label nav-item nav-group"
					aria-expanded={open}
					title={g}
					onclick={() => (folded = open ? [...folded, g] : folded.filter((x) => x !== g))}
				>
					{#if open}<ChevronDown class="size-3.5 shrink-0" aria-hidden="true" />{:else}<ChevronRight
							class="size-3.5 shrink-0"
							aria-hidden="true"
						/>{/if}
					<span class="flex-1 truncate text-left">{g}</span>
					<span class="tabular text-xs text-muted-foreground/80">{r.items.length}</span>
				</button>
				{#if open}
					{#each r.items as p (p.id)}{@render row(p, true)}{/each}
				{/if}
			{:else}
				{@render row(r.items[0])}
			{/if}
		{/each}
	{/if}
{/snippet}

{#snippet label(text: string)}
	<p class="nav-label nav-sublabel">{text}</p>
{/snippet}

<nav class="flex flex-col pt-4 pb-3 {pad}" aria-label="Projects">
	<p class="nav-label nav-heading">Projects</p>
	<label class="nav-label nav-find">
		<Search class="size-3.5 shrink-0" aria-hidden="true" />
		<input
			bind:value={query}
			{onkeydown}
			type="search"
			aria-label="Find a project"
			placeholder="Find a project…"
			autocomplete="off"
			spellcheck="false"
			class="min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground [&::-webkit-search-cancel-button]:hidden"
		/>
		{#if query}
			<button
				type="button"
				class="rounded p-0.5 hover:text-foreground"
				aria-label="Clear the search"
				onclick={() => (query = '')}><X class="size-3.5" aria-hidden="true" /></button
			>
		{/if}
	</label>

	{#if searching}
		{@render list(matches)}
		{#if !matches.length}
			<p class="nav-label px-2.5 py-2 text-sm text-muted-foreground">
				No project matches “{query.trim()}”.
			</p>
		{/if}
	{:else}
		{@render row({ id: 'all', name: 'All projects' })}
		{#if sections.pinned.length}
			{@render label('Pinned')}
			{@render list(sections.pinned)}
		{/if}
		{#if sections.top.length && sections.pinned.length}{@render label('Most active')}{/if}
		{@render list(sections.top)}
		{#if sections.rest.length}
			{#if showAll && !rail}
				{#if sections.pinned.length || sections.top.length}{@render label('Other projects')}{/if}
				{@render list(sections.rest)}
			{/if}
			<button
				type="button"
				class="nav-label nav-item nav-more"
				aria-expanded={showAll}
				onclick={() => (showAll = !showAll)}
			>
				{#if showAll}
					<ChevronUp class="size-4 shrink-0" aria-hidden="true" />Show fewer
				{:else}
					<ChevronDown class="size-4 shrink-0" aria-hidden="true" />Show all {projects.length}
				{/if}
			</button>
		{/if}
	{/if}
</nav>
