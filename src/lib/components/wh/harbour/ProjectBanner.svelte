<script lang="ts">
	import { aliases } from '$lib/client/aliases.svelte';
	import { berth, projectLine } from '$lib/berths';
	import { ago } from '$lib/format';
	import { projectTabHref } from '$lib/plugins/keys';
	import type { SlotEntry } from '$lib/plugins/types';
	import { projectLabels } from '$lib/projectnames';
	import type { Project, TaskSummary } from '$lib/types';
	import { postureWords } from '$lib/views';
	import { ChevronLeft, ExternalLink } from '@lucide/svelte';
	import ProjectStateMark from './ProjectStateMark.svelte';

	/**
	 * The top of every page of one project: its name and state, the one thing that
	 * matters most right now, how busy it is and how it ships, and a row of tabs for all
	 * its pages (its work, each plugin's tab, its passage) and its repository. Compact,
	 * for a plugin tab that fills the window, it is one line: the name, state and tabs.
	 */
	let {
		id,
		project,
		tasks,
		tabs,
		repo,
		current,
		now,
		compact = false
	}: {
		id: string;
		project: Project | null;
		tasks: TaskSummary[];
		tabs: SlotEntry[];
		repo: string | null;
		/** 'work', 'passage', or the current plugin tab's key. */
		current: string;
		now: number;
		compact?: boolean;
	} = $props();

	const base = $derived(`/projects/${encodeURIComponent(id)}`);
	const b = $derived(project ? berth(project, tasks, now) : null);
	const label = $derived(
		project ? projectLabels([project], aliases.names).get(project.id) : undefined
	);
	const name = $derived(label?.label ?? project?.name ?? id);
	const posture = $derived(project ? postureWords(project) : null);
	const facts = $derived(
		b
			? [
					`${b.underWay} under way`,
					b.yourMove.length ? `${b.yourMove.length} waiting on you` : null,
					`${b.landed.length} landed this week`,
					b.lastActivity === null
						? 'no activity yet'
						: `last activity ${ago(new Date(b.lastActivity).toISOString(), now)}`,
					posture?.short ?? null
				].filter(Boolean)
			: []
	);
	const passage = $derived(
		project?.passage?.problems ? 'text-danger' : project?.passage?.needsConsent ? 'text-sea' : ''
	);
</script>

{#snippet tabRow()}
	<a
		href={base}
		class="nav-tab -mb-px border-b-2"
		aria-current={current === 'work' ? 'page' : undefined}>Work</a
	>
	{#each tabs as e (e.key)}
		<a
			href={projectTabHref(id, e)}
			class="nav-tab -mb-px border-b-2"
			data-slot="project.tab"
			aria-current={current === e.key ? 'page' : undefined}>{e.title}</a
		>
	{/each}
	{#if id !== 'unassigned'}
		<a
			href="{base}/passage"
			class="nav-tab -mb-px border-b-2 {passage}"
			aria-current={current === 'passage' ? 'page' : undefined}
			title={project?.passage?.problems
				? 'Its passage file has problems'
				: project?.passage?.needsConsent
					? 'Its passage checks need enabling'
					: undefined}>Passage</a
		>
	{/if}
	{#if repo}
		<a
			href={repo}
			target="_blank"
			rel="noreferrer"
			class="nav-tab -mb-px inline-flex items-center gap-1 border-b-2"
			>Repository<ExternalLink class="size-3.5" aria-hidden="true" /></a
		>
	{/if}
{/snippet}

{#if compact}
	<nav
		class="no-scrollbar flex shrink-0 items-end gap-x-1 overflow-x-auto border-b border-hair bg-panel px-4 pt-1.5 sm:px-6"
		aria-label="{name} pages"
	>
		<a
			href="/harbour"
			class="mr-1 mb-2 inline-flex items-center gap-1 text-sm whitespace-nowrap text-muted-foreground hover:text-foreground"
			><ChevronLeft class="size-4" aria-hidden="true" />Harbour</a
		>
		<a href={base} class="mr-2 mb-2 font-display text-lg whitespace-nowrap hover:underline"
			>{name}</a
		>
		{#if b}<span class="mr-3 mb-2"><ProjectStateMark state={b.state} /></span>{/if}
		{@render tabRow()}
	</nav>
{:else}
	<header
		class="-mx-4 -mt-6 border-b border-hair bg-panel px-4 pt-5 sm:-mx-6 sm:px-6 lg:-mx-10 lg:px-10"
	>
		<a
			href="/harbour"
			class="inline-flex items-center gap-1 font-display text-base text-muted-foreground italic hover:text-foreground"
			><ChevronLeft class="size-4" aria-hidden="true" />Harbour</a
		>
		<div class="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
			{#if label}
				<span
					class="project-tile !h-9 !w-11 !rounded-md !text-sm"
					data-hue={label.hue}
					aria-hidden="true">{label.monogram}</span
				>
			{/if}
			<h1
				class="min-w-0 text-[2.1rem] leading-tight [overflow-wrap:anywhere]"
				title={project?.name}
			>
				{name}
			</h1>
			{#if b}<ProjectStateMark state={b.state} />{/if}
		</div>
		{#if project?.description}
			<p class="mt-1 max-w-3xl text-muted-foreground">{project.description}</p>
		{/if}
		{#if b}
			<p class="mt-4 max-w-4xl font-display text-[1.35rem] leading-snug">{projectLine(b, now)}</p>
			<p class="mt-2 text-sm text-muted-foreground">{facts.join(' · ')}</p>
		{/if}
		<nav class="mt-6 flex flex-wrap items-end gap-x-1" aria-label="{name} pages">
			{@render tabRow()}
		</nav>
	</header>
{/if}
