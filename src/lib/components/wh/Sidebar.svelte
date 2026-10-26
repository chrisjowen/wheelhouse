<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { currentFleet, currentHealth } from '$lib/client/live.svelte';
	import { needsYou } from '$lib/harbour';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
	import * as Tooltip from '$lib/components/ui/tooltip';
	import {
		Anchor,
		BookOpen,
		Check,
		ChevronsUpDown,
		Gauge,
		Layers,
		Moon,
		PanelLeftClose,
		PanelLeftOpen,
		Sailboat,
		ScrollText,
		ShipWheel,
		Sun,
		X
	} from '@lucide/svelte';
	import type { Component } from 'svelte';
	import { clock } from '$lib/format';
	import type { AllowanceWindow } from '$lib/types';

	/**
	 * The main navigation: a solid panel down the left with an icon and label per page,
	 * the ship's status as small badges on the pages they belong to, and the project
	 * switcher and theme at the foot. It folds to an icon rail (with tooltips) from its
	 * own button or Cmd/Ctrl+B, remembered in this browser; `<html data-nav="rail">` holds
	 * the folded state so the first paint is already right (see app.html). Below `md` it
	 * is a drawer opened from the page's menu button (`open`).
	 */
	let {
		dark,
		onToggleTheme,
		atRisk = null,
		open = $bindable(false)
	}: {
		dark: boolean;
		onToggleTheme: () => void;
		atRisk?: AllowanceWindow | null;
		/** The narrow-screen drawer. */
		open?: boolean;
	} = $props();

	const fleet = $derived(currentFleet());
	const health = $derived(currentHealth());
	const sup = $derived(health?.supervisor);
	const projects = $derived(fleet?.projects ?? []);

	// Project scope lives in the URL (?project=); a task page shows its own project, and a
	// project's own pages (/projects/<id>/…) theirs.
	const taskId = $derived(page.url.pathname.match(/^\/tasks\/([^/]+)/)?.[1] ?? null);
	const projectId = $derived(page.url.pathname.match(/^\/projects\/([^/]+)/)?.[1] ?? null);
	const onHarbour = $derived(page.url.pathname === '/harbour' || !!taskId || !!projectId);
	// The Logbook gathers the session and headroom pages: Headroom, Where time went and
	// Decided for you.
	const onLogbook = $derived(['/headroom', '/time', '/decisions'].includes(page.url.pathname));
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
	const currentName = $derived(
		current === 'all' ? 'All projects' : (projects.find((p) => p.id === current)?.name ?? current)
	);

	const watch = $derived(
		!sup?.available
			? { dot: 'bg-muted-foreground', label: 'Firstmate unknown' }
			: sup.onWatch
				? { dot: 'bg-success', label: 'Firstmate on watch' }
				: sup.onWatch === false
					? { dot: 'bg-danger', label: 'Firstmate off watch' }
					: { dot: 'bg-warning', label: 'Firstmate unclear' }
	);

	type NavItem = {
		href: string;
		label: string;
		icon: Component;
		on: boolean;
		/** A count that needs the captain, shown as a badge. */
		count?: number;
		/** A status dot on the icon, with its meaning for the tooltip and screen readers. */
		dot?: { cls: string; label: string };
	};
	const items = $derived<NavItem[]>([
		{
			href: '/',
			label: 'Firstmate',
			icon: ShipWheel,
			on: page.url.pathname === '/',
			dot: { cls: watch.dot, label: watch.label }
		},
		{ href: '/harbour', label: 'Harbour', icon: Sailboat, on: onHarbour, count: needCount('all') },
		{ href: '/headroom', label: 'Logbook', icon: BookOpen, on: onLogbook },
		{ href: '/spec', label: 'Spec', icon: ScrollText, on: page.url.pathname === '/spec' }
	]);

	// Picking a project scopes the page you are on: the Harbour board, else the home page's rail.
	function pick(id: string) {
		const base = page.url.pathname === '/harbour' || projectId ? '/harbour' : '/';
		const view = base === '/harbour' ? page.url.searchParams.get('view') : null;
		const q = [
			id !== 'all' ? `project=${encodeURIComponent(id)}` : null,
			view ? `view=${encodeURIComponent(view)}` : null
		].filter(Boolean);
		goto(q.length ? `${base}?${q.join('&')}` : base);
	}

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

	// The drawer closes on navigation and on Escape.
	$effect(() => {
		void page.url.pathname;
		open = false;
	});
</script>

<svelte:window {onkeydown} />

{#snippet tip(label: string, extra?: string)}
	<Tooltip.Content side="right" sideOffset={8}>
		{label}{#if extra}<span class="opacity-75">· {extra}</span>{/if}
	</Tooltip.Content>
{/snippet}

{#snippet panel(drawer: boolean)}
	<div class="nav-head flex h-14 shrink-0 items-center gap-2 px-3">
		<a
			href="/"
			class="flex min-w-0 items-center gap-2.5 rounded-md px-2 py-1.5 font-logo font-semibold tracking-tight"
			aria-label="Wheelhouse"
		>
			<Anchor class="size-5 shrink-0 text-sea" aria-hidden="true" />
			<span class="nav-label truncate">Wheelhouse</span>
		</a>
		{#if drawer}
			<button
				class="ml-auto flex size-9 cursor-pointer items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
				aria-label="Close the menu"
				onclick={() => (open = false)}><X class="size-4" /></button
			>
		{/if}
	</div>
	<div class="mx-4 border-t border-hair"></div>

	<nav class="flex flex-col gap-0.5 p-2.5" aria-label="Main">
		{#each items as item (item.href)}
			{@const Icon = item.icon}
			<Tooltip.Root disabled={drawer || !rail}>
				<Tooltip.Trigger>
					{#snippet child({ props })}
						<a
							{...props}
							href={item.href}
							aria-current={item.on ? 'page' : undefined}
							class="nav-item"
							aria-label={item.count ? `${item.label}, ${item.count} need you` : undefined}
						>
							<span class="relative shrink-0">
								<Icon class="size-[1.15rem]" strokeWidth={1.75} aria-hidden="true" />
								{#if item.dot}<span
										class="absolute -top-0.5 -right-0.5 size-2 rounded-full ring-2 ring-panel {item
											.dot.cls}"
										aria-hidden="true"
									></span>{/if}
								{#if item.count}<span
										class="nav-dot absolute -top-0.5 -right-0.5 size-2 rounded-full bg-sea ring-2 ring-panel"
										aria-hidden="true"
									></span>{/if}
							</span>
							<span class="nav-label flex-1 truncate">{item.label}</span>
							{#if item.count}<span
									class="nav-label tabular rounded-full bg-sea px-1.5 text-xs leading-5 font-medium text-white dark:text-slate-950"
									aria-hidden="true">{item.count}</span
								>{/if}
						</a>
					{/snippet}
				</Tooltip.Trigger>
				{@render tip(
					item.label,
					item.dot?.label ?? (item.count ? `${item.count} need you` : undefined)
				)}
			</Tooltip.Root>
		{/each}
	</nav>

	<div class="mt-auto flex flex-col gap-0.5 p-2.5">
		{#if atRisk}
			<Tooltip.Root disabled={drawer || !rail}>
				<Tooltip.Trigger>
					{#snippet child({ props })}
						<a {...props} href="/headroom" class="nav-item text-warning!">
							<Gauge class="size-[1.15rem] shrink-0" strokeWidth={1.75} aria-hidden="true" />
							<span class="nav-label text-xs leading-snug">
								{atRisk.label}: {atRisk.percentLeft}% left{atRisk.runsOutAt
									? `, may run out at ${clock(atRisk.runsOutAt)}`
									: ''}
							</span>
						</a>
					{/snippet}
				</Tooltip.Trigger>
				{@render tip(`${atRisk.label}: ${atRisk.percentLeft}% left`)}
			</Tooltip.Root>
		{/if}

		<Tooltip.Root>
			<Tooltip.Trigger>
				{#snippet child({ props })}
					<button
						{...props}
						type="button"
						class="nav-item w-full cursor-default hover:bg-transparent!"
					>
						<span class="flex size-[1.15rem] shrink-0 items-center justify-center">
							<span class="size-2 rounded-full {watch.dot}" aria-hidden="true"></span>
						</span>
						<span class="nav-label truncate text-xs">{watch.label}</span>
					</button>
				{/snippet}
			</Tooltip.Trigger>
			<Tooltip.Content side="right" sideOffset={8} class="max-w-xs">
				{#if sup?.onWatch}
					Firstmate is running and reading its inbox.
				{:else}
					{sup?.reason ?? 'Firstmate’s readiness is unknown.'}
				{/if}
				{#if health?.firstmate.version}
					Firstmate {health.firstmate.version}{health.firstmate.compatible
						? ', compatible'
						: ', not compatible'}.
				{/if}
			</Tooltip.Content>
		</Tooltip.Root>

		<div class="mx-1.5 my-1.5 border-t border-hair"></div>

		<DropdownMenu.Root>
			<DropdownMenu.Trigger>
				{#snippet child({ props })}
					<button
						{...props}
						class="nav-item w-full"
						title={rail && !drawer ? `Project: ${currentName}` : undefined}
					>
						<span class="relative shrink-0">
							<Layers class="size-[1.15rem]" strokeWidth={1.75} aria-hidden="true" />
						</span>
						<span class="nav-label flex min-w-0 flex-1 flex-col items-start text-left">
							<span
								class="text-[0.7rem] leading-tight tracking-wide text-muted-foreground uppercase"
								>Project</span
							>
							<span class="w-full truncate text-sm leading-snug">{currentName}</span>
						</span>
						<ChevronsUpDown
							class="nav-label size-4 shrink-0 text-muted-foreground"
							aria-hidden="true"
						/>
					</button>
				{/snippet}
			</DropdownMenu.Trigger>
			<DropdownMenu.Content side="right" align="end" sideOffset={8} class="min-w-56">
				{#each [{ id: 'all', name: 'All projects' }, ...projects] as p, i (p.id)}
					{#if i === 1}<DropdownMenu.Separator />{/if}
					<DropdownMenu.Item onSelect={() => pick(p.id)} class="justify-between gap-6">
						<span class="truncate">{p.name}</span>
						<span class="flex items-center gap-2">
							{#if needCount(p.id)}<span class="tabular text-xs text-sea"
									>{needCount(p.id)} need you</span
								>{/if}
							{#if current === p.id}<Check class="size-4" aria-label="Selected" />{/if}
						</span>
					</DropdownMenu.Item>
				{/each}
			</DropdownMenu.Content>
		</DropdownMenu.Root>

		<Tooltip.Root disabled={drawer || !rail}>
			<Tooltip.Trigger>
				{#snippet child({ props })}
					<button
						{...props}
						class="nav-item w-full"
						onclick={onToggleTheme}
						aria-label={dark ? 'Switch to light mode' : 'Switch to dark mode'}
					>
						{#if dark}<Sun class="size-[1.15rem] shrink-0" strokeWidth={1.75} />{:else}<Moon
								class="size-[1.15rem] shrink-0"
								strokeWidth={1.75}
							/>{/if}
						<span class="nav-label">{dark ? 'Light mode' : 'Dark mode'}</span>
					</button>
				{/snippet}
			</Tooltip.Trigger>
			{@render tip(dark ? 'Light mode' : 'Dark mode')}
		</Tooltip.Root>

		{#if !drawer}
			<Tooltip.Root>
				<Tooltip.Trigger>
					{#snippet child({ props })}
						<button
							{...props}
							class="nav-item w-full"
							onclick={toggleRail}
							aria-label={rail ? 'Expand the menu' : 'Collapse the menu'}
							aria-expanded={!rail}
						>
							{#if rail}<PanelLeftOpen
									class="size-[1.15rem] shrink-0"
									strokeWidth={1.75}
								/>{:else}<PanelLeftClose class="size-[1.15rem] shrink-0" strokeWidth={1.75} />{/if}
							<span class="nav-label flex-1 text-left">Collapse</span>
							<kbd class="nav-label font-sans text-xs text-muted-foreground">{shortcut}</kbd>
						</button>
					{/snippet}
				</Tooltip.Trigger>
				{@render tip(rail ? 'Expand the menu' : 'Collapse the menu', shortcut)}
			</Tooltip.Root>
		{/if}
	</div>
{/snippet}

<aside
	class="sidebar sticky top-0 z-30 hidden h-dvh shrink-0 flex-col border-r border-r-foreground/75 bg-panel shadow-[3px_0_0_-2px_var(--brass)] md:flex"
	aria-label="Wheelhouse"
>
	{@render panel(false)}
</aside>

{#if open}
	<button
		class="fixed inset-0 z-40 bg-black/45 md:hidden"
		aria-label="Close the menu"
		onclick={() => (open = false)}
	></button>
	<aside
		class="fixed inset-y-0 left-0 z-50 flex w-[min(17rem,85vw)] flex-col border-r bg-panel shadow-xl md:hidden"
		aria-label="Wheelhouse"
	>
		{@render panel(true)}
	</aside>
{/if}

<svelte:document
	onkeydown={(e) => {
		if (open && e.key === 'Escape') open = false;
	}}
/>
