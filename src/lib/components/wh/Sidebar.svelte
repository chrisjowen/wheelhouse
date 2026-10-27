<script lang="ts">
	import { onMount, type Component } from 'svelte';
	import { page } from '$app/state';
	import { currentFleet, live } from '$lib/client/live.svelte';
	import { needsYou } from '$lib/harbour';
	import { statsByProject } from '$lib/picker';
	import ProjectNav from './ProjectNav.svelte';
	import * as Tooltip from '$lib/components/ui/tooltip';
	import {
		CircleCheckBig,
		Clock,
		Gauge,
		LayoutGrid,
		PanelLeftClose,
		PanelLeftOpen,
		Puzzle,
		Radar,
		Scale,
		Waypoints
	} from '@lucide/svelte';

	/**
	 * The left-hand panel under the header: the current section's own pages (the
	 * Harbour's views, the Logbook's pages) and the projects, each with what needs the
	 * captain, pinned and most active first (see ProjectNav). The header keeps the main
	 * sections and the ship's status. It folds to an icon rail (with tooltips) from its
	 * own button or Cmd/Ctrl+B, remembered in this browser; `<html data-nav="rail">` holds
	 * the folded state so the first paint is already right (see app.html). Narrow screens leave it out: the header has it all.
	 */
	/** `fill`: the page fills the viewport, so the panel takes its row's height instead of sticking. */
	let { fill = false }: { fill?: boolean } = $props();

	const fleet = $derived(currentFleet());
	const projects = $derived(fleet?.projects ?? []);
	const stats = $derived(statsByProject(projects, fleet?.tasks ?? [], live.now));
	const path = $derived(page.url.pathname);
	const taskId = $derived(path.match(/^\/tasks\/([^/]+)/)?.[1] ?? null);
	const projectId = $derived(path.match(/^\/projects\/([^/]+)/)?.[1] ?? null);
	const view = $derived(page.url.searchParams.get('view'));
	// The Harbour's panel sits flush and wide, like the home page's On deck rail.
	const flush = $derived(path === '/harbour');
	const pad = $derived(flush ? '' : 'gap-0.5 px-2.5');

	const current = $derived.by(() => {
		const q = page.url.searchParams.get('project');
		if (q) return q;
		if (projectId) return decodeURIComponent(projectId);
		if (taskId) {
			const id = decodeURIComponent(taskId);
			return fleet?.tasks.find((t) => t.id === id)?.projectId ?? 'all';
		}
		return 'all';
	});
	const needCount = (pid: string) =>
		(fleet?.tasks ?? []).filter((t) => (pid === 'all' || t.projectId === pid) && needsYou(t))
			.length;

	type Link = { href: string; label: string; icon: Component; on: boolean };
	const scopeQ = $derived(current !== 'all' ? `project=${encodeURIComponent(current)}` : null);
	const harbourHref = (v: string | null) => {
		const q = [scopeQ, v ? `view=${v}` : null].filter(Boolean);
		return q.length ? `/harbour?${q.join('&')}` : '/harbour';
	};
	// The section's own pages: the Harbour's views, the Logbook's pages.
	const section = $derived.by((): { title: string; links: Link[] } | null => {
		if (path === '/harbour' || taskId || projectId)
			return {
				title: 'Harbour',
				links: [
					{
						href: harbourHref(null),
						label: 'Under way',
						icon: LayoutGrid,
						on: path === '/harbour' && !view
					},
					{
						href: harbourHref('completed'),
						label: 'Completed',
						icon: CircleCheckBig,
						on: path === '/harbour' && view === 'completed'
					},
					{
						href: harbourHref('passage'),
						label: 'Passage',
						icon: Waypoints,
						on: path === '/harbour' && view === 'passage'
					},
					{
						href: harbourHref('radar'),
						label: 'Radar',
						icon: Radar,
						on: path === '/harbour' && view === 'radar'
					}
				]
			};
		if (['/headroom', '/time', '/decisions', '/plugins'].includes(path))
			return {
				title: 'Logbook',
				links: [
					{ href: '/headroom', label: 'Headroom', icon: Gauge, on: path === '/headroom' },
					{ href: '/time', label: 'Where time went', icon: Clock, on: path === '/time' },
					{ href: '/decisions', label: 'Decided for you', icon: Scale, on: path === '/decisions' },
					{ href: '/plugins', label: 'Plugins', icon: Puzzle, on: path === '/plugins' }
				]
			};
		return null;
	});

	// A project scopes the page you are on: the Harbour board, else the home page's rail.
	const projectHref = (id: string) => {
		const base = path === '/harbour' || projectId || taskId ? '/harbour' : '/';
		const keep = base === '/harbour' && view ? `view=${encodeURIComponent(view)}` : null;
		const q = [id !== 'all' ? `project=${encodeURIComponent(id)}` : null, keep].filter(Boolean);
		return q.length ? `${base}?${q.join('&')}` : base;
	};

	let rail = $state(false);
	onMount(() => {
		rail = document.documentElement.dataset.nav === 'rail';
	});
	function toggleRail() {
		rail = !rail;
		if (rail) document.documentElement.dataset.nav = 'rail';
		else delete document.documentElement.dataset.nav;
		try {
			localStorage.setItem('wheelhouse-nav', rail ? 'rail' : 'full');
		} catch {
			// storage unavailable; the choice lasts for this page only
		}
	}
	const mac = $derived(
		typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)
	);
	const shortcut = $derived(mac ? '⌘B' : 'Ctrl+B');

	// Cmd/Ctrl+B folds the panel, except inside a terminal, where Ctrl+B is tmux's.
	function onkeydown(e: KeyboardEvent) {
		if (e.key.toLowerCase() !== 'b' || e.shiftKey || e.altKey) return;
		if (!(mac ? e.metaKey : e.ctrlKey)) return;
		if ((e.target as HTMLElement | null)?.closest?.('.xterm')) return;
		e.preventDefault();
		toggleRail();
	}
</script>

<svelte:window {onkeydown} />

{#snippet tip(label: string)}
	<Tooltip.Content side="right" sideOffset={8}>{label}</Tooltip.Content>
{/snippet}

<aside
	class="sidebar z-20 hidden shrink-0 flex-col border-r border-hair bg-panel md:flex {flush
		? 'sidebar-flush'
		: ''} {fill ? 'min-h-0' : 'sticky top-14 h-[calc(100dvh-3.5rem)] self-start'}"
	aria-label="Pages and projects"
>
	<div class="no-scrollbar flex min-h-0 flex-1 flex-col overflow-y-auto">
		{#if section}
			<nav class="flex flex-col pt-4 {pad}" aria-label={section.title}>
				<p class="nav-label nav-heading">{section.title}</p>
				{#each section.links as l (l.label)}
					{@const Icon = l.icon}
					<Tooltip.Root disabled={!rail}>
						<Tooltip.Trigger>
							{#snippet child({ props })}
								<a
									{...props}
									href={l.href}
									class="nav-item"
									aria-current={l.on ? 'page' : undefined}
								>
									<Icon class="size-[1.1rem] shrink-0" strokeWidth={1.75} aria-hidden="true" />
									<span class="nav-label truncate">{l.label}</span>
								</a>
							{/snippet}
						</Tooltip.Trigger>
						{@render tip(l.label)}
					</Tooltip.Root>
				{/each}
			</nav>
		{/if}

		<ProjectNav {projects} {stats} {current} {needCount} href={projectHref} {rail} {pad} />
	</div>

	<div class="border-t border-hair {flush ? '' : 'p-2.5'}">
		<Tooltip.Root>
			<Tooltip.Trigger>
				{#snippet child({ props })}
					<button
						{...props}
						class="nav-item w-full"
						onclick={toggleRail}
						aria-label={rail ? 'Expand the panel' : 'Collapse the panel'}
						aria-expanded={!rail}
					>
						{#if rail}<PanelLeftOpen
								class="size-[1.1rem] shrink-0"
								strokeWidth={1.75}
							/>{:else}<PanelLeftClose class="size-[1.1rem] shrink-0" strokeWidth={1.75} />{/if}
						<span class="nav-label flex-1 text-left">Collapse</span>
						<kbd class="nav-label font-sans text-xs text-muted-foreground">{shortcut}</kbd>
					</button>
				{/snippet}
			</Tooltip.Trigger>
			{@render tip(`${rail ? 'Expand' : 'Collapse'} the panel · ${shortcut}`)}
		</Tooltip.Root>
	</div>
</aside>
