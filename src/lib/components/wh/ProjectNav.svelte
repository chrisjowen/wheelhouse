<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import * as Tooltip from '$lib/components/ui/tooltip';
	import { pins } from '$lib/client/pins.svelte';
	import { matchProjects, pickerSections } from '$lib/picker';
	import type { ProjectStats } from '$lib/views';
	import type { Project } from '$lib/types';
	import { ChevronDown, ChevronUp, Layers, Pin, Search, X } from '@lucide/svelte';

	/**
	 * The left panel's projects: All projects, the pinned ones, then the most active,
	 * a few in all. "Find a project…" searches every project in place, and "Show all"
	 * lists the rest. Each row pins or unpins from its pin button. Folded to the icon
	 * rail, only the pinned and top ones show.
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

	onMount(() => pins.load());

	const sections = $derived(pickerSections(projects, stats, { pinned: pins.ids, current }));
	const searching = $derived(!rail && !!query.trim());
	const matches = $derived(searching ? matchProjects(projects, query, pins.ids) : []);
	const initial = (name: string) => name.trim().charAt(0).toUpperCase() || '?';

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

{#snippet row(p: { id: string; name: string })}
	{@const n = needCount(p.id)}
	{@const pinned = pins.has(p.id)}
	<div class="group/row relative" data-project={p.id}>
		<Tooltip.Root disabled={!rail}>
			<Tooltip.Trigger>
				{#snippet child({ props })}
					<a
						{...props}
						href={href(p.id)}
						class="nav-item {p.id === 'all' ? '' : 'nav-pinnable'}"
						aria-current={current === p.id ? 'true' : undefined}
						aria-label={n ? `${p.name}, ${n} need you` : p.name}
						onclick={() => (query = '')}
					>
						<span class="relative shrink-0">
							{#if p.id === 'all'}
								<Layers class="size-[1.1rem]" strokeWidth={1.75} aria-hidden="true" />
							{:else}
								<span class="project-tile" aria-hidden="true">{initial(p.name)}</span>
							{/if}
							{#if n}<span
									class="nav-dot absolute -top-0.5 -right-0.5 size-2 rounded-full bg-sea ring-2 ring-panel"
									aria-hidden="true"
								></span>{/if}
						</span>
						<span class="nav-label flex-1 truncate">{p.name}</span>
						{#if n}<span
								class="nav-label tabular rounded-full bg-sea/15 px-1.5 text-xs leading-5 font-medium text-sea"
								aria-hidden="true">{n}</span
							>{/if}
					</a>
				{/snippet}
			</Tooltip.Trigger>
			{@render tip(n ? `${p.name} · ${n} need you` : p.name)}
		</Tooltip.Root>
		{#if p.id !== 'all'}
			<button
				type="button"
				class="nav-label nav-pin absolute top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground transition-opacity outline-none hover:text-foreground focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring {pinned
					? 'opacity-70'
					: 'opacity-0 group-hover/row:opacity-100 pointer-coarse:opacity-100'}"
				aria-label={pinned ? `Unpin ${p.name}` : `Pin ${p.name}`}
				aria-pressed={pinned}
				onclick={() => pins.toggle(p.id)}
			>
				<Pin class="size-3.5" fill={pinned ? 'currentColor' : 'none'} aria-hidden="true" />
			</button>
		{/if}
	</div>
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
		{#each matches as p (p.id)}{@render row(p)}{/each}
		{#if !matches.length}
			<p class="nav-label px-2.5 py-2 text-sm text-muted-foreground">
				No project matches “{query.trim()}”.
			</p>
		{/if}
	{:else}
		{@render row({ id: 'all', name: 'All projects' })}
		{#if sections.pinned.length}
			{@render label('Pinned')}
			{#each sections.pinned as p (p.id)}{@render row(p)}{/each}
		{/if}
		{#if sections.top.length && sections.pinned.length}{@render label('Most active')}{/if}
		{#each sections.top as p (p.id)}{@render row(p)}{/each}
		{#if sections.rest.length}
			{#if showAll}
				{#if sections.pinned.length || sections.top.length}{@render label('Other projects')}{/if}
				{#each sections.rest as p (p.id)}{@render row(p)}{/each}
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
