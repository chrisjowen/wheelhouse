<script lang="ts">
	import {
		ChevronRight,
		LockKeyhole,
		MessageSquare,
		Pencil,
		Share2,
		TriangleAlert,
		X
	} from '@lucide/svelte';
	import SettingsNav from '$lib/components/wh/settings/SettingsNav.svelte';
	import { FIRSTMATE_SETTINGS_TOPICS } from '$lib/firstmate-settings';
	import type {
		FirstmateProject,
		FirstmateSetting,
		FirstmateSettingsView
	} from '$lib/server/firstmate/settings';

	let { data } = $props();
	const view = $derived(data.view as FirstmateSettingsView);
	const sharedSettings = $derived(view.settings.filter((setting) => setting.share === 'shared'));
	const startupNotice = $derived(
		view.startupBudget && view.startupBudget.used !== null && view.startupBudget.overBy !== null
			? {
					used: view.startupBudget.used,
					budget: view.startupBudget.budget,
					overBy: view.startupBudget.overBy
				}
			: null
	);

	type Selection =
		{ kind: 'setting'; item: FirstmateSetting } | { kind: 'project'; item: FirstmateProject };
	let selected = $state<Selection | null>(null);
	let closeButton = $state<HTMLButtonElement | undefined>();

	function openSetting(item: FirstmateSetting) {
		selected = { kind: 'setting', item };
	}

	function openProject(item: FirstmateProject) {
		selected = { kind: 'project', item };
	}

	function closeSheet() {
		selected = null;
	}

	function keydown(event: KeyboardEvent) {
		if (event.key === 'Escape') closeSheet();
	}

	function topicName(id: string): string {
		return FIRSTMATE_SETTINGS_TOPICS.find((topic) => topic.id === id)?.name ?? 'Firstmate';
	}

	function askHref(label: string): string {
		return `/?draft=${encodeURIComponent(`Please review how ${label.toLowerCase()} is configured.`)}`;
	}

	function shareLabel(share: FirstmateSetting['share']): string {
		if (share === 'shared') return 'Shared with second mates';
		if (share === 'home') return 'This home only';
		return 'Not applicable';
	}

	function tagClass(tag: FirstmateSetting['tag'] | 'Editable' | null): string {
		if (tag === 'Editable') return 'border-foreground/20 text-foreground';
		if (tag === 'Ask Firstmate') return 'border-brass/45 bg-brass/5 text-foreground';
		if (tag === 'Security' || tag === 'Captain only') return 'border-dashed text-muted-foreground';
		return 'text-muted-foreground';
	}

	function projectNow(project: FirstmateProject): { label: string; value: string }[] {
		return [
			{ label: 'How work is checked', value: project.mode },
			{ label: 'Merge green work', value: project.autoMerge ? 'Firstmate merges' : 'You approve' },
			{
				label: 'Workers at once',
				value: project.capacity ? `${project.capacity} at once` : 'No limit'
			}
		];
	}
</script>

<svelte:head><title>Firstmate settings · Wheelhouse</title></svelte:head>
<svelte:window onkeydown={keydown} />

<main class="px-4 py-6 sm:px-6 lg:px-10">
	<div class="surface px-5 py-6 sm:px-8 sm:py-8">
		<SettingsNav />
		<h1 class="mt-6 text-2xl">Firstmate</h1>
		<p class="mt-1 max-w-3xl text-sm text-muted-foreground">
			How Firstmate runs in this home: what each setting changes and what this home says it shares.
			This page is read-only; remote second mates’ effective settings are not fetched.
		</p>

		{#if !view.available}
			<p class="mt-8 rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
				{view.reason ?? 'Wheelhouse is not connected to a Firstmate home.'}
			</p>
		{:else}
			<div class="mt-6 flex flex-wrap items-center gap-x-6 gap-y-2 text-sm text-muted-foreground">
				<span class="inline-flex items-center gap-2"
					><span class="size-2 rounded-full bg-success"></span>Read just now from this Firstmate</span
				>
				<span>{view.projectCount} projects</span>
				<span>{view.mateCount} second mates</span>
				<span>{view.dispatchRuleCount} dispatch rules</span>
			</div>

			{#if startupNotice}
				<div
					class="mt-5 flex max-w-5xl items-start gap-3 rounded-lg border border-warning/40 bg-warning/5 p-3 text-sm"
				>
					<TriangleAlert class="mt-0.5 size-4 shrink-0 text-warning" aria-hidden="true" />
					<p class="flex-1">
						<strong class="font-semibold text-warning">Your startup notes are over budget.</strong>
						Firstmate reads about {startupNotice.used.toLocaleString()} tokens against a budget of
						{startupNotice.budget.toLocaleString()} ({startupNotice.overBy.toLocaleString()} over). Older
						notes may be trimmed at a later tidy-up.
					</p>
					<button
						class="rounded-md border px-2.5 py-1 text-xs hover:bg-muted"
						onclick={() => {
							const setting = view.settings.find((item) => item.id === 'startup-budget');
							if (setting) openSetting(setting);
						}}>Review</button
					>
				</div>
			{/if}

			<nav class="mt-6 flex flex-wrap gap-2" aria-label="Firstmate settings topics">
				{#each FIRSTMATE_SETTINGS_TOPICS as topic (topic.id)}
					<a
						href="#topic-{topic.id}"
						class="rounded-full border px-3 py-1 text-xs text-muted-foreground hover:border-foreground/30 hover:text-foreground"
						>{topic.name}</a
					>
				{/each}
			</nav>

			{#each FIRSTMATE_SETTINGS_TOPICS as topic (topic.id)}
				<section id="topic-{topic.id}" class="mt-10 scroll-mt-20">
					<h2
						class="flex items-center gap-3 font-mono text-xs font-medium tracking-[0.2em] text-muted-foreground uppercase"
					>
						{topic.name}<span class="h-px flex-1 bg-hair"></span>
					</h2>
					<p class="mt-2 mb-3 max-w-3xl text-sm text-muted-foreground">{topic.blurb}</p>

					{#if topic.id === 'projects'}
						<div class="overflow-hidden rounded-lg border bg-card">
							<div
								class="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3 text-sm text-muted-foreground"
							>
								<span
									>{view.projects.length} projects · {view.projects.filter(
										(project) => project.autoMerge
									).length} set to merge green work</span
								>
								<div class="flex gap-2">
									<span class="rounded border px-2 py-0.5 text-xs">Editable</span><span
										class="rounded border px-2 py-0.5 text-xs">This home’s list</span
									>
								</div>
							</div>
							{#if view.projects.length}
								<div class="divide-y">
									{#each view.projects as project (project.name)}
										<button
											class="grid w-full gap-2 px-4 py-3 text-left hover:bg-muted/50 sm:grid-cols-[minmax(10rem,1.1fr)_minmax(11rem,1fr)_minmax(8rem,.8fr)_minmax(6rem,.7fr)_1.25rem] sm:items-center"
											onclick={() => openProject(project)}
										>
											<span class="font-medium">{project.name}</span>
											<span class="text-sm text-muted-foreground">{project.modeShort}</span>
											<span
												class="text-sm {project.autoMerge ? 'text-teal' : 'text-muted-foreground'}"
												>{project.autoMerge ? 'Firstmate merges' : 'You approve'}</span
											>
											<span class="text-sm text-muted-foreground"
												>{project.capacity ? `${project.capacity} at once` : 'No limit'}</span
											>
											<ChevronRight class="size-4 text-muted-foreground" aria-hidden="true" />
										</button>
									{/each}
								</div>
							{:else}
								<p class="px-4 py-6 text-sm text-muted-foreground">
									No projects are registered in this home.
								</p>
							{/if}
						</div>
					{:else if topic.id === 'mates'}
						<div class="overflow-hidden rounded-lg border bg-card">
							{#if view.mates.length}
								<div class="divide-y">
									{#each view.mates as mate (mate.id)}
										<div
											class="grid gap-2 px-4 py-4 sm:grid-cols-[minmax(10rem,.8fr)_minmax(0,1.2fr)]"
										>
											<div>
												<h3 class="font-semibold">{mate.id}</h3>
												<p class="mt-1 text-sm text-muted-foreground">
													{mate.remote ? 'Remote second mate' : 'Local second mate'}
												</p>
											</div>
											<div class="flex flex-wrap gap-2">
												{#each mate.projects as project (project)}<span
														class="rounded border px-2 py-0.5 text-xs">{project}</span
													>{:else}<span class="text-sm text-muted-foreground"
														>No projects listed</span
													>{/each}
											</div>
										</div>
									{/each}
								</div>
							{:else}
								<p class="px-4 py-5 text-sm text-muted-foreground">
									No second-mate routes are recorded in this home.
								</p>
							{/if}
							<div class="border-t px-4 py-4">
								<p class="text-sm font-medium">Settings this home says it shares</p>
								<p class="mt-1 text-xs text-muted-foreground">
									This is the configured inheritance, not a reading of what any second mate
									currently uses.
								</p>
								<div class="mt-3 flex flex-wrap gap-2">
									{#each sharedSettings as setting (setting.id)}<span
											class="rounded border bg-background px-2 py-1 text-xs">{setting.label}</span
										>{/each}
								</div>
							</div>
						</div>
					{:else}
						<div class="divide-y overflow-hidden rounded-lg border bg-card">
							{#each view.settings.filter((setting) => setting.topic === topic.id) as setting (setting.id)}
								<button
									class="grid w-full gap-2 px-4 py-3 text-left hover:bg-muted/50 sm:grid-cols-[minmax(12rem,1.05fr)_minmax(12rem,1.2fr)_minmax(12rem,.9fr)_1.25rem] sm:items-center"
									onclick={() => openSetting(setting)}
								>
									<span
										><span class="block font-medium">{setting.label}</span><span
											class="mt-0.5 block text-sm leading-snug text-muted-foreground"
											>{setting.meaning}</span
										></span
									>
									<span class="text-sm"
										>{setting.value}{#if setting.sub}<span
												class="mt-0.5 block text-xs text-muted-foreground">{setting.sub}</span
											>{/if}</span
									>
									<span class="flex flex-wrap gap-1.5">
										{#if setting.tag}<span
												class="inline-flex items-center gap-1 rounded border px-2 py-0.5 text-xs {tagClass(
													setting.tag
												)}"
												>{#if setting.tag === 'Editable'}<Pencil
														class="size-3"
														aria-hidden="true"
													/>{:else if setting.tag === 'Ask Firstmate'}<MessageSquare
														class="size-3"
														aria-hidden="true"
													/>{:else}<LockKeyhole
														class="size-3"
														aria-hidden="true"
													/>{/if}{setting.tag}</span
											>{/if}
										<span
											class="inline-flex items-center gap-1 rounded border px-2 py-0.5 text-xs {setting.share ===
											'shared'
												? 'border-teal/35 bg-teal/5 text-teal'
												: 'text-muted-foreground'}"
											>{#if setting.share === 'shared'}<Share2
													class="size-3"
													aria-hidden="true"
												/>{/if}{shareLabel(setting.share)}</span
										>
									</span>
									<ChevronRight class="size-4 text-muted-foreground" aria-hidden="true" />
								</button>
							{/each}
						</div>
					{/if}
				</section>
			{/each}
		{/if}
	</div>
</main>

{#if selected}
	<button
		class="fixed inset-0 z-40 bg-black/40"
		aria-label="Close setting details"
		onclick={closeSheet}
	></button>
	<div
		class="fixed inset-y-0 right-0 z-50 flex w-full flex-col border-l bg-panel shadow-xl sm:w-[min(44rem,100vw)]"
		role="dialog"
		aria-modal="true"
		aria-labelledby="setting-title"
		tabindex="-1"
	>
		<header class="flex items-start gap-3 border-b p-5 sm:px-7">
			<div class="min-w-0 flex-1">
				<p class="font-mono text-[0.68rem] tracking-[0.2em] text-muted-foreground uppercase">
					{selected.kind === 'project' ? 'Projects' : topicName(selected.item.topic)}
				</p>
				<h2 id="setting-title" class="mt-1 font-title text-2xl">
					{selected.kind === 'project' ? selected.item.name : selected.item.label}
				</h2>
				{#if selected.kind === 'setting'}<p class="mt-1 text-sm text-muted-foreground">
						{selected.item.meaning}
					</p>{/if}
			</div>
			<button
				bind:this={closeButton}
				class="grid size-9 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
				aria-label="Close"
				onclick={closeSheet}><X class="size-4" /></button
			>
		</header>
		<div class="min-h-0 flex-1 overflow-y-auto px-5 py-5 sm:px-7">
			<dl class="grid gap-x-5 gap-y-4 sm:grid-cols-[9rem_minmax(0,1fr)]">
				<dt class="text-sm text-muted-foreground">Now</dt>
				<dd class="m-0 text-sm">
					{#if selected.kind === 'setting'}
						<strong class="font-semibold">{selected.item.value}</strong>
						{#if selected.item.sub}<p class="mt-1 text-sm text-muted-foreground">
								{selected.item.sub}
							</p>{/if}
						{#each selected.item.details as detail (detail.title)}
							<div class="mt-4">
								<h3 class="mb-1 text-xs font-medium tracking-wider text-muted-foreground uppercase">
									{detail.title}
								</h3>
								<dl class="space-y-1">
									{#each detail.rows as row, i (`${row.label}-${i}`)}<div
											class="grid grid-cols-[minmax(7rem,.7fr)_minmax(0,1.3fr)] gap-3 border-t py-1.5 first:border-0"
										>
											<dt class="text-xs text-muted-foreground">{row.label}</dt>
											<dd class="m-0 text-sm break-words">{row.value}</dd>
										</div>{/each}
								</dl>
							</div>
						{/each}
					{:else}
						<dl class="space-y-2">
							{#each projectNow(selected.item) as row (row.label)}<div>
									<dt class="text-xs text-muted-foreground">{row.label}</dt>
									<dd class="m-0 font-medium">{row.value}</dd>
								</div>{/each}
						</dl>
					{/if}
				</dd>
				<dt class="text-sm text-muted-foreground">What it changes</dt>
				<dd class="m-0 text-sm">
					{selected.kind === 'project' ? selected.item.meaning : selected.item.affects}
				</dd>
				<dt class="text-sm text-muted-foreground">Second mates</dt>
				<dd class="m-0 text-sm text-muted-foreground">
					{selected.item.shareText}
				</dd>
			</dl>

			<section class="mt-7">
				<h3
					class="flex items-center gap-3 font-mono text-xs font-medium tracking-[0.2em] text-muted-foreground uppercase"
				>
					History<span class="h-px flex-1 bg-hair"></span>
				</h3>
				<ul class="mt-2 space-y-2 text-sm">
					{#each selected.item.history as entry (entry)}<li
							class="border-t pt-2 first:border-0 first:pt-0"
						>
							{entry}
						</li>{/each}
				</ul>
			</section>

			<details class="mt-6 rounded-lg border border-dashed p-3">
				<summary class="cursor-pointer text-sm text-muted-foreground">Technical details</summary>
				<dl class="mt-3 grid gap-x-4 gap-y-2 text-sm sm:grid-cols-[8rem_minmax(0,1fr)]">
					<dt class="text-muted-foreground">Stored in</dt>
					<dd class="m-0 font-mono text-xs break-words">{selected.item.technical.file}</dd>
					<dt class="text-muted-foreground">Read by</dt>
					<dd class="m-0">{selected.item.technical.reader}</dd>
					<dt class="text-muted-foreground">Documented</dt>
					<dd class="m-0">{selected.item.technical.documentation}</dd>
					{#if selected.item.technical.effect}<dt class="text-muted-foreground">
							How it takes effect
						</dt>
						<dd class="m-0">{selected.item.technical.effect}</dd>{/if}
				</dl>
			</details>
		</div>
		{#if selected.kind === 'setting' && selected.item.tag === 'Ask Firstmate' && data.canAsk}
			<footer class="flex items-center gap-3 border-t p-4 sm:px-7">
				<a
					class="inline-flex h-9 items-center gap-2 rounded-md bg-primary px-3 text-sm text-primary-foreground hover:opacity-90"
					href={askHref(selected.item.label)}><MessageSquare class="size-4" />Ask Firstmate</a
				>
				<span class="text-xs text-muted-foreground"
					>Opens a draft in chat; nothing is sent until you send it.</span
				>
				<button
					class="ml-auto rounded-md px-3 py-2 text-sm text-muted-foreground hover:bg-muted"
					onclick={closeSheet}>Close</button
				>
			</footer>
		{:else}
			<footer class="flex justify-end border-t p-4 sm:px-7">
				<button
					class="rounded-md px-3 py-2 text-sm text-muted-foreground hover:bg-muted"
					onclick={closeSheet}>Close</button
				>
			</footer>
		{/if}
	</div>
{/if}
