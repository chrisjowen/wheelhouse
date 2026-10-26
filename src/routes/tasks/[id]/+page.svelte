<script lang="ts">
	import { page } from '$app/state';
	import { replaceState } from '$app/navigation';
	import { currentFleet, live } from '$lib/client/live.svelte';
	import { slots } from '$lib/client/slots.svelte';
	import { slotKey } from '$lib/plugins/keys';
	import { placeTaskSections } from '$lib/plugins/placement';
	import type { SlotEntry } from '$lib/plugins/types';
	import SlotContent from '$lib/components/wh/plugins/SlotContent.svelte';
	import { agentLine, consoleInImage } from '$lib/card';
	import { ago, clock } from '$lib/format';
	import { plainStatus } from '$lib/plain';
	import { showsChecks } from '$lib/checks';
	import ChecksTimeline from '$lib/components/wh/ChecksTimeline.svelte';
	import { Button } from '$lib/components/ui/button';
	import BusyRing from '$lib/components/wh/BusyRing.svelte';
	import ConsoleWindow from '$lib/components/wh/ConsoleWindow.svelte';
	import DiffDialog from '$lib/components/wh/DiffDialog.svelte';
	import Lightbox from '$lib/components/wh/Lightbox.svelte';
	import LivePreview from '$lib/components/wh/LivePreview.svelte';
	import OutputInspector from '$lib/components/wh/OutputInspector.svelte';
	import PreviewStudio from '$lib/components/wh/PreviewStudio.svelte';
	import RawDetails from '$lib/components/wh/RawDetails.svelte';
	import ReviewPanel from '$lib/components/wh/ReviewPanel.svelte';
	import StageTrack from '$lib/components/wh/StageTrack.svelte';
	import ChecksReport from '$lib/components/wh/buildlog/ChecksReport.svelte';
	import ConversationPanel from '$lib/components/wh/buildlog/ConversationPanel.svelte';
	import DocsPanel from '$lib/components/wh/buildlog/DocsPanel.svelte';
	import TimeBar from '$lib/components/wh/insights/TimeBar.svelte';
	import TimeLegend from '$lib/components/wh/insights/TimeLegend.svelte';
	import { CONFIDENCE, duration, etaLine, PHASE_LABEL } from '$lib/insights';
	import { tone, textClass } from '$lib/components/wh/tone';
	import { awaitingReview } from '$lib/review';
	import {
		DEFAULT_TAB,
		hasDetail,
		openByDefault,
		pickTab,
		stepGist,
		taskTabs
	} from '$lib/taskpage';
	import { tick, type Snippet } from 'svelte';
	import type {
		Available,
		Check,
		PassageCheck,
		PassageStep,
		TaskDetail,
		TaskEvidence,
		TaskSummary,
		TimelineEntry
	} from '$lib/types';
	import {
		ArrowLeft,
		Check as CheckIcon,
		ChevronRight,
		CircleDashed,
		ExternalLink,
		FileText,
		ImageOff,
		LoaderCircle,
		MessageSquare,
		Minus,
		MonitorPlay,
		Scale,
		Timer,
		X
	} from '@lucide/svelte';

	let { data } = $props();

	let fetched = $state<TaskDetail | null>(null);
	const FILES_PREVIEW = 12;
	let showAllFiles = $state(false);
	/** The screenshot enlarged in the lightbox, and the file whose diff is open. */
	let shotIndex = $state<number | null>(null);
	let diffFile = $state<string | null>(null);
	let lastFetch = 0;
	const id = $derived(page.params.id!);
	const detail = $derived(fetched?.task.id === id ? fetched : data.detail);
	// Prefer the live summary from the fleet stream; evidence refreshes separately.
	const task = $derived(currentFleet()?.tasks.find((t) => t.id === id) ?? detail?.task ?? null);
	const ev = $derived(detail?.evidence ?? null);
	const project = $derived(currentFleet()?.projects.find((p) => p.id === task?.projectId));
	const shots = $derived(ev?.screenshots.available ? ev.screenshots.value : []);
	const shotAt = (url: string) => shots.findIndex((s) => s.url === url);

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
	const pluginEntries = $derived(slots.entries(slotKey.task(id), data.slots, data.slotsAt));
	const stepEntries = (key: string) =>
		pluginEntries.filter((e) => e.slot === 'step.evidence' && e.step === key);
	$effect(() => {
		void live.revision;
		slots.refresh(slotKey.task(id), data.slotsAt);
	});

	const t = $derived(task ? tone(task) : 'normal');
	const back = $derived(task ? `/?project=${encodeURIComponent(task.projectId)}` : '/');
	// Evidence blocks by id; each passage step lists the ids it shows (stages.ts).
	const blocks: Record<string, Snippet<[PassageStep, string]>> = {
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
	// `check:<id>` blocks show one of the passage's declared checks (a deploy, a release).
	const blockFor = (id: string): Snippet<[PassageStep, string]> | undefined =>
		blocks[id] ?? (id.startsWith('check:') ? checkBlock : undefined);
	const PASS = ['success', 'inactive', 'included', 'published', 'ok', 'yes', 'present'];
	const FAIL = ['failure', 'error', 'mismatch'];
	const checkTone = (c: PassageCheck): Check['state'] =>
		c.state === 'off' || c.state === 'gave-up'
			? 'skipped'
			: c.state !== 'observed'
				? 'unknown'
				: PASS.includes(c.outcome ?? '')
					? 'pass'
					: FAIL.includes(c.outcome ?? '')
						? 'fail'
						: c.outcome === 'in_progress'
							? 'running'
							: 'pending';

	const taskSections = $derived(
		placeTaskSections(pluginEntries, task ? task.passage.steps.map((s) => s.key) : [])
	);

	// The overview stays on the left, with the live terminal and the task's time under it;
	// everything else sits in tabs beside it, so the page no longer scrolls through it all. Plugin task.section entries each get a tab, by order
	// (or sit right after their passage step when they name one this passage has).
	const pluginTabs = $derived([...taskSections.byOrder].sort((a, b) => a.order - b.order));
	const hasTime = (task: TaskSummary, detail: TaskDetail) =>
		!!(task.eta && !task.eta.openEnded) ||
		!!(detail.time && detail.time.total > 0) ||
		detail.decided.length > 0;
	const tabs = $derived(
		task && detail
			? taskTabs({
					preview: !!task.preview,
					shots: shots.length,
					plugins: pluginTabs.map((e) => ({ key: e.key, title: e.title })),
					build: {
						// Only what is still waiting on an answer is counted.
						talk: detail.build.conversation.available
							? detail.build.conversation.value.filter((e) => e.outcome.state === 'open').length
							: 0,
						docs: detail.build.docs.available ? detail.build.docs.value.length : 0
					}
				})
			: []
	);
	// The chosen tab and full-screen preview are per task, and kept in the URL
	// (`?tab=`, `&full=1`) so a link or a reload opens the same view.
	let chosen = $state<{ id: string; tab: string; full: boolean } | null>(null);
	const want = $derived(
		chosen?.id === id ? chosen : { tab: page.url.searchParams.get('tab'), full: false }
	);
	const active = $derived(pickTab(want.tab, tabs));
	const full = $derived(
		!!task?.preview && (chosen?.id === id ? chosen.full : page.url.searchParams.get('full') === '1')
	);

	function show(tab: string, fullScreen = false) {
		chosen = { id, tab, full: fullScreen };
		const url = new URL(page.url);
		if (tab === DEFAULT_TAB) url.searchParams.delete('tab');
		else url.searchParams.set('tab', tab);
		if (fullScreen) url.searchParams.set('full', '1');
		else url.searchParams.delete('full');
		replaceState(url, {});
	}

	// When the overview sits above the tabs (narrow screens), its shortcuts would open a
	// tab out of sight, so bring the tabs into view.
	let tabsTop = $state<HTMLElement>();
	async function reveal(tab: string) {
		show(tab);
		if (matchMedia('(min-width: 64rem)').matches) return;
		await tick();
		const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
		tabsTop?.scrollIntoView({ block: 'start', behavior: reduce ? 'auto' : 'smooth' });
	}

	// On narrow screens the tab row scrolls; keep the selected tab in sight (sideways only).
	let tablist = $state<HTMLElement>();
	$effect(() => {
		const tab = document.getElementById(`tab-${active}`);
		if (!tablist || !tab) return;
		const box = tablist.getBoundingClientRect();
		const r = tab.getBoundingClientRect();
		if (r.left < box.left) tablist.scrollLeft -= box.left - r.left;
		else if (r.right > box.right) tablist.scrollLeft += r.right - box.right;
	});

	function onTabKey(e: KeyboardEvent, i: number) {
		const n = tabs.length;
		const to =
			e.key === 'ArrowRight'
				? (i + 1) % n
				: e.key === 'ArrowLeft'
					? (i - 1 + n) % n
					: e.key === 'Home'
						? 0
						: e.key === 'End'
							? n - 1
							: -1;
		if (to < 0) return;
		e.preventDefault();
		show(tabs[to].id);
		document.getElementById(`tab-${tabs[to].id}`)?.focus();
	}

	// The live terminal under the overview can be folded away; the time line jumps to the time.
	let terminalOpen = $state(true);
	let timeTop = $state<HTMLElement>();
	function revealTime() {
		const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
		timeTop?.scrollIntoView({ block: 'start', behavior: reduce ? 'auto' : 'smooth' });
	}

	// Stages fold to one line once finished; the current one is open. A stage the captain
	// opened or closed stays that way, per task, until the page is left.
	let toggled = $state<Record<string, boolean>>({});
	const isOpen = (s: PassageStep) => toggled[`${id} ${s.key}`] ?? openByDefault(s);
	const toggle = (s: PassageStep) => (toggled[`${id} ${s.key}`] = !isOpen(s));
	function setAll(open: boolean) {
		for (const s of task?.passage.steps ?? []) if (hasDetail(s)) toggled[`${id} ${s.key}`] = open;
	}

	// Ledger entries other than status lines, in plain words (PR links become their number).
	const entryText = (e: TimelineEntry) => {
		const n = /\/pull\/(\d+)/.exec(e.text)?.[1];
		if (e.kind === 'pr-ready') return `Pull request${n ? ` #${n}` : ''} ready`;
		if (e.kind === 'merged') return n ? `Merged pull request #${n}` : e.text;
		return e.text;
	};

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
					<li>
						<button
							type="button"
							class="flex w-full items-center gap-3 px-3 py-2 text-left text-xs hover:bg-accent/60"
							onclick={() => (diffFile = x.path)}
							aria-label="Show the changes to {x.path}"
						>
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
						</button>
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
					Showing the first {f.files.length} of {f.total} files.
				</p>{/if}
			<p class="mt-1 text-xs text-muted-foreground">Select a file to see its diff.</p>
		{:else}
			<p class="text-sm text-muted-foreground">No changes yet.</p>
		{/if}
		{@render source(ev.files)}
	{:else if ev}
		{@render unavailable(ev.files)}
	{/if}
{/snippet}

{#snippet checksLink()}
	<button
		type="button"
		class="mt-2 block text-sm text-sea hover:underline"
		onclick={() => {
			// Keyboard users land where the report is.
			reveal('checks').then(() =>
				document.getElementById('tab-checks')?.focus({ preventScroll: true })
			);
		}}>What each check found</button
	>
{/snippet}

{#snippet queueBlock()}
	{#if task}
		<p class="text-sm text-muted-foreground">
			{task.since ? `Filed ${task.since}.` : 'Queued by Firstmate.'}
			{#if task.blockedBy.length}Waiting on {task.blockedBy.join(', ')}.{/if}
		</p>
	{/if}
{/snippet}

{#snippet progressBlock()}
	<!-- What the worker is doing now is the overview's Now line, beside the stages; not repeated here. -->
{/snippet}

{#snippet validationBlock()}
	{#if task && showsChecks(task)}
		<ChecksTimeline
			pipeline={task.pipeline}
			busy={task.busy}
			prChecks={ev?.pr.available ? ev.pr.value.checks : []}
		/>
		{#if ev?.validation.available}
			<RawDetails
				raw={ev.validation.value.detail}
				plain={plainStatus(task.current?.state, ev.validation.value.detail)}
			/>
		{/if}
		<p class="mt-1.5 text-xs text-muted-foreground">
			From the validation run’s own report{task.pipeline.observedAt
				? `, ${ago(task.pipeline.observedAt, live.now)}`
				: ''}.
		</p>
		{@render checksLink()}
	{:else if ev?.validation.available}
		{@const plain = plainStatus(task?.current?.state, ev.validation.value.detail)}
		<p class="text-sm">{plain}</p>
		{#if task?.pipeline && task.current?.state === 'working'}
			<p class="mt-1 text-sm text-muted-foreground">
				{task.pipeline.label} step{task.pipeline.round
					? `, fix round ${task.pipeline.round}`
					: ''}{task.pipeline.startedAt
					? `, started ${ago(task.pipeline.startedAt, live.now)}`
					: ''}.
			</p>
		{/if}
		<RawDetails raw={ev.validation.value.detail} {plain} />
		{@render source(ev.validation)}
	{:else if detail?.build.checks.available}
		<!-- No run is current any more, but the latest one's report is still there. -->
		<ul class="space-y-1 text-sm">
			{#each detail.build.checks.value.steps.filter((x) => x.key !== 'intent') as c (c.key)}
				<li><span class="font-medium">{c.label}</span> · {c.summary}</li>
			{/each}
		</ul>
		{@render checksLink()}
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
		<div class="flex flex-wrap gap-3">
			{#each ev.screenshots.value as s (s.url)}
				<button
					type="button"
					class="w-48 shrink-0 cursor-zoom-in text-left"
					onclick={() => (shotIndex = shotAt(s.url))}
					aria-label="Enlarge {s.name}"
				>
					<img
						src={s.url}
						alt={s.name}
						loading="lazy"
						class="aspect-[16/10] w-full rounded-lg border object-cover object-top"
					/>
					<p class="mt-1.5 truncate text-xs text-muted-foreground">{s.name}</p>
				</button>
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
			{#each ev.decisions as d, i (i)}
				{@const plain = plainStatus('needs-decision', d.text)}
				<li>{plain}<RawDetails raw={d.text} {plain} /></li>
			{/each}
		</ul>
	{/if}
{/snippet}

{#snippet checkBlock(_s: PassageStep, block: string)}
	{@const c = task?.passage.checks.find((x) => `check:${x.id}` === block)}
	{#if c}
		<div class="flex items-start gap-3 rounded-lg border px-3 py-2 text-sm" data-check={c.id}>
			{@render checkIcon({ name: c.label, state: checkTone(c) })}
			<div class="min-w-0 flex-1">
				<p>
					<span class="font-medium">{c.label}</span>
					<span class="text-muted-foreground">{c.summary}</span>
				</p>
				<p class="mt-0.5 text-xs text-muted-foreground">
					{c.type === 'command' ? 'Command' : c.type}{c.observedAt
						? `, ${c.type === 'command' ? 'ran' : 'checked'} ${ago(c.observedAt, live.now)}`
						: ''}{c.state === 'gave-up' ? ', no longer checked' : ''}
					{#if c.url}
						·
						<a
							href={c.url}
							target="_blank"
							rel="noreferrer"
							class="inline-flex items-center gap-1 text-sea hover:underline"
							>Open<ExternalLink class="size-3" aria-hidden="true" /></a
						>
					{/if}
				</p>
				{#if c.command}
					<p class="mt-1 font-mono text-xs break-all text-muted-foreground">Runs {c.command}</p>
				{/if}
				{#if c.output}
					<details class="mt-1">
						<summary class="cursor-pointer text-xs text-sea">Output</summary>
						<pre
							class="mt-1 max-h-80 overflow-auto rounded-md bg-terminal px-3 py-2 font-mono text-xs text-terminal-foreground">{c.output}</pre>
					</details>
				{/if}
			</div>
		</div>
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

{#snippet overview(task: TaskSummary, ev: TaskEvidence, detail: TaskDetail)}
	{@const e = task.eta && !task.eta.openEnded ? task.eta : null}
	<p class="mt-5 text-sm text-muted-foreground">
		{project?.name ?? task.projectId}{agentLine(task.worker) ? ` · ${agentLine(task.worker)}` : ''}
	</p>
	<h1 class="mt-1 text-[1.9rem] leading-tight text-balance">{task.title}</h1>
	<p
		class="mt-2 text-sm font-medium {t === 'normal' || t === 'landed'
			? 'text-muted-foreground'
			: textClass[t]}"
	>
		{task.statusLabel}
	</p>
	{#if task.activity && !task.attention}
		<p class="mt-2 leading-relaxed" data-now={task.activity.source}>
			<span class="mr-1 text-muted-foreground">Now:</span>{task.activity
				.text}{#if task.activity.at}<span class="text-muted-foreground"
					>{` · ${task.activity.source === 'pipeline' ? 'started ' : ''}${ago(task.activity.at, live.now)}`}</span
				>{/if}
		</p>
		<RawDetails raw={task.summaryRaw} />
	{:else if task.summary && !task.attention}
		<p class="mt-2 leading-relaxed">
			{#if task.summaryIsHistory}<span class="mr-1 text-muted-foreground">Latest update:</span
				>{/if}{task.summary}
		</p>
		<RawDetails raw={task.summaryRaw} />
	{/if}

	{#if task.attention}
		<div
			class="mt-5 rounded-xl p-4 {task.attention.owner === 'captain'
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
			{#if task.attention.owner === 'firstmate'}<RawDetails raw={task.summaryRaw} />{/if}
			{#if detail.evidence.decisions.length > 1}
				<ul class="mt-2 list-disc space-y-1 pl-5 text-sm">
					{#each detail.evidence.decisions.slice(1) as d, i (i)}
						{@const plain = plainStatus('needs-decision', d.text)}
						<li>{plain}<RawDetails raw={d.text} {plain} /></li>
					{/each}
				</ul>
			{/if}
			{#if task.attention.kind === 'decision'}
				<p class="mt-2 text-xs text-muted-foreground">
					Answer through Firstmate: it passes your word to the crew.
				</p>
			{/if}
		</div>
	{/if}

	{#if awaitingReview(task)}
		<!-- The review evidence comes first while the work waits on the captain. -->
		<div class="mt-5"><ReviewPanel {task} {shots} /></div>
	{/if}

	<div class="mt-6">
		<StageTrack {task} />
	</div>
	{#if e}
		{@const l = etaLine(e)}
		<button
			type="button"
			class="mt-4 flex items-center gap-2 text-left text-sm hover:underline {l.tone === 'warning'
				? 'text-warning'
				: 'text-muted-foreground'}"
			onclick={revealTime}><Timer class="size-4 shrink-0" aria-hidden="true" />{l.text}</button
		>
	{/if}

	<div class="mt-6 flex flex-wrap gap-2">
		{#if task.preview}
			<Button
				variant={task.attention?.owner === 'captain' && !task.pr ? 'default' : 'outline'}
				onclick={() => reveal('preview')}><MonitorPlay />Live preview</Button
			>
		{/if}
		{#if task.passage.link && task.passage.link.url !== task.preview?.url && !awaitingReview(task)}
			<!-- The current step's declared link, e.g. the live site once Deployed. -->
			<Button variant="outline" href={task.passage.link.url} target="_blank" rel="noreferrer"
				>{task.passage.link.label}<ExternalLink /></Button
			>
		{/if}
		<!-- Opens the chat with this task already mentioned in the message box. -->
		<Button
			variant={task.attention?.owner === 'captain' && task.attention.kind === 'decision'
				? 'default'
				: 'outline'}
			href="/?chat={encodeURIComponent(task.id)}"><MessageSquare />Ask Firstmate about this</Button
		>
	</div>

	<dl class="mt-6 grid grid-cols-2 gap-x-6 gap-y-3 border-t pt-5 text-sm">
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
						class="inline-flex items-center gap-1 text-sea hover:underline"
						>Reported {ago(task.preview.reportedAt, live.now)}<ExternalLink
							class="size-3"
							aria-hidden="true"
						/></a
					>
				{:else}<span class="text-muted-foreground">None reported</span>{/if}
			</dd>
		</div>
		<div>
			<dt class="text-muted-foreground">Last checked</dt>
			<dd class={task.current && !task.current.fresh ? 'text-warning' : ''}>
				{#if task.current?.observedAt}{ago(task.current.observedAt, live.now)}{task.current.fresh
						? ''
						: ' (cached)'}
				{:else}{ago(currentFleet()?.collectedAt, live.now)}{/if}
			</dd>
		</div>
		{#if task.worker}
			<div>
				<dt class="text-muted-foreground">Delivery</dt>
				<dd>
					{task.worker.mode ?? 'Unknown'}{task.worker.yolo ? `, yolo ${task.worker.yolo}` : ''}
				</dd>
			</div>
		{/if}
	</dl>
{/snippet}

{#snippet stagesPanel(task: TaskSummary)}
	{@const steps = task.passage.steps}
	{@const any = steps.filter(hasDetail)}
	<section aria-labelledby="passage">
		<div class="flex items-baseline justify-between gap-4">
			<h2 id="passage" class="sr-only">Passage</h2>
			<p class="text-xs text-muted-foreground">Placed from: {task.passage.basis}.</p>
			{#if any.length > 1}
				{@const allOpen = any.every(isOpen)}
				<button
					type="button"
					class="shrink-0 text-xs text-muted-foreground hover:text-foreground hover:underline"
					onclick={() => setAll(!allOpen)}>{allOpen ? 'Fold all' : 'Open all'}</button
				>
			{/if}
		</div>

		<ol class="mt-5">
			{#each steps as s, i (s.key)}
				{@const done = s.state === 'done'}
				{@const now = s.state === 'current'}
				{@const finished = now && task.status === 'landed' && !s.failed}
				{@const open = hasDetail(s) && isOpen(s)}
				{@const gist = open ? null : stepGist(s, task, ev)}
				<li
					class="relative flex gap-4 {open ? 'pb-8' : 'pb-5'}"
					data-stage={s.key}
					data-open={open}
				>
					{#if i < steps.length - 1}
						<span
							class="absolute top-7 bottom-0 left-[11px] {done
								? 'w-0.5 bg-foreground/40'
								: 'w-0 border-l border-dotted border-input'}"
						></span>
					{/if}
					<span
						class="relative z-10 mt-0.5 grid size-6 shrink-0 place-items-center rounded-full text-xs font-medium {done
							? 'bg-foreground text-background'
							: now
								? t === 'trouble' || s.failed
									? 'bg-danger text-white'
									: t === 'you'
										? 'bg-sea text-white dark:text-slate-950'
										: finished
											? 'bg-success text-white dark:text-slate-950'
											: 'bg-foreground text-background ring-4 ring-foreground/15'
								: s.state === 'skipped'
									? 'border border-dashed bg-background text-muted-foreground'
									: 'border bg-background text-muted-foreground'}"
					>
						{#if now && !finished && task.busy}<BusyRing class="bg-foreground" />{/if}
						{#if done || finished}<CheckIcon
								class="size-3.5"
								aria-hidden="true"
							/>{:else if s.failed}<X class="size-3.5" aria-hidden="true" />{:else}{i + 1}{/if}
					</span>
					<div class="min-w-0 flex-1">
						<!-- A stage not reached yet, with nothing to show, has no detail to open. -->
						<button
							type="button"
							class="group flex w-full min-w-0 items-baseline gap-2 rounded-md text-left disabled:cursor-default"
							disabled={!hasDetail(s)}
							aria-expanded={hasDetail(s) ? open : undefined}
							aria-controls={hasDetail(s) ? `stage-${s.key}` : undefined}
							onclick={() => toggle(s)}
						>
							<span
								class="shrink-0 font-display text-[1.12rem] font-medium group-enabled:group-hover:underline {s.state ===
									'upcoming' || s.state === 'skipped'
									? 'text-muted-foreground italic'
									: ''}">{s.label}</span
							>
							{#if s.state === 'skipped'}<span class="shrink-0 text-sm text-muted-foreground"
									>skipped</span
								>{/if}
							{#if now && s.failed}
								<span class="shrink-0 text-sm text-danger">failed</span>
							{:else if now && !finished}
								<span
									class="shrink-0 text-sm {t === 'normal' || t === 'landed'
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
							{#if gist}<span class="min-w-0 truncate text-sm text-muted-foreground" title={gist}
									>· {gist}</span
								>{/if}
							{#if hasDetail(s)}<ChevronRight
									class="ml-auto size-4 shrink-0 self-center text-muted-foreground transition-transform {open
										? 'rotate-90'
										: ''}"
									aria-hidden="true"
								/>{/if}
						</button>
						{#if open}
							<div id="stage-{s.key}">
								{#if s.note}<p class="mt-1 text-xs text-muted-foreground">{s.note}</p>{/if}
								{#if done || now}
									<div class="mt-3 space-y-4">
										{#each s.evidence as id (id)}{@render blockFor(id)?.(s, id)}{/each}
										{#each stepEntries(s.key) as e (e.key)}
											<div data-slot="step.evidence">
												<h4 class="mb-2 text-sm font-medium">{e.title}</h4>
												<SlotContent entry={e} now={live.now} />
											</div>
										{/each}
									</div>
								{/if}
							</div>
						{/if}
						{#each taskSections.afterStep[s.key] ?? [] as e (e.key)}
							<div class="mt-4">{@render pluginSection(e)}</div>
						{/each}
					</div>
				</li>
			{/each}
		</ol>
	</section>
{/snippet}

{#snippet previewPanel(task: TaskSummary)}
	<!-- The worker's reported preview, embedded, with feedback that goes to the worker. -->
	{#if task.preview}
		<section aria-labelledby="live-preview">
			<h2 id="live-preview" class="sr-only">Live preview</h2>
			{#if active === 'preview' && !full}
				<LivePreview
					taskId={task.id}
					feedback={task.status !== 'landed'}
					onfullscreen={() => show('preview', true)}
				/>
			{/if}
		</section>
	{/if}
{/snippet}

{#snippet screenshotsPanel()}
	{#if shots.length}
		<div class="flex flex-wrap gap-4">
			{#each shots as s, i (s.url)}
				<button
					type="button"
					class="w-48 shrink-0 cursor-zoom-in text-left"
					onclick={() => (shotIndex = i)}
					aria-label="Enlarge {s.name}"
				>
					<img
						src={s.url}
						alt={s.name}
						loading="lazy"
						class="aspect-[16/10] w-full rounded-lg border object-cover object-top"
					/>
					<p class="mt-1.5 truncate text-xs text-muted-foreground">
						{s.name}{s.modifiedAt ? ` · ${ago(s.modifiedAt, live.now)}` : ''}
					</p>
				</button>
			{/each}
		</div>
		{#if ev}{@render source(ev.screenshots)}{/if}
	{:else}
		<div
			class="grid min-h-60 place-items-center rounded-xl border border-dashed bg-muted/30 p-6 text-center text-muted-foreground"
		>
			<div>
				<ImageOff class="mx-auto size-6" aria-hidden="true" />
				<p class="mt-2 text-sm font-medium">No screenshots saved</p>
				<p class="mt-1 text-xs">
					{ev && !ev.screenshots.available
						? ev.screenshots.reason
						: 'The worker has not saved any screenshots for this task.'}
				</p>
			</div>
		</div>
	{/if}
{/snippet}

{#snippet timePanel(task: TaskSummary, detail: TaskDetail)}
	{@const e = task.eta ?? null}
	{@const t = detail.time}
	<section class="space-y-6" aria-label="Work time">
		{#if e && !e.openEnded}
			{@const l = etaLine(e)}
			<div class="rounded-xl border bg-card p-5">
				<div class="flex flex-wrap items-start justify-between gap-3">
					<div>
						<p class="flex items-center gap-2 text-sm text-muted-foreground">
							<Timer class="size-4" aria-hidden="true" />Until it is ready for your review
						</p>
						<p
							class="mt-1 text-2xl font-semibold tracking-tight {l.tone === 'warning'
								? 'text-warning'
								: ''}"
						>
							{l.text}
						</p>
						{#if e.minutes !== null && !e.overdue}
							<p class="mt-0.5 text-sm text-muted-foreground">
								Usually {e.low}–{e.high} min, so around {clock(
									new Date(live.now + e.minutes * 60_000).toISOString()
								)}
							</p>
						{:else if e.overdue}
							<p class="mt-0.5 text-sm text-muted-foreground">
								Similar work had reached your review by this point.
							</p>
						{/if}
					</div>
					{#if e.confidence !== 'none' && !e.overdue}
						<span class="rounded-full bg-muted px-2.5 py-1 text-xs font-medium"
							>{CONFIDENCE[e.confidence]}</span
						>
					{/if}
				</div>
				{#if e.ahead.length}
					<ol class="mt-5 space-y-2 border-t pt-4">
						{#each e.ahead as x (x.phase)}
							<li class="flex items-baseline justify-between gap-4 text-sm">
								<span class={x.current ? 'font-medium' : 'text-muted-foreground'}
									>{PHASE_LABEL[x.phase]}{#if x.current}<span
											class="font-normal text-muted-foreground"
											>{` · now, ${duration(x.spent)} in`}</span
										>{/if}</span
								>
								<span class="text-muted-foreground tabular-nums"
									>{x.usual !== null ? `usually ${duration(x.usual)}` : 'no history yet'}</span
								>
							</li>
						{/each}
					</ol>
				{/if}
				<p class="mt-4 text-xs text-muted-foreground">
					Based on {e.basis} similar {e.scope === 'project'
						? 'tasks in this project'
						: 'tasks across projects'}. A guide, not a promise: it counts work time only, not time
					waiting on you.
				</p>
			</div>
		{/if}

		{#if t && t.total > 0}
			<div>
				<div class="flex flex-wrap items-baseline justify-between gap-2">
					<h2 class="section-label flex-1">Where its time went</h2>
					<p class="text-sm text-muted-foreground">
						{duration(t.total)}{t.ongoing ? ' so far' : ''}{t.readyAfter !== null
							? ` · ready for you after ${duration(t.readyAfter)}`
							: ''}
					</p>
				</div>
				<div class="mt-3"><TimeBar seconds={t.seconds} height="h-3" label="This task" /></div>
				<div class="mt-3"><TimeLegend seconds={t.seconds} /></div>
				{#if t.reviewSteps.length}
					<details class="mt-4 rounded-lg border px-4 py-3 text-sm">
						<summary class="cursor-pointer text-muted-foreground hover:text-foreground"
							>Inside the latest automated review</summary
						>
						<ul class="mt-3 space-y-1.5">
							{#each t.reviewSteps as r (r.step)}
								<li class="flex justify-between gap-4">
									<span>{r.label}</span><span class="text-muted-foreground tabular-nums"
										>{duration(r.seconds)}</span
									>
								</li>
							{/each}
						</ul>
					</details>
				{/if}
			</div>
		{/if}

		{#if detail.decided.length}
			<div>
				<h2 class="section-label">Decided for you on this task</h2>
				<ul class="mt-3 divide-y rounded-lg border">
					{#each detail.decided as d (d.id)}
						<li>
							<a href="/decisions#{d.id}" class="flex gap-3 px-4 py-3 hover:bg-accent/40">
								<Scale class="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
								<span class="min-w-0 text-sm">
									<span class="font-medium">{d.verdict}</span>
									<span class="text-muted-foreground"> · {d.calls[0].question}</span>
								</span>
							</a>
						</li>
					{/each}
				</ul>
			</div>
		{/if}
	</section>
{/snippet}

{#snippet logPanel(task: TaskSummary, detail: TaskDetail)}
	<section class="max-w-3xl space-y-4" aria-labelledby="ships-log">
		<div class="rounded-xl border">
			<div class="flex flex-wrap items-baseline gap-x-2 px-4 py-3 text-sm">
				<h2
					id="ships-log"
					class="font-display text-[1.2rem] font-medium tracking-[0.1em] text-muted-foreground [font-variant-caps:all-small-caps]"
				>
					Ship’s log
				</h2>
				<span class="text-muted-foreground"
					>what the crew reported, oldest first (history, not current state)</span
				>
			</div>
			<div class="border-t p-4">
				{#if detail.timeline.available}
					<ol class="space-y-2 text-sm">
						{#each detail.timeline.value as e, i (i)}
							{@const plain = e.kind === 'status' ? plainStatus(e.state, e.text) : null}
							<li class="grid grid-cols-[5.5rem_minmax(0,1fr)] gap-3">
								<time class="tabular text-xs text-muted-foreground" datetime={e.at} title={e.at}
									>{clock(e.at)}</time
								>
								<div class="min-w-0 break-words">
									{#if plain}
										<p>{plain}</p>
										<RawDetails raw={e.state ? `${e.state}: ${e.text.trim()}` : e.text} {plain} />
									{:else}
										<p>{entryText(e)}</p>
									{/if}
								</div>
							</li>
						{/each}
					</ol>
					{@render source(detail.timeline)}
				{:else}
					{@render unavailable(detail.timeline)}
				{/if}
			</div>
		</div>
		<OutputInspector {task} live={active === 'log'} />
		{#if detail.gaps.length}
			<div class="rounded-xl border border-dashed p-4 text-sm">
				<p class="font-medium">Not available yet</p>
				<ul class="mt-2 list-disc space-y-1 pl-5 text-muted-foreground">
					{#each detail.gaps as g (g)}<li>{g}</li>{/each}
				</ul>
			</div>
		{/if}
	</section>
{/snippet}

{#snippet pluginSection(entry: SlotEntry)}
	<section class="rounded-xl border p-4" aria-label={entry.title} data-slot="task.section">
		<h2 class="mb-3 text-sm font-medium">{entry.title}</h2>
		<SlotContent {entry} now={live.now} />
	</section>
{/snippet}

<main class="px-4 pt-4 pb-20 sm:px-6 lg:px-10">
	{#if !task || !ev || !detail}
		<a
			href={back}
			class="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
			><ArrowLeft class="size-4" aria-hidden="true" />Harbour</a
		>
		<p class="surface mt-6 max-w-3xl p-6 text-muted-foreground">{data.problem ?? 'Loading…'}</p>
	{:else}
		<div
			class="grid gap-8 lg:grid-cols-[minmax(19rem,25rem)_minmax(0,1fr)] xl:grid-cols-[26rem_minmax(0,1fr)] xl:gap-12"
		>
			<!-- The overview stays put while the tabs beside it change. -->
			<aside
				class="no-scrollbar min-w-0 self-start rounded-lg border bg-panel px-6 pt-1 pb-6 lg:sticky lg:top-6 lg:max-h-[calc(100dvh-3rem)] lg:overflow-y-auto lg:pb-6"
				aria-label="Overview"
			>
				<a
					href={back}
					class="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
					><ArrowLeft class="size-4" aria-hidden="true" />Harbour</a
				>
				{@render overview(task, ev, detail)}
				{#if consoleInImage(task)}
					<!-- What the worker's terminal shows right now, sampled while on screen. -->
					<section class="mt-6 border-t pt-5" aria-labelledby="live-terminal" data-terminal>
						<h2 id="live-terminal" class="text-sm font-medium">
							<button
								type="button"
								class="group flex w-full items-center gap-2 text-left"
								aria-expanded={terminalOpen}
								aria-controls="live-terminal-body"
								onclick={() => (terminalOpen = !terminalOpen)}
							>
								<span class="group-hover:underline">Live terminal</span>
								<ChevronRight
									class="ml-auto size-4 shrink-0 text-muted-foreground transition-transform {terminalOpen
										? 'rotate-90'
										: ''}"
									aria-hidden="true"
								/>
							</button>
						</h2>
						{#if terminalOpen}
							<div id="live-terminal-body" class="mt-3">
								<ConsoleWindow {task} lines={12} class="rounded-xl" />
							</div>
						{/if}
					</section>
				{/if}
				{#if hasTime(task, detail)}
					<div class="mt-6 scroll-mt-20 border-t pt-5" bind:this={timeTop} data-time>
						{@render timePanel(task, detail)}
					</div>
				{/if}
			</aside>

			<!-- The tabs and every panel sit on one solid sheet, never on the graph paper. -->
			<div class="surface min-w-0 scroll-mt-14 px-5 md:scroll-mt-0 pb-8 sm:px-6" bind:this={tabsTop}>
				<div class="sticky top-14 z-20 -mx-5 md:top-0 rounded-t-lg bg-card px-5 pt-1 sm:-mx-6 sm:px-6">
					<div
						class="no-scrollbar flex items-center gap-1 overflow-x-auto border-b"
						role="tablist"
						aria-label="Task detail"
						bind:this={tablist}
					>
						{#each tabs as tab, i (tab.id)}
							<button
								type="button"
								role="tab"
								id="tab-{tab.id}"
								aria-selected={active === tab.id}
								aria-controls="panel-{tab.id}"
								tabindex={active === tab.id ? 0 : -1}
								class="-mb-px inline-flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2.5 text-base font-semibold tracking-[0.1em] whitespace-nowrap transition-colors [font-variant-caps:all-small-caps] {active ===
								tab.id
									? 'border-brass text-foreground'
									: 'border-transparent text-muted-foreground hover:text-foreground'}"
								onclick={() => show(tab.id)}
								onkeydown={(e) => onTabKey(e, i)}
							>
								{tab.label}{#if tab.count}<span
										class="rounded-full bg-muted px-1.5 text-xs text-muted-foreground tabular-nums"
										>{tab.count}</span
									>{/if}
							</button>
						{/each}
					</div>
				</div>

				<!-- Every panel is in the page (so a link or search finds it); only the chosen one shows. -->
				{#each tabs as tab (tab.id)}
					<div
						id="panel-{tab.id}"
						role="tabpanel"
						aria-labelledby="tab-{tab.id}"
						tabindex="0"
						class="pt-6 outline-none"
						hidden={active !== tab.id}
					>
						{#if tab.id === 'stages'}{@render stagesPanel(task)}
						{:else if tab.id === 'preview'}{@render previewPanel(task)}
						{:else if tab.id === 'screenshots'}{@render screenshotsPanel()}
						{:else if tab.id === 'log'}{@render logPanel(task, detail)}
						{:else if tab.id === 'talk'}<ConversationPanel
								talk={detail.build.conversation}
								now={live.now}
							/>
						{:else if tab.id === 'checks'}<ChecksReport
								checks={detail.build.checks}
								taskId={task.id}
							/>
						{:else if tab.id === 'docs'}<DocsPanel docs={detail.build.docs} taskId={task.id} />
						{:else}
							{@const entry = pluginTabs.find((e) => `plugin:${e.key}` === tab.id)}
							{#if entry}{@render pluginSection(entry)}{/if}
						{/if}
					</div>
				{/each}
			</div>
		</div>
		{#if full && task.preview}
			<PreviewStudio
				taskId={task.id}
				title={task.title}
				url={task.preview.url}
				feedback={task.status !== 'landed'}
				onclose={() => show('preview')}
			/>
		{/if}
		<Lightbox {shots} bind:index={shotIndex} />
		<DiffDialog taskId={task.id} bind:file={diffFile} />
	{/if}
</main>
