<script lang="ts">
	import { onMount } from 'svelte';
	import { Check, Pin, Search } from '@lucide/svelte';
	import { pins } from '$lib/client/pins.svelte';
	import { matchProjects, pickerSections } from '$lib/picker';
	import type { ProjectStats } from '$lib/views';
	import type { Project } from '$lib/types';

	/**
	 * The header's project picker, inside its popover: a search box with the keyboard,
	 * then All projects, the pinned ones, the most active and the rest; typing filters
	 * them all. Arrow keys move, Enter picks; the popover closes on Escape.
	 */
	let {
		projects,
		stats,
		current,
		needCount,
		onpick
	}: {
		projects: Project[];
		stats: Map<string, ProjectStats>;
		current: string;
		needCount: (id: string) => number;
		onpick: (id: string) => void;
	} = $props();

	const ALL = { id: 'all', name: 'All projects' } as const;
	type Option = { id: string; name: string };
	type Group = { label: string | null; options: Option[] };

	let query = $state('');
	let active = $state(0);
	let input = $state<HTMLInputElement | null>(null);
	let list = $state<HTMLElement | null>(null);
	const uid = $props.id();

	onMount(() => {
		pins.load();
		active = Math.max(
			0,
			options.findIndex((o) => o.id === current)
		);
	});

	const groups = $derived.by((): Group[] => {
		if (query.trim()) return [{ label: null, options: matchProjects(projects, query, pins.ids) }];
		const s = pickerSections(projects, stats, { pinned: pins.ids, current });
		return [
			{ label: null, options: [ALL] },
			{ label: 'Pinned', options: s.pinned },
			{ label: 'Most active', options: s.top },
			{ label: s.pinned.length || s.top.length ? 'Other projects' : 'Projects', options: s.rest }
		].filter((g) => g.options.length);
	});
	const options = $derived(groups.flatMap((g) => g.options));

	// It opens on the current project; a new search starts on its best match.
	function search(v: string) {
		query = v;
		active = 0;
	}
	$effect(() => {
		const el = list?.querySelector<HTMLElement>(`#${CSS.escape(`${uid}-${active}`)}`);
		el?.scrollIntoView?.({ block: 'nearest' });
	});

	function onkeydown(e: KeyboardEvent) {
		const n = options.length;
		if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
			e.preventDefault();
			if (n) active = (active + (e.key === 'ArrowDown' ? 1 : n - 1)) % n;
		} else if (e.key === 'Enter') {
			e.preventDefault();
			const o = options[active];
			if (o) onpick(o.id);
		}
	}
	export function focus() {
		input?.focus();
	}
</script>

<div class="flex flex-col">
	<label class="flex items-center gap-2 border-b border-hair px-3">
		<Search class="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
		<input
			bind:this={input}
			value={query}
			oninput={(e) => search(e.currentTarget.value)}
			{onkeydown}
			type="search"
			role="combobox"
			aria-expanded="true"
			aria-controls="{uid}-list"
			aria-activedescendant={options.length ? `${uid}-${active}` : undefined}
			aria-autocomplete="list"
			aria-label="Find a project"
			placeholder="Find a project…"
			autocomplete="off"
			spellcheck="false"
			class="h-10 min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground [&::-webkit-search-cancel-button]:hidden"
		/>
	</label>
	<div
		bind:this={list}
		id="{uid}-list"
		role="listbox"
		aria-label="Projects"
		class="max-h-[min(24rem,60dvh)] overflow-y-auto p-1"
	>
		{#if !options.length}
			<p class="px-2 py-3 text-sm text-muted-foreground">No project matches “{query.trim()}”.</p>
		{/if}
		{#each groups as g, gi (g.label ?? `g${gi}`)}
			{#if g.label}
				<p class="px-2 pt-2 pb-1 text-xs font-medium tracking-wide text-muted-foreground uppercase">
					{g.label}
				</p>
			{:else if gi > 0}
				<div class="-mx-1 my-1 h-px bg-border" role="separator"></div>
			{/if}
			{#each g.options as o (o.id)}
				{@const i = options.indexOf(o)}
				{@const n = needCount(o.id)}
				{@const pinned = pins.has(o.id)}
				<div
					id="{uid}-{i}"
					role="option"
					tabindex="-1"
					aria-selected={i === active}
					data-project={o.id}
					class="group flex cursor-default items-center gap-2 rounded-sm px-2 py-1.5 text-sm select-none {i ===
					active
						? 'bg-accent text-accent-foreground'
						: ''}"
					onmousemove={() => (active = i)}
					onclick={() => onpick(o.id)}
					onkeydown={() => {}}
				>
					<span class="min-w-0 flex-1 truncate">{o.name}</span>
					{#if n}<span class="tabular text-xs whitespace-nowrap text-sea">{n} need you</span>{/if}
					{#if current === o.id}<Check class="size-4 shrink-0" aria-label="Selected" />{/if}
					{#if o.id !== 'all'}
						<button
							type="button"
							tabindex="-1"
							class="-my-1 rounded p-1 text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring {pinned
								? ''
								: 'opacity-0 group-hover:opacity-100 group-aria-selected:opacity-100 pointer-coarse:opacity-100'}"
							aria-label={pinned ? `Unpin ${o.name}` : `Pin ${o.name}`}
							aria-pressed={pinned}
							onclick={(e) => {
								e.stopPropagation();
								pins.toggle(o.id);
								input?.focus();
							}}
						>
							<Pin class="size-3.5" fill={pinned ? 'currentColor' : 'none'} />
						</button>
					{/if}
				</div>
			{/each}
		{/each}
	</div>
</div>
