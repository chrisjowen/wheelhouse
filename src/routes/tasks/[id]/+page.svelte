<script lang="ts">
	import { page } from '$app/state';
	import { currentFleet, live } from '$lib/client/live.svelte';
	import { slots } from '$lib/client/slots.svelte';
	import { slotKey } from '$lib/plugins/keys';
	import type { SlotEntry } from '$lib/plugins/types';
	import SlotContent from '$lib/components/wh/plugins/SlotContent.svelte';
	import { ago, clock, workerName } from '$lib/format';
	import { Button } from '$lib/components/ui/button';
	import OutputInspector from '$lib/components/wh/OutputInspector.svelte';
	import ReviewPanel from '$lib/components/wh/ReviewPanel.svelte';
	import StageTrack from '$lib/components/wh/StageTrack.svelte';
	import Thumb from '$lib/components/wh/Thumb.svelte';
	import { tone, textClass } from '$lib/components/wh/tone';
	import { awaitingReview } from '$lib/review';
	import type { Snippet } from 'svelte';
	import type {
		Available,
		Check,
		PassageStep,
		TaskDetail,
		TaskEvidence,
		TaskSummary
	} from '$lib/types';
	import {
		ArrowLeft,
		Check as CheckIcon,
		ChevronRight,
		CircleDashed,
		ExternalLink,
		FileText,
		LoaderCircle,
		MessageSquare,
		Minus,
		X
	} from '@lucide/svelte';

	let { data } = $props();

	let fetched = $state<TaskDetail | null>(null);
	const FILES_PREVIEW = 12;
	let showAllFiles = $state(false);
	let lastFetch = 0;
	const id = $derived(page.params.id!);
	const detail = $derived(fetched?.task.id === id ? fetched : data.detail);
	// Prefer the live summary from the fleet stream; evidence refreshes separately.
	const task = $derived(currentFleet()?.tasks.find((t) => t.id === id) ?? detail?.task ?? null);
	const ev = $derived(detail?.evidence ?? null);
	const project = $derived(currentFleet()?.projects.find((p) => p.id === task?.projectId));

	// Refetch evidence when the fleet changes, at most every 10 s.
	$effect(() => {
		void live.revision;
		const want = id;
		if (Date.now() - lastFetch < 10_000) return;
		lastFetch = Date.now();
		fetch(`/api/tasks/${encodeURIComponent(want)}`)
			.then((r) => (r.ok ? r.json() : null))
			.then((d: TaskDetail | null) => {
				if (d && d.task.id === id) fetched = d;
			})
			.catch(() => {});
	});

	// Plugin entries for this task (task.section and step.evidence slots).
	const pluginEntries = $derived(slots.entries(slotKey.task(id), data.slots));
	const stepEntries = (key: string) =>
		pluginEntries.filter((e) => e.slot === 'step.evidence' && e.step === key);
	$effect(() => {
		void live.revision;
		slots.refresh(slotKey.task(id), data.slotsAt);
	});

	const t = $derived(task ? tone(task) : 'normal');
	const step = $derived(task ? task.passage.steps[task.passage.current] : null);
	const back = $derived(task ? `/?project=${encodeURIComponent(task.projectId)}` : '/');
	// Evidence blocks by id; each passage step lists the ids it shows (stages.ts).
	const blocks: Record<string, Snippet<[PassageStep]>> = {
		queue: queueBlock,
		progress: progressBlock,
		files: filesBlock,
		validation: validationBlock,
		pr: prBlock,
		report: reportBlock,
		screenshots: screenshotsBlock,
		preview: previewBlock,
		decision: decisionBlock,
		landed: landedBlock
	};

	// The page is an ordered list of sections; plugin task.section entries slot in by order
	// (500 unless the plugin says otherwise: after the passage, before the log).
	type SectionProps = { task: TaskSummary; ev: TaskEvidence; detail: TaskDetail };
	type Section = { id: string; class: string; order: number } & (
		{ render: Snippet<[SectionProps]> } | { entry: SlotEntry }
	);
	const builtIn: Section[] = [
		{ id: 'hero', class: '', order: 100, render: heroSection },
		{ id: 'passage', class: '', order: 200, render: passageSection },
		{ id: 'log', class: 'mt-4 max-w-3xl', order: 600, render: logSection },
		{ id: 'output', class: 'mt-4 max-w-3xl', order: 700, render: outputSection },
		{ id: 'gaps', class: 'mt-4 max-w-3xl', order: 800, render: gapsSection }
	];
	const sections = $derived(
		[
			...builtIn,
			...pluginEntries
				.filter((e) => e.slot === 'task.section')
				.map((e): Section => ({
					id: `plugin:${e.key}`,
					class: 'mt-4 max-w-3xl',
					order: e.order,
					entry: e
				}))
		].sort((a, b) => a.order - b.order)
	);

	const prState = (s: string | null, draft: boolean | null) =>
		draft
			? 'draft'
			: s === 'merged'
				? 'merged'
				: s === 'closed'
					? 'closed'
					: s === 'open'
						? 'open'
						: (s ?? 'state unknown');
</script>

<svelte:head><title>{task?.title ?? id} · Wheelhouse</title></svelte:head>

{#snippet unavailable(a: Available<unknown>)}
	{#if !a.available}<p class="text-sm text-muted-foreground">Not available. {a.reason}</p>{/if}
{/snippet}

{#snippet source(a: Available<unknown>)}
	{#if a.available}<p class="mt-1.5 text-xs text-muted-foreground">
			From {a.source}{a.observedAt ? `, ${ago(a.observedAt, live.now)}` : ''}.
		</p>{/if}
{/snippet}

{#snippet checkIcon(c: Check)}
	{#if c.state === 'pass'}<CheckIcon class="size-4 shrink-0 text-success" aria-label="Passed" />
	{:else if c.state === 'fail'}<X class="size-4 shrink-0 text-danger" aria-label="Failed" />
	{:else if c.state === 'running'}<LoaderCircle
			class="size-4 shrink-0 animate-spin text-muted-foreground"
			aria-label="Running"
		/>
	{:else if c.state === 'skipped'}<Minus
			class="size-4 shrink-0 text-muted-foreground"
			aria-label="Skipped"
		/>
	{:else}<CircleDashed class="size-4 shrink-0 text-muted-foreground" aria-label="Pending" />{/if}
{/snippet}

{#snippet filesBlock()}
	{#if ev?.files.available}
		{@const f = ev.files.value}
		{@const max = Math.max(1, ...f.files.map((x) => (x.additions ?? 0) + (x.deletions ?? 0)))}
		<h4 class="mb-2 text-sm font-medium">
			Files changed <span class="font-normal text-muted-foreground"
				>{f.branch ? `on ${f.branch}` : ''} against {f.base}</span
			>
		</h4>
		{#if f.files.length}
			<ul class="divide-y rounded-lg border">
				{#each showAllFiles ? f.files : f.files.slice(0, FILES_PREVIEW) as x (x.path)}
					<li class="flex items-center gap-3 px-3 py-2 text-xs">
						<span class="w-3 font-mono text-muted-foreground">{x.status}</span>
						<span class="min-w-0 flex-1 truncate font-mono" title={x.path}>{x.path}</span>
						{#if x.status === '?'}
							<span class="text-muted-foreground">new, not committed</span>
						{:else if x.additions === null}
							<span class="text-muted-foreground">binary</span>
						{:else}
							<span class="tabular"
								><span class="text-success">+{x.additions}</span>
								<span class="text-danger">−{x.deletions}</span></span
							>
							<span class="hidden h-1.5 w-16 overflow-hidden rounded-full bg-muted sm:flex">
								<span class="bg-success" style="width:{((x.additions ?? 0) / max) * 100}%"></span>
								<span class="bg-danger" style="width:{((x.deletions ?? 0) / max) * 100}%"></span>
							</span>
						{/if}
					</li>
				{/each}
			</ul>
			{#if !showAllFiles && f.files.length > FILES_PREVIEW}
				<button
					class="mt-2 text-sm text-muted-foreground hover:text-foreground hover:underline"
					onclick={() => (showAllFiles = true)}
				>
					Show all {f.files.length} files
				</button>
			{/if}
			{#if f.truncated}<p class="mt-1 text-xs text-muted-foreground">
					Showing the first {f.files.length} files.
				</p>{/if}
		{:else}
			<p class="text-sm text-muted-foreground">No changes yet.</p>
		{/if}
		{@render source(ev.files)}
	{:else if ev}
		{@render unavailable(ev.files)}
	{/if}
{/snippet}

{#snippet queueBlock()}
	{#if task}
		<p class="text-sm text-muted-foreground">
			{task.since ? `Filed ${task.since}.` : 'Queued by Firstmate.'}
			{#if task.blockedBy.length}Waiting on {task.blockedBy.join(', ')}.{/if}
		</p>
	{/if}
{/snippet}

{#snippet progressBlock(s: PassageStep)}
	{#if task?.summary && s.state === 'current' && !task.attention}
		<p class="text-sm text-muted-foreground">
			{task.summaryIsHistory ? 'Latest update: ' : ''}{task.summary}
		</p>
	{/if}
{/snippet}

{#snippet validationBlock()}
	{#if ev?.validation.available}
		<p class="text-sm">{ev.validation.value.detail}</p>
		{@render source(ev.validation)}
	{:else if ev}
		{@render unavailable(ev.validation)}
	{/if}
{/snippet}

{#snippet prBlock()}
	{#if ev?.pr.available}
		{@const pr = ev.pr.value}
		<p class="text-sm">
			<a
				href={pr.url}
				target="_blank"
				rel="noreferrer"
				class="inline-flex items-center gap-1 text-sea hover:underline"
				>Pull request{pr.number ? ` #${pr.number}` : ''}<ExternalLink
					class="size-3.5"
					aria-hidden="true"
				/></a
			>
			<span class="text-muted-foreground"
				>{prState(pr.state, pr.draft)}{pr.reviewDecision
					? `, ${pr.reviewDecision.toLowerCase().replace(/_/g, ' ')}`
					: ''}</span
			>
		</p>
		{#if pr.checks.length}
			<ul class="mt-3 divide-y rounded-lg border">
				{#each pr.checks as c, i (c.name + i)}
					<li class="flex items-center gap-3 px-3 py-2 text-sm">
						{@render checkIcon(c)}<span class="truncate">{c.name}</span>
					</li>
				{/each}
			</ul>
		{:else}
			<p class="mt-2 text-sm text-muted-foreground">No CI checks reported.</p>
		{/if}
		{@render source(ev.pr)}
	{:else if ev && !ev.pr.available && task?.pr}
		<a
			href={task.pr.url}
			target="_blank"
			rel="noreferrer"
			class="inline-flex items-center gap-1 text-sm text-sea hover:underline"
			>Pull request{task.pr.number ? ` #${task.pr.number}` : ''}<ExternalLink
				class="size-3.5"
				aria-hidden="true"
			/></a
		>
		<p class="mt-1 text-sm text-muted-foreground">
			Its state and checks are not available. {ev.pr.reason}
		</p>
	{:else if ev}
		{@render unavailable(ev.pr)}
	{/if}
{/snippet}

{#snippet reportBlock()}
	{#if ev?.report.available}
		<div class="flex gap-3 rounded-lg border p-3">
			<FileText class="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
			<div class="min-w-0">
				<p class="truncate font-mono text-xs text-muted-foreground">{ev.report.value.path}</p>
				<p class="mt-1 text-sm leading-relaxed">{ev.report.value.excerpt}</p>
			</div>
		</div>
		{@render source(ev.report)}
	{:else if ev}
		{@render unavailable(ev.report)}
	{/if}
{/snippet}

{#snippet screenshotsBlock()}
	{#if ev?.screenshots.available}
		<div class="grid grid-cols-2 gap-3">
			{#each ev.screenshots.value as s (s.url)}
				<a href={s.url} target="_blank" rel="noreferrer" class="min-w-0">
					<img
						src={s.url}
						alt={s.name}
						loading="lazy"
						class="aspect-[16/10] w-full rounded-lg border object-cover object-top"
					/>
					<p class="mt-1.5 truncate text-xs text-muted-foreground">{s.name}</p>
				</a>
			{/each}
		</div>
		{@render source(ev.screenshots)}
	{:else if ev}
		{@render unavailable(ev.screenshots)}
	{/if}
{/snippet}

{#snippet previewBlock()}
	{#if ev?.preview.available}
		<a
			href={ev.preview.value.url}
			target="_blank"
			rel="noreferrer"
			class="inline-flex items-center gap-1 text-sm text-sea hover:underline"
			>Open preview<ExternalLink class="size-3.5" aria-hidden="true" /></a
		>
		{@render source(ev.preview)}
	{:else if ev}
		{@render unavailable(ev.preview)}
	{/if}
{/snippet}

{#snippet decisionBlock(s: PassageStep)}
	{#if s.state === 'current' && ev?.decisions.length}
		<ul class="list-disc space-y-1 pl-5 text-sm">
			{#each ev.decisions as d, i (i)}<li class="whitespace-pre-line">{d.text}</li>{/each}
		</ul>
	{/if}
{/snippet}

{#snippet landedBlock()}
	{#if task}
		<p class="text-sm text-muted-foreground">
			{#if task.mergedAt}Merged {ago(task.mergedAt, live.now)} ({clock(task.mergedAt)}).
			{:else if task.completedOn}Closed on {task.completedOn}; the exact time was not recorded.
			{:else if task.status === 'landed'}Done.
			{/if}
		</p>
	{/if}
{/snippet}

{#snippet heroSection({ task, ev, detail }: SectionProps)}
	<div class="mt-6 grid gap-10 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
		<div class="min-w-0">
			{#if awaitingReview(task)}
				<!-- The review evidence comes first while the work waits on the captain. -->
				<ReviewPanel {task} shots={ev.screenshots.available ? ev.screenshots.value : []} />
			{:else}
				<Thumb {task} class="rounded-2xl shadow-sm" />
				{#if ev.screenshots.available && ev.screenshots.value.length > 1}
					<div class="mt-3 grid grid-cols-4 gap-3">
						{#each ev.screenshots.value.slice(0, 8) as s (s.url)}
							<a href={s.url} target="_blank" rel="noreferrer"
								><img
									src={s.url}
									alt={s.name}
									loading="lazy"
									class="aspect-[16/10] w-full rounded-md border object-cover object-top"
								/></a
							>
						{/each}
					</div>
				{/if}
			{/if}
		</div>
		<div class="flex min-w-0 flex-col">
			<p class="text-sm text-muted-foreground">
				{project?.name ?? task.projectId}{workerName(task.worker)
					? `, ${workerName(task.worker)}`
					: ''}
			</p>
			<h1 class="mt-1 text-2xl font-semibold tracking-tight text-balance">{task.title}</h1>
			<p
				class="mt-2 text-sm font-medium {t === 'normal' || t === 'landed'
					? 'text-muted-foreground'
					: textClass[t]}"
			>
				{task.statusLabel}
			</p>
			{#if task.summary && !task.attention}
				<p class="mt-2 leading-relaxed">
					{#if task.summaryIsHistory}<span class="mr-1 text-muted-foreground">Latest update:</span
						>{/if}{task.summary}
				</p>
			{/if}

			{#if task.attention}
				<div
					class="mt-6 rounded-xl p-4 {task.attention.owner === 'captain'
						? 'bg-sea/10'
						: 'bg-warning/10'}"
				>
					<p
						class="text-sm font-medium {task.attention.owner === 'captain'
							? 'text-sea'
							: 'text-warning'}"
					>
						{task.attention.owner === 'firstmate'
							? 'Waiting on Firstmate'
							: task.attention.kind === 'review'
								? 'Ready for your review'
								: 'Your decision is needed'}
					</p>
					<p class="mt-1 text-sm leading-relaxed whitespace-pre-line">{task.attention.text}</p>
					{#if detail.evidence.decisions.length > 1}
						<ul class="mt-2 list-disc space-y-1 pl-5 text-sm">
							{#each detail.evidence.decisions.slice(1) as d, i (i)}<li>{d.text}</li>{/each}
						</ul>
					{/if}
					{#if task.attention.kind === 'decision'}
						<p class="mt-2 text-xs text-muted-foreground">
							Answer through Firstmate: it passes your word to the crew.
						</p>
					{/if}
				</div>
			{/if}

			<div class="mt-6 flex flex-wrap gap-2">
				{#if task.preview && !awaitingReview(task)}
					<Button
						variant={task.attention?.owner === 'captain' && !task.pr ? 'default' : 'outline'}
						href={task.preview.url}
						target="_blank"
						rel="noreferrer">Open preview<ExternalLink /></Button
					>
				{/if}
				<!-- The message still goes to Firstmate, with this task attached. -->
				<Button
					variant={task.attention?.owner === 'captain' && task.attention.kind === 'decision'
						? 'default'
						: 'outline'}
					href="/bridge?task={encodeURIComponent(task.id)}"
					><MessageSquare />Ask Firstmate about this</Button
				>
			</div>

			<dl class="mt-8 grid grid-cols-2 gap-x-6 gap-y-3 border-t pt-6 text-sm">
				<div>
					<dt class="text-muted-foreground">Step</dt>
					<dd>{task.passage.current + 1} of {task.passage.steps.length}, {step?.label}</dd>
				</div>
				<div>
					<dt class="text-muted-foreground">Last checked</dt>
					<dd class={task.current && !task.current.fresh ? 'text-warning' : ''}>
						{#if task.current?.observedAt}{ago(task.current.observedAt, live.now)}{task.current
								.fresh
								? ''
								: ' (cached)'}
						{:else}{ago(currentFleet()?.collectedAt, live.now)}{/if}
					</dd>
				</div>
				<div>
					<dt class="text-muted-foreground">Pull request</dt>
					<dd>
						{#if task.pr}<a
								href={task.pr.url}
								target="_blank"
								rel="noreferrer"
								class="text-sea hover:underline">{task.pr.number ? `#${task.pr.number}` : 'Open'}</a
							>
							{#if ev.pr.available}<span class="text-muted-foreground"
									>{prState(ev.pr.value.state, ev.pr.value.draft)}</span
								>{/if}
						{:else}<span class="text-muted-foreground">None yet</span>{/if}
					</dd>
				</div>
				<div>
					<dt class="text-muted-foreground">Preview</dt>
					<dd>
						{#if task.preview}<a
								href={task.preview.url}
								target="_blank"
								rel="noreferrer"
								class="text-sea hover:underline"
								>Reported {ago(task.preview.reportedAt, live.now)}</a
							>
						{:else}<span class="text-muted-foreground">None reported</span>{/if}
					</dd>
				</div>
				{#if task.worker}
					<div>
						<dt class="text-muted-foreground">Crew</dt>
						<dd>
							{workerName(task.worker) ?? 'Unknown'}{task.worker.modelKnown && !task.worker.model
								? ', default model'
								: ''}
						</dd>
					</div>
					<div>
						<dt class="text-muted-foreground">Delivery</dt>
						<dd>
							{task.worker.mode ?? 'Unknown'}{task.worker.yolo ? `, yolo ${task.worker.yolo}` : ''}
						</dd>
					</div>
				{/if}
			</dl>
		</div>
	</div>
{/snippet}

{#snippet passageSection({ task }: SectionProps)}
	<section class="mt-16" aria-labelledby="passage">
		<h2 id="passage" class="text-sm font-medium">Passage</h2>
		<div class="mt-4 max-w-4xl"><StageTrack {task} size="bar" /></div>
		<p class="mt-3 text-xs text-muted-foreground">Placed from: {task.passage.basis}.</p>

		<ol class="mt-10 max-w-3xl">
			{#each task.passage.steps as s, i (s.key)}
				{@const done = s.state === 'done'}
				{@const now = s.state === 'current'}
				{@const finished = now && task.status === 'landed'}
				<li class="relative flex gap-5 pb-10">
					{#if i < task.passage.steps.length - 1}
						<span
							class="absolute top-8 bottom-1 left-[13px] w-0.5 {done
								? 'bg-foreground/40'
								: 'bg-border'}"
						></span>
					{/if}
					<span
						class="relative z-10 grid size-7 shrink-0 place-items-center rounded-full text-xs font-medium {done
							? 'bg-foreground text-background'
							: now
								? t === 'trouble'
									? 'bg-danger text-white'
									: t === 'you'
										? 'bg-sea text-white dark:text-slate-950'
										: finished
											? 'bg-success text-white dark:text-slate-950'
											: 'bg-foreground text-background ring-4 ring-foreground/15'
								: s.state === 'skipped'
									? 'border border-dashed bg-background text-muted-foreground/60'
									: 'border bg-background text-muted-foreground'}"
					>
						{#if done || finished}<CheckIcon class="size-3.5" aria-hidden="true" />{:else}{i +
								1}{/if}
					</span>
					<div class="min-w-0 flex-1 pt-0.5">
						<p
							class="font-medium {s.state === 'upcoming' || s.state === 'skipped'
								? 'text-muted-foreground'
								: ''}"
						>
							{s.label}
							{#if s.state === 'skipped'}<span
									class="ml-2 text-sm font-normal text-muted-foreground">skipped</span
								>{/if}
							{#if now && !finished}
								<span
									class="ml-2 text-sm font-normal {t === 'normal' || t === 'landed'
										? 'text-muted-foreground'
										: textClass[t]}"
								>
									{t === 'trouble'
										? `${task.statusLabel.toLowerCase()} here`
										: t === 'you'
											? 'waiting on you'
											: t === 'firstmate'
												? 'waiting on Firstmate'
												: task.status === 'done'
													? 'finished, with Firstmate'
													: 'in progress'}
								</span>
							{/if}
						</p>
						{#if s.note}<p class="mt-1 text-xs text-muted-foreground">{s.note}</p>{/if}
						{#if done || now}
							<div class="mt-3 space-y-4">
								{#each s.evidence as id (id)}{@render blocks[id]?.(s)}{/each}
								{#each stepEntries(s.key) as e (e.key)}
									<div data-slot="step.evidence">
										<h4 class="mb-2 text-sm font-medium">{e.title}</h4>
										<SlotContent entry={e} now={live.now} />
									</div>
								{/each}
							</div>
						{/if}
					</div>
				</li>
			{/each}
		</ol>
	</section>
{/snippet}

{#snippet logSection({ detail }: SectionProps)}
	<details class="group rounded-xl border">
		<summary
			class="flex list-none items-center gap-2 px-4 py-3 text-sm [&::-webkit-details-marker]:hidden"
		>
			<ChevronRight
				class="size-4 text-muted-foreground transition-transform group-open:rotate-90"
				aria-hidden="true"
			/>
			<span class="font-medium">Ship’s log</span>
			<span class="text-muted-foreground"
				>what the crew reported, oldest first (history, not current state)</span
			>
		</summary>
		<div class="border-t p-4">
			{#if detail.timeline.available}
				<ol class="space-y-2 text-sm">
					{#each detail.timeline.value as e, i (i)}
						<li class="grid grid-cols-[5.5rem_minmax(0,1fr)] gap-3">
							<time class="tabular text-xs text-muted-foreground" datetime={e.at} title={e.at}
								>{clock(e.at)}</time
							>
							<p class="min-w-0 break-words">
								{#if e.state}<span class="mr-1 font-medium">{e.state}</span>{/if}{e.text}
							</p>
						</li>
					{/each}
				</ol>
				{@render source(detail.timeline)}
			{:else}
				{@render unavailable(detail.timeline)}
			{/if}
		</div>
	</details>
{/snippet}

{#snippet outputSection({ task }: SectionProps)}
	<OutputInspector {task} />
{/snippet}

{#snippet pluginSection(entry: SlotEntry)}
	<section class="rounded-xl border p-4" aria-label={entry.title} data-slot="task.section">
		<h2 class="mb-3 text-sm font-medium">{entry.title}</h2>
		<SlotContent {entry} now={live.now} />
	</section>
{/snippet}

{#snippet gapsSection({ detail }: SectionProps)}
	{#if detail.gaps.length}
		<div class="rounded-xl border border-dashed p-4 text-sm">
			<p class="font-medium">Not available yet</p>
			<ul class="mt-2 list-disc space-y-1 pl-5 text-muted-foreground">
				{#each detail.gaps as g (g)}<li>{g}</li>{/each}
			</ul>
		</div>
	{/if}
{/snippet}

<main class="mx-auto max-w-6xl px-4 pt-8 pb-24 sm:px-6">
	<a
		href={back}
		class="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
		><ArrowLeft class="size-4" aria-hidden="true" />Harbour</a
	>

	{#if !task || !ev || !detail}
		<p class="mt-10 text-muted-foreground">{data.problem ?? 'Loading…'}</p>
	{:else}
		{#each sections as s (s.id)}
			<div class={s.class}>
				{#if 'entry' in s}{@render pluginSection(s.entry)}{:else}{@render s.render({
						task,
						ev,
						detail
					})}{/if}
			</div>
		{/each}
	{/if}
</main>
