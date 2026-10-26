<script lang="ts">
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { currentFleet, currentHealth, live } from '$lib/client/live.svelte';
	import { slots } from '$lib/client/slots.svelte';
	import { navPageHref, slotKey, type SlotKey } from '$lib/plugins/keys';
	import type { SlotView } from '$lib/plugins/types';
	import BarePanel from '$lib/components/wh/plugins/BarePanel.svelte';
	import { inbox } from '$lib/client/inbox.svelte';
	import { needsYou } from '$lib/harbour';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
	import * as Tooltip from '$lib/components/ui/tooltip';
	import { Button } from '$lib/components/ui/button';
	import { Anchor, Check, ChevronDown, Gauge, Moon, Sun } from '@lucide/svelte';
	import { clock } from '$lib/format';
	import BellMenu from './bell/BellMenu.svelte';
	import type { AllowanceWindow } from '$lib/types';

	let {
		dark,
		onToggleTheme,
		atRisk = null
	}: { dark: boolean; onToggleTheme: () => void; atRisk?: AllowanceWindow | null } = $props();

	const fleet = $derived(currentFleet());
	const health = $derived(currentHealth());
	const sup = $derived(health?.supervisor);
	const projects = $derived(fleet?.projects ?? []);

	// Project scope lives in the URL (?project=); a task page shows its own project, and a
	// project's own pages (/projects/<id>/…) theirs.
	const taskId = $derived(page.url.pathname.match(/^\/tasks\/([^/]+)/)?.[1] ?? null);
	const projectId = $derived(page.url.pathname.match(/^\/projects\/([^/]+)/)?.[1] ?? null);
	const onHarbour = $derived(page.url.pathname === '/harbour' || !!taskId);
	// The Projects page lists every project; each project's own pages sit under it.
	const onProjects = $derived(page.url.pathname === '/projects' || !!projectId);
	// The Logbook gathers the session and headroom pages: Headroom, Where time went and
	// Decided for you.
	const onLogbook = $derived(['/headroom', '/time', '/decisions'].includes(page.url.pathname));
	// Fleet plugin entries: menu pages (nav.page) after the built-in tabs, and small indicators.
	// No page waits on them: the header takes them from a page that loaded them, else fetches them.
	const pageSlots = $derived(page.data.slots as Record<SlotKey, SlotView> | undefined);
	const fleetSlotsAt = $derived(
		pageSlots?.[slotKey.fleet] ? ((page.data.slotsAt as number | undefined) ?? 0) : 0
	);
	const fleetEntries = $derived(
		slots.entries(slotKey.fleet, pageSlots, fleetSlotsAt).filter((e) => e.content.available)
	);
	const indicators = $derived(fleetEntries.filter((e) => e.slot === 'header.indicator'));
	$effect(() => {
		void live.revision;
		slots.refresh(slotKey.fleet, fleetSlotsAt);
	});
	const tabs = $derived([
		{ href: '/', label: 'Firstmate', on: page.url.pathname === '/' },
		{ href: '/harbour', label: 'Harbour', on: onHarbour },
		{ href: '/projects', label: 'Projects', on: onProjects },
		{ href: '/inbox', label: 'Decisions', on: page.url.pathname === '/inbox' },
		{ href: '/spec', label: 'Spec', on: page.url.pathname === '/spec' },
		{ href: '/headroom', label: 'Logbook', on: onLogbook },
		...fleetEntries
			.filter((e) => e.slot === 'nav.page')
			.map((e) => ({
				href: navPageHref(e),
				label: e.title,
				on: page.url.pathname === navPageHref(e)
			}))
	]);
	// Questions waiting for an answer, without the ones asked about later in this browser.
	const decisionsOpen = $derived(inbox.open(live.now));
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

	// Picking a project scopes the page you are on: the Harbour board (also from the project
	// pages), else the home page's rail.
	function pick(id: string) {
		const base =
			page.url.pathname === '/harbour' || page.url.pathname === '/projects' || projectId
				? '/harbour'
				: '/';
		const view = base === '/harbour' ? page.url.searchParams.get('view') : null;
		const q = [
			id !== 'all' ? `project=${encodeURIComponent(id)}` : null,
			view ? `view=${encodeURIComponent(view)}` : null
		].filter(Boolean);
		goto(q.length ? `${base}?${q.join('&')}` : base);
	}

	const watch = $derived(
		!sup?.available
			? { dot: 'bg-muted-foreground', label: 'Firstmate unknown' }
			: sup.onWatch
				? { dot: 'bg-success', label: 'Firstmate on watch' }
				: sup.onWatch === false
					? { dot: 'bg-danger', label: 'Firstmate off watch' }
					: { dot: 'bg-warning', label: 'Firstmate unclear' }
	);
</script>

<header
	class="sticky top-0 z-30 border-b border-b-foreground/75 bg-background shadow-[0_3px_0_-2px_var(--brass)]"
>
	<div class="flex h-14 items-center gap-4 px-4 sm:gap-8 sm:px-6 lg:px-10">
		<a
			href="/"
			class="flex items-center gap-2 font-logo font-semibold tracking-tight"
			aria-label="Wheelhouse"
		>
			<Anchor class="size-5 text-sea" aria-hidden="true" /><span class="hidden sm:inline"
				>Wheelhouse</span
			>
		</a>

		<!-- On a narrow screen the tabs scroll sideways inside the bar, never the page. -->
		<nav class="no-scrollbar flex min-w-0 items-center gap-1 overflow-x-auto" aria-label="Main">
			{#each tabs as tab (tab.href)}
				<a
					href={tab.href}
					aria-current={tab.on ? 'page' : undefined}
					class="nav-tab inline-flex items-center gap-1.5"
					>{tab.label}{#if tab.href === '/inbox' && decisionsOpen}<span
							class="tabular rounded-full bg-sea px-1.5 font-sans text-xs leading-4 font-medium tracking-normal text-white [font-variant-caps:normal] dark:text-slate-950"
							aria-label="{decisionsOpen} open">{decisionsOpen}</span
						>{/if}</a
				>
			{/each}
		</nav>

		<div class="ml-auto flex shrink-0 items-center gap-2 sm:gap-3">
			{#each indicators as e (e.key)}<BarePanel entry={e} />{/each}
			{#if atRisk}
				<a
					href="/headroom"
					class="hidden items-center gap-1.5 rounded-full border border-warning/40 bg-warning/10 px-3 py-1 text-xs font-medium text-warning md:flex"
				>
					<Gauge class="size-3.5" aria-hidden="true" />
					{atRisk.label}: {atRisk.percentLeft}% left, {atRisk.runsOutAt
						? `may run out at ${clock(atRisk.runsOutAt)}`
						: 'may run out before it resets'}
				</a>
			{/if}
			<Tooltip.Root>
				<Tooltip.Trigger
					class="hidden cursor-default items-center gap-2 text-sm text-muted-foreground md:flex"
				>
					<span class="size-2 rounded-full {watch.dot}" aria-hidden="true"></span>{watch.label}
				</Tooltip.Trigger>
				<Tooltip.Content class="max-w-xs">
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

			<DropdownMenu.Root>
				<DropdownMenu.Trigger>
					{#snippet child({ props })}
						<Button
							{...props}
							variant="outline"
							size="sm"
							class="max-w-44 min-w-0 justify-between gap-2 sm:max-w-none sm:min-w-44"
						>
							<span class="truncate">{currentName}</span>
							<span class="flex items-center gap-1.5">
								{#if needCount(current)}
									<span
										class="tabular rounded-full bg-sea px-1.5 text-xs leading-4 font-medium text-white dark:text-slate-950"
										aria-label="{needCount(current)} need you">{needCount(current)}</span
									>
								{/if}
								<ChevronDown class="size-4 text-muted-foreground" />
							</span>
						</Button>
					{/snippet}
				</DropdownMenu.Trigger>
				<DropdownMenu.Content align="end" class="min-w-56">
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

			<BellMenu />
			<Button
				variant="ghost"
				size="icon-sm"
				onclick={onToggleTheme}
				aria-label={dark ? 'Switch to light mode' : 'Switch to dark mode'}
			>
				{#if dark}<Sun />{:else}<Moon />{/if}
			</Button>
		</div>
	</div>
</header>
