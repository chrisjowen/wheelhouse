<script lang="ts">
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { currentFleet, currentHealth, live } from '$lib/client/live.svelte';
	import type { SlotEntry } from '$lib/plugins/types';
	import BarePanel from '$lib/components/wh/plugins/BarePanel.svelte';
	import { needsYou } from '$lib/harbour';
	import { Popover } from 'bits-ui';
	import { statsByProject } from '$lib/picker';
	import { projectLabels } from '$lib/projectnames';
	import { aliases } from '$lib/client/aliases.svelte';
	import { chatThreads } from '$lib/client/chatthreads.svelte';
	import { topicName, UNSORTED } from '$lib/chat/topics';
	import ProjectList from './ProjectList.svelte';
	import Sheet from './Sheet.svelte';
	import { phone } from '$lib/client/phone.svelte';
	import * as Tooltip from '$lib/components/ui/tooltip';
	import { Button } from '$lib/components/ui/button';
	import { Anchor, ArrowLeft, ChevronDown, Gauge, Moon, Settings, Sun } from '@lucide/svelte';
	import { clock } from '$lib/format';
	import { homeLabel } from '$lib/bridge';
	import BellMenu from './bell/BellMenu.svelte';
	import UpdateMenu from './UpdateMenu.svelte';
	import type { AllowanceWindow } from '$lib/types';

	/**
	 * The bar across the top: the logo beside the name of the Firstmate home it watches,
	 * the ship's status, the project switcher, Wheelhouse's updates, the bell and the
	 * light/dark switch. The main sections live in the left-hand menu (Sidebar); on a
	 * phone, where that menu is left out, they are in the tab bar (TabBar). On a cloud
	 * machine opened through Wheelhouse Cloud, a link leads back to Fleetyard, where the
	 * captain's Firstmates are managed.
	 */
	let {
		dark,
		onToggleTheme,
		atRisk = null,
		indicators = []
	}: {
		dark: boolean;
		onToggleTheme: (e?: MouseEvent) => void;
		atRisk?: AllowanceWindow | null;
		/** Fleet plugins' small header indicators. */
		indicators?: SlotEntry[];
	} = $props();

	const fleetyard = $derived((page.data.fleetyard as string | null | undefined) ?? null);
	const fleet = $derived(currentFleet());
	const health = $derived(currentHealth());
	const sup = $derived(health?.supervisor);
	// The Firstmate home this Wheelhouse watches, by its own name, beside the logo.
	const home = $derived(homeLabel(health?.firstmate.home));
	const projects = $derived(fleet?.projects ?? []);
	const stats = $derived(statsByProject(projects, fleet?.tasks ?? [], live.now));
	// The project picker: a search, then pinned, most active and the rest (ProjectList),
	// in a popover, or on a phone a sheet from the bottom of the screen.
	let pickerOpen = $state(false);
	let picker = $state<ReturnType<typeof ProjectList> | null>(null);

	// Project scope lives in the URL (?project=); a task page shows its own project, and a
	// project's own pages (/projects/<id>/…) theirs. On the home page the chat's threads
	// that are not projects (a topic, or Unsorted) are offered too, as `thread:<topic>`
	// (?thread=), with how many messages each project and topic has in the chat.
	const onHome = $derived(page.url.pathname === '/');
	const THREAD = 'thread:';
	const topics = $derived(
		onHome
			? chatThreads.rows
					.filter((r) => !r.project)
					.map((r) => ({ id: `${THREAD}${r.topic}`, name: r.name, hue: r.hue }))
			: []
	);
	const chatCounts = $derived(
		onHome
			? new Map(chatThreads.rows.map((r) => [r.project ? r.topic : `${THREAD}${r.topic}`, r.count]))
			: undefined
	);
	const threadRow = (id: string) =>
		chatThreads.rows.find((r) => !r.project && `${THREAD}${r.topic}` === id);
	const taskId = $derived(page.url.pathname.match(/^\/tasks\/([^/]+)/)?.[1] ?? null);
	const projectId = $derived(page.url.pathname.match(/^\/projects\/([^/]+)/)?.[1] ?? null);
	const current = $derived.by(() => {
		const t = onHome ? page.url.searchParams.get('thread') : null;
		if (t) return `${THREAD}${t}`;
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
		pid.startsWith(THREAD)
			? (threadRow(pid)?.needs ?? 0)
			: (fleet?.tasks ?? []).filter((t) => (pid === 'all' || t.projectId === pid) && needsYou(t))
					.length;
	const currentName = $derived.by(() => {
		if (current === 'all') return 'All projects';
		if (current.startsWith(THREAD)) {
			const topic = current.slice(THREAD.length);
			return threadRow(current)?.name ?? (topic === UNSORTED ? 'Unsorted' : topicName(topic));
		}
		return projects.find((p) => p.id === current)?.name ?? current;
	});
	// The trigger shows the project's own part (or friendly name), its group prefix muted.
	const currentLabel = $derived(
		current === 'all' || current.startsWith(THREAD)
			? null
			: (projectLabels(projects, aliases.names).get(current) ?? null)
	);

	// Picking a project scopes the page you are on. On the Harbour (and a project's own
	// pages) it opens that project's page, or the Harbour for all projects; the Passage and
	// Radar charts stay and narrow to it; elsewhere it scopes the home page's rail.
	function pick(id: string) {
		if (id.startsWith(THREAD)) {
			goto(`/?thread=${encodeURIComponent(id.slice(THREAD.length))}`);
			return;
		}
		const harbour = page.url.pathname === '/harbour' || projectId;
		const view = harbour ? page.url.searchParams.get('view') : null;
		if (harbour && view !== 'passage' && view !== 'radar') {
			goto(id === 'all' ? '/harbour' : `/projects/${encodeURIComponent(id)}`);
			return;
		}
		const base = harbour ? '/harbour' : '/';
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

{#snippet pickerTrigger()}
	{#if currentLabel?.group && currentLabel.label !== currentLabel.full}
		<span class="project-name" title={currentLabel.full}>
			<span class="project-prefix">{currentLabel.group} ›</span><span class="truncate"
				>{currentLabel.label}</span
			>
		</span>
	{:else}
		<span class="truncate" title={currentName}>{currentLabel?.label ?? currentName}</span>
	{/if}
	<span class="flex items-center gap-1.5">
		{#if needCount(current)}
			<span
				class="tabular rounded-full bg-sea px-1.5 text-xs leading-4 font-medium text-on-accent"
				aria-label="{needCount(current)} need you">{needCount(current)}</span
			>
		{/if}
		<ChevronDown class="size-4 text-muted-foreground" />
	</span>
{/snippet}

{#snippet projectList()}
	<ProjectList
		bind:this={picker}
		{projects}
		{stats}
		{current}
		{needCount}
		{topics}
		counts={chatCounts}
		onpick={(id) => {
			pickerOpen = false;
			pick(id);
		}}
	/>
{/snippet}

<header class="sticky top-0 z-30 border-b bg-header">
	<div class="flex h-15 items-center gap-3 px-3 sm:gap-5 sm:px-5">
		<a
			href="/"
			class="flex shrink-0 items-center gap-2.5 font-logo text-[1.2rem] font-bold tracking-tight max-md:min-h-11"
			aria-label="Wheelhouse"
		>
			<span class="logo-mark"><Anchor class="size-5" aria-hidden="true" /></span><span
				class="hidden sm:inline">Wheelhouse</span
			>
		</a>
		{#if home}<span
				class="home-tag hidden md:inline-block"
				title="Firstmate home: {health?.firstmate.home}">{home}</span
			>{/if}
		{#if fleetyard}
			<a
				href={fleetyard}
				class="flex shrink-0 items-center gap-1.5 rounded-md border border-border bg-card/60 px-2.5 py-1 text-sm font-medium text-foreground hover:bg-muted/60 max-md:min-h-11"
				title="Back to Fleetyard, where your Firstmates are managed"
				data-fleetyard><ArrowLeft class="size-3.5" aria-hidden="true" />Fleetyard</a
			>
		{/if}

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
					class="hidden cursor-default items-center gap-2 text-sm text-foreground md:flex"
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

			{#if phone.current}
				<Button
					variant="outline"
					size="sm"
					class="h-11 max-w-44 min-w-0 justify-between gap-2 bg-card/60 font-medium"
					aria-label="Project: {currentName}"
					aria-haspopup="dialog"
					onclick={() => (pickerOpen = true)}>{@render pickerTrigger()}</Button
				>
				<!-- The keyboard stays down until the search is tapped: the list is what a phone needs. -->
				<Sheet bind:open={pickerOpen} title="Projects" onOpenAutoFocus={(e) => e.preventDefault()}>
					{@render projectList()}
				</Sheet>
			{:else}
				<Popover.Root bind:open={pickerOpen}>
					<Popover.Trigger>
						{#snippet child({ props })}
							<Button
								{...props}
								variant="outline"
								size="sm"
								class="h-9 max-w-44 min-w-0 justify-between gap-2 bg-card/60 font-medium sm:max-w-none sm:min-w-46"
								aria-label="Project: {currentName}"
							>
								{@render pickerTrigger()}
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
							{@render projectList()}
						</Popover.Content>
					</Popover.Portal>
				</Popover.Root>
			{/if}

			<!-- On phones these live in /more; hidden below md so the header stays compact. -->
			<div class="hidden md:contents">
				<UpdateMenu />
				<BellMenu />
			</div>
			<Button
				variant="ghost"
				size="icon-sm"
				href="/settings/gateway"
				aria-label="Settings"
				aria-current={page.url.pathname.startsWith('/settings') ? 'page' : undefined}
				class="hidden md:inline-flex"
			>
				<Settings />
			</Button>
			<Button
				variant="ghost"
				size="icon-sm"
				onclick={onToggleTheme}
				aria-label={dark ? 'Switch to light mode' : 'Switch to dark mode'}
				class="hidden md:inline-flex"
			>
				{#if dark}<Sun />{:else}<Moon />{/if}
			</Button>
		</div>
	</div>
</header>
