<script lang="ts">
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { currentFleet, currentHealth, live } from '$lib/client/live.svelte';
	import type { SlotEntry } from '$lib/plugins/types';
	import type { Section } from '$lib/nav';
	import BarePanel from '$lib/components/wh/plugins/BarePanel.svelte';
	import { needsYou } from '$lib/harbour';
	import { Popover } from 'bits-ui';
	import { statsByProject } from '$lib/picker';
	import { projectLabels } from '$lib/projectnames';
	import { aliases } from '$lib/client/aliases.svelte';
	import ProjectList from './ProjectList.svelte';
	import * as Tooltip from '$lib/components/ui/tooltip';
	import { Button } from '$lib/components/ui/button';
	import { Anchor, ChevronDown, Gauge, Moon, Sun } from '@lucide/svelte';
	import { clock } from '$lib/format';
	import BellMenu from './bell/BellMenu.svelte';
	import UpdateMenu from './UpdateMenu.svelte';
	import type { AllowanceWindow } from '$lib/types';

	/**
	 * The bar across the top: the ship's status, the project switcher, Wheelhouse's
	 * updates, the bell and the light/dark switch. The main sections live in the left-hand menu (Sidebar); on a
	 * narrow screen, where that menu is left out, they sit here in the bar instead.
	 */
	let {
		dark,
		onToggleTheme,
		atRisk = null,
		sections,
		decisionsOpen = 0,
		indicators = []
	}: {
		dark: boolean;
		onToggleTheme: () => void;
		atRisk?: AllowanceWindow | null;
		sections: Section[];
		decisionsOpen?: number;
		/** Fleet plugins' small header indicators. */
		indicators?: SlotEntry[];
	} = $props();

	const fleet = $derived(currentFleet());
	const health = $derived(currentHealth());
	const sup = $derived(health?.supervisor);
	const projects = $derived(fleet?.projects ?? []);
	const stats = $derived(statsByProject(projects, fleet?.tasks ?? [], live.now));
	// The project picker: a search, then pinned, most active and the rest (ProjectList).
	let pickerOpen = $state(false);
	let picker = $state<ReturnType<typeof ProjectList> | null>(null);

	// Project scope lives in the URL (?project=); a task page shows its own project, and a
	// project's own pages (/projects/<id>/…) theirs.
	const taskId = $derived(page.url.pathname.match(/^\/tasks\/([^/]+)/)?.[1] ?? null);
	const projectId = $derived(page.url.pathname.match(/^\/projects\/([^/]+)/)?.[1] ?? null);
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
	// The trigger shows the project's own part (or friendly name), its group prefix muted.
	const currentLabel = $derived(
		current === 'all' ? null : (projectLabels(projects, aliases.names).get(current) ?? null)
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

		<!-- Narrow screens have no left menu, so the sections sit here and scroll sideways
		     inside the bar, never the page. -->
		<nav
			class="no-scrollbar flex min-w-0 items-center gap-1 overflow-x-auto md:hidden"
			aria-label="Sections"
		>
			{#each sections as tab (tab.href)}
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

			<Popover.Root bind:open={pickerOpen}>
				<Popover.Trigger>
					{#snippet child({ props })}
						<Button
							{...props}
							variant="outline"
							size="sm"
							class="max-w-44 min-w-0 justify-between gap-2 sm:max-w-none sm:min-w-44"
							aria-label="Project: {currentName}"
						>
							{#if currentLabel?.group && currentLabel.label !== currentLabel.full}
								<span class="project-name" title={currentLabel.full}>
									<span class="project-prefix">{currentLabel.group} ›</span><span class="truncate"
										>{currentLabel.label}</span
									>
								</span>
							{:else}
								<span class="truncate" title={currentName}
									>{currentLabel?.label ?? currentName}</span
								>
							{/if}
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
				</Popover.Trigger>
				<Popover.Portal>
					<Popover.Content
						align="end"
						sideOffset={4}
						class="z-50 w-72 max-w-[calc(100vw-2rem)] overflow-hidden rounded-md bg-popover text-popover-foreground shadow-md ring-1 ring-foreground/10"
						onOpenAutoFocus={(e) => {
							e.preventDefault();
							picker?.focus();
						}}
					>
						<ProjectList
							bind:this={picker}
							{projects}
							{stats}
							{current}
							{needCount}
							onpick={(id) => {
								pickerOpen = false;
								pick(id);
							}}
						/>
					</Popover.Content>
				</Popover.Portal>
			</Popover.Root>

			<UpdateMenu />
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
