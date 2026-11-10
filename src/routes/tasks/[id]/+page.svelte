<script lang="ts">
	import { page } from '$app/state';
	import { consoleInImage } from '$lib/card';
	import ResizableRail from '$lib/components/wh/ResizableRail.svelte';
	import { replaceState } from '$app/navigation';
	import { currentFleet, live } from '$lib/client/live.svelte';
	import { slots } from '$lib/client/slots.svelte';
	import { slotKey } from '$lib/plugins/keys';
	import { placeTaskSections } from '$lib/plugins/placement';
	import type { SlotEntry } from '$lib/plugins/types';
	import SlotContent from '$lib/components/wh/plugins/SlotContent.svelte';
	import { ago, clock } from '$lib/format';
	import { plainStatus } from '$lib/plain';
	import { ciChecksLine } from '$lib/checks';
	import ConsoleWindow from '$lib/components/wh/ConsoleWindow.svelte';
	import DiffDialog from '$lib/components/wh/DiffDialog.svelte';
	import Lightbox from '$lib/components/wh/Lightbox.svelte';
	import LivePreview from '$lib/components/wh/LivePreview.svelte';
	import PreviewStudio from '$lib/components/wh/PreviewStudio.svelte';
	import PreviewActions from '$lib/components/wh/plugins/PreviewActions.svelte';
	import PreviewHelper from '$lib/components/wh/PreviewHelper.svelte';
	import type { Pointer } from '$lib/previewhelper';
	import type { Box } from '$lib/motion';
	import RawDetails from '$lib/components/wh/RawDetails.svelte';
	import { docHref } from '$lib/docpath';
	import { harbourHref } from '$lib/nav';
	import ChecksSection from '$lib/components/wh/timeline/ChecksSection.svelte';
	import TaskTimeline from '$lib/components/wh/timeline/TaskTimeline.svelte';
	import type { Strand } from '$lib/tasktimeline';
	import DocsPanel from '$lib/components/wh/buildlog/DocsPanel.svelte';
	import TimeBar from '$lib/components/wh/insights/TimeBar.svelte';
	import TimeLegend from '$lib/components/wh/insights/TimeLegend.svelte';
	import { CONFIDENCE, duration, etaLine, PHASE_LABEL } from '$lib/insights';
	import { pullRequests } from '$lib/client/pullrequests';
	import TaskOverview from '$lib/components/wh/TaskOverview.svelte';
	import { previewChecks } from '$lib/client/previewchecks.svelte';
	import { DEFAULT_TAB, MERGED_TABS, pickTab, prState, taskTabs } from '$lib/taskpage';
	import { followPage, type Follower } from '$lib/follow';
	import { onDestroy, tick, type Snippet } from 'svelte';
	import type {
		Available,
		Check,
		PassageCheck,
		PassageStep,
		TaskDetail,
		TaskSummary
	} from '$lib/types';
	import {
		ArrowDown,
		ArrowLeft,
		Bot,
		Check as CheckIcon,
		CircleDashed,
		Compass,
		ExternalLink,
		FileText,
		ImageOff,
		LayoutDashboard,
		LoaderCircle,
		Minus,
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
	// The preview helper's Point, shared with the page beside it.
	let pointing = $state(false);
	let pointed = $state<{ pointer: Pointer; at: { x: number; y: number } } | null>(null);
	let lastFetch = 0;
	const id = $derived(page.params.id!);
	const detail = $derived(fetched?.task.id === id ? fetched : data.detail);
	// Prefer the live summary from the fleet stream; evidence refreshes separately.
	const task = $derived(currentFleet()?.tasks.find((t) => t.id === id) ?? detail?.task ?? null);
	// The project's plugin review tab while one is on, else the PR on GitHub.
	const prLink = $derived(task?.pr ? pullRequests.review(task.projectId, task.pr) : null);
	const ev = $derived(detail?.evidence ?? null);
	const shots = $derived(ev?.screenshots.available ? ev.screenshots.value : []);
	const shotAt = (url: string) => shots.findIndex((s) => s.url === url);

	// The preview's latest check: its address here (a remote one's forward) for plugins' buttons on it.
	const previewCheck = $derived(task?.preview ? (previewChecks.checks[task.id] ?? null) : null);
	// Whether the reported preview answers, so the overview never links to one that has stopped.
	$effect(() => {
		if (task?.preview) return previewChecks.watch(task.id);
	});

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

	const back = $derived(harbourHref(task?.projectId));
	// The Checks section shows while a stage holding it has been reached.
	const checksShown = $derived(
		!!task?.passage.steps.some(
			(s) => s.evidence.includes('validation') && (s.state === 'done' || s.state === 'current')
		)
	);
	// Evidence blocks by id; each passage step lists the ids it shows (stages.ts), and the
	// timeline ends each stage with them. What the worker did as it went (its progress, its
	// screenshots and previews) is already in the timeline, so it has no block of its own.
	const blocks: Record<string, Snippet<[PassageStep, string]>> = {
		queue: queueBlock,
		files: filesSummary,
		validation: validationBlock,
		pr: prBlock,
		report: reportBlock,
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

	// The overview stays on the left, with the task's time under it; everything else sits in
	// tabs across the rest of the page. Plugin task.section entries each get a tab, by order
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
					files: detail.evidence.files.available ? detail.evidence.files.value.total : 0,
					docs: detail.build.docs.available ? detail.build.docs.value.length : 0,
					plugins: pluginTabs.map((e) => ({ key: e.key, title: e.title }))
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
	// A link to a tab now part of the Timeline: the conversation's opens it showing only the
	// conversation, the checks' at the Checks section.
	const merged = $derived(MERGED_TABS[page.url.searchParams.get('tab') ?? ''] ?? null);
	let strands = $state<Record<string, Strand | 'all'>>({});
	let timeline = $state<ReturnType<typeof TaskTimeline>>();
	const strand = $derived(strands[id] ?? merged?.strand ?? 'all');
	// Once per task, when the page opens on it.
	let landedOn = '';
	$effect(() => {
		if (merged?.anchor !== 'checks' || !detail || landedOn === id) return;
		landedOn = id;
		tick().then(() => timeline?.reveal('checks'));
	});
	// The Timeline opens at its latest entry and follows new ones while the captain is at the
	// bottom; scrolled up, it stays put and offers Jump to latest. Once per task, when the
	// Timeline first shows, unless the link asked for a place in it (the Checks, an anchor).
	let feed = $state<HTMLElement>();
	let unseen = $state(false);
	let following: { follow: Follower; stop: () => void } | null = null;
	let followedId = '';
	$effect(() => {
		if (!feed || active !== DEFAULT_TAB || followedId === id) return;
		const asked = followedId === '' && (!!merged?.anchor || !!location.hash);
		followedId = id;
		following?.stop();
		following = null;
		unseen = false;
		if (!asked) following = followPage(feed, (v) => (unseen = v));
	});
	onDestroy(() => following?.stop());
	const full = $derived(
		!!task?.preview && (chosen?.id === id ? chosen.full : page.url.searchParams.get('full') === '1')
	);

	// The full-screen preview grows out of what opened it: the overview's button or the embedded page.
	let studioFrom = $state<Box | null>(null);
	let embedded = $state<HTMLElement>();
	function openPreview(from: HTMLElement | undefined) {
		studioFrom = from?.getBoundingClientRect() ?? null;
		show(active, true);
	}

	function show(tab: string, fullScreen = false) {
		chosen = { id, tab, full: fullScreen };
		const url = new URL(page.url);
		if (tab === DEFAULT_TAB) url.searchParams.delete('tab');
		else url.searchParams.set('tab', tab);
		if (fullScreen) url.searchParams.set('full', '1');
		else url.searchParams.delete('full');
		replaceState(url, {});
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

	// The time left in the overview jumps to the task's time under it.
	let timeTop = $state<HTMLElement>();
	function revealTime() {
		const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
		timeTop?.scrollIntoView({ block: 'start', behavior: reduce ? 'auto' : 'smooth' });
	}

	/** Bring the Checks or the live console into view, on the Timeline tab. */
	async function jump(what: 'checks' | 'now') {
		if (active !== DEFAULT_TAB) show(DEFAULT_TAB);
		await tick();
		timeline?.reveal(what);
	}
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

{#snippet filesSummary()}
	<!-- The files changed, in a line; the Changes tab lists them with their diffs. -->
	{#if ev?.files.available}
		{@const f = ev.files.value}
		{@const add = f.files.reduce((n, x) => n + (x.additions ?? 0), 0)}
		{@const del = f.files.reduce((n, x) => n + (x.deletions ?? 0), 0)}
		<button
			type="button"
			class="flex w-full items-center gap-3 rounded-xl border bg-card px-4 py-3 text-left text-sm hover:bg-accent/40"
			onclick={() => show('changes')}
			data-files-summary
		>
			<FileText class="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
			<span class="font-medium"
				>{f.total
					? `${f.total} ${f.total === 1 ? 'file' : 'files'} changed`
					: 'No changes yet'}</span
			>
			{#if f.total}<span class="tabular"
					><span class="text-success">+{add}</span> <span class="text-danger">−{del}</span></span
				>{/if}
			<span class="ml-auto text-muted-foreground">against {f.base} · see the changes</span>
		</button>
	{:else if ev}
		{@render unavailable(ev.files)}
	{/if}
{/snippet}

{#snippet stageEvidence(s: PassageStep)}
	{#each s.evidence as e (e)}{@render blockFor(e)?.(s, e)}{/each}
	{#each stepEntries(s.key) as e (e.key)}
		<div data-slot="step.evidence">
			<h4 class="mb-2 text-sm font-medium">{e.title}</h4>
			<SlotContent entry={e} now={live.now} />
		</div>
	{/each}
	{#each taskSections.afterStep[s.key] ?? [] as e (e.key)}
		{@render pluginSection(e)}
	{/each}
{/snippet}

{#snippet nowBlock()}
	<!-- What the worker's terminal shows right now: the one place the page shows its console. -->
	{#if task}
		<div id="now" class="flex scroll-mt-28 items-start gap-3" data-terminal>
			<span
				class="relative grid size-8 shrink-0 place-items-center rounded-full border bg-muted text-muted-foreground"
				aria-hidden="true"
				><Bot class="size-4" /><span
					class="absolute -right-0.5 -bottom-0.5 size-2.5 rounded-full ring-2 ring-card {task.busy
						? 'bg-success motion-safe:animate-pulse'
						: 'bg-muted-foreground'}"
				></span></span
			>
			<div class="min-w-0 flex-1">
				<h3
					id="live-terminal"
					class="mb-1 flex flex-wrap items-baseline gap-x-2 text-xs text-muted-foreground"
				>
					<span class="text-sm font-semibold text-foreground">The worker</span>
					{task.busy ? 'working now' : 'its terminal now'} · live console
				</h3>
				<ConsoleWindow {task} lines={14} class="max-w-[100ch] rounded-xl" />
			</div>
		</div>
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

{#snippet validationBlock()}
	{#if task && detail}
		<div id="task-checks" class="scroll-mt-28">
			<ChecksSection
				{task}
				checks={detail.build.checks}
				prChecks={ev?.pr.available ? ev.pr.value.checks : []}
				validations={detail.validations}
				validation={ev?.validation ?? null}
			/>
		</div>
	{/if}
{/snippet}

{#snippet reviewTab()}
	<!-- Only a plugin's review tab: the pull request on GitHub is linked just above. -->
	{#if prLink && !prLink.external}
		<a
			href={prLink.href}
			class="mt-2 inline-flex items-center gap-1.5 text-sm text-sea hover:underline"
			data-review-pr><Compass class="size-3.5" aria-hidden="true" />Review the pull request</a
		>
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
		{#if pr.checks.length && !checksShown}
			<!-- No Checks stage to show them (direct-PR work): its CI checks are listed here. -->
			<ul class="mt-3 divide-y rounded-lg border">
				{#each pr.checks as c, i (c.name + i)}
					<li class="flex items-center gap-3 px-3 py-2 text-sm">
						{@render checkIcon(c)}<span class="truncate">{c.name}</span>
					</li>
				{/each}
			</ul>
		{:else if pr.checks.length}
			<!-- Its CI checks, one by one, are on the CI step of the Checks. -->
			<p class="mt-1 text-sm text-muted-foreground">
				CI: {ciChecksLine(pr.checks)} ·
				<button type="button" class="text-sea hover:underline" onclick={() => jump('checks')}
					>See the checks</button
				>
			</p>
		{:else}
			<p class="mt-1 text-sm text-muted-foreground">No CI checks reported.</p>
		{/if}
		{@render source(ev.pr)}
		{@render reviewTab()}
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
				<a
					href={docHref(ev.report.value.path)}
					class="block truncate font-mono text-xs text-sea underline-offset-2 hover:underline"
					data-doc-link>{ev.report.value.path}</a
				>
				<p class="mt-1 text-sm leading-relaxed">{ev.report.value.excerpt}</p>
			</div>
		</div>
		{@render source(ev.report)}
	{:else if ev}
		{@render unavailable(ev.report)}
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

{#snippet previewPanel(task: TaskSummary)}
	<!-- The worker's reported preview, embedded, beside a helper to talk it through before any
	     feedback goes to the worker (work that has landed has no worker to send it to). -->
	{#if task.preview}
		<section aria-labelledby="live-preview">
			<h2 id="live-preview" class="sr-only">Live preview</h2>
			{#if active === 'preview' && !full}
				{@const talk = task.status !== 'landed'}
				<!-- Side by side on a wide screen; below it, under the page (Full screen puts them side by side). -->
				<div class="grid gap-4 {talk ? '2xl:grid-cols-[minmax(0,1fr)_24rem]' : ''}">
					<div bind:this={embedded} class="min-w-0">
						<LivePreview
							taskId={task.id}
							pointing={talk && pointing}
							pin={pointed?.at ?? null}
							onpoint={(p, at) => {
								pointed = { pointer: p, at };
								pointing = false;
							}}
							onfullscreen={() => openPreview(embedded)}
						/>
						{#if task.board || (previewCheck?.state === 'live' && previewCheck.url)}
							<!-- Plugins' buttons on the preview (Share for review), and the task's review board. -->
							<div class="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
								{#if task.board}
									<a
										href={task.board.url}
										target="_blank"
										rel="noreferrer"
										class="inline-flex items-center gap-1 font-medium text-sea hover:underline"
										data-open-board
										><LayoutDashboard class="size-3.5" aria-hidden="true" />Open the review board</a
									>
								{/if}
								{#if previewCheck?.state === 'live' && previewCheck.url}
									<span class="ml-auto flex flex-wrap items-center gap-1">
										<PreviewActions
											preview={{
												url: previewCheck.url,
												taskId: task.id,
												title: task.shortTitle,
												projectId: task.projectId,
												board: false
											}}
										/>
									</span>
								{/if}
							</div>
						{/if}
					</div>
					{#if talk}
						<div class="flex h-[34rem] flex-col 2xl:mt-[1.875rem] 2xl:h-[70vh] 2xl:min-h-80">
							<PreviewHelper {task} url={task.preview.url} bind:pointing bind:attached={pointed} />
						</div>
					{/if}
				</div>
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

{#snippet pluginSection(entry: SlotEntry)}
	<section class="rounded-xl border p-4" aria-label={entry.title} data-slot="task.section">
		<h2 class="mb-3 text-sm font-medium">{entry.title}</h2>
		<SlotContent {entry} now={live.now} />
	</section>
{/snippet}

<main class="px-4 pt-4 pb-20 sm:px-6 {task && ev && detail ? 'lg:p-0' : 'lg:px-10'}">
	{#if !task || !ev || !detail}
		<a
			href={back}
			class="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
			><ArrowLeft class="size-4" aria-hidden="true" />Harbour</a
		>
		<p class="surface mt-6 max-w-3xl p-6 text-muted-foreground">{data.problem ?? 'Loading…'}</p>
	{:else}
		<div class="flex flex-col gap-8 lg:flex-row lg:items-start lg:gap-0">
			<!-- The overview stays put while the tabs beside it change. On a wide screen it is a
			     flush, full-height panel against the left-hand menu, resizable like the home page's
			     On deck; narrow, it stacks above the tabs as a card. -->
			<ResizableRail
				storageKey="wheelhouse-task-overview-width"
				label="Resize the overview"
				defaultWidth={416}
				side="left"
				class="bg-panel max-lg:!w-auto max-lg:border-0 max-lg:bg-transparent lg:sticky lg:top-15 lg:h-[calc(100dvh-3.75rem)] max-lg:[&>[role=separator]]:hidden"
			>
				<aside
					class="no-scrollbar min-w-0 rounded-lg border bg-panel px-6 pt-1 pb-6 lg:h-full lg:overflow-y-auto lg:rounded-none lg:border-0 lg:pt-0"
					aria-label="Overview"
				>
					<div
						class="-mx-6 flex h-11 items-center border-b px-6 max-lg:mx-0 max-lg:border-0 max-lg:px-0"
					>
						<a
							href={back}
							class="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
							><ArrowLeft class="size-4" aria-hidden="true" />Harbour</a
						>
					</div>
					<TaskOverview
						{task}
						{detail}
						onpreview={(from) => openPreview(from)}
						ontime={revealTime}
					/>
					{#if hasTime(task, detail)}
						<div class="mt-6 scroll-mt-20 border-t pt-5" bind:this={timeTop} data-time>
							{@render timePanel(task, detail)}
						</div>
					{/if}
				</aside>
			</ResizableRail>

			<!-- The tabs and every panel fill the rest of the page on one solid sheet, flush to the
			     edges, with the tabs across the top; never on the graph paper. -->
			<div
				class="min-w-0 flex-1 scroll-mt-15 bg-card text-card-foreground max-lg:rounded-lg max-lg:border max-lg:border-hair lg:min-h-[calc(100dvh-3.75rem)]"
			>
				<div class="sticky top-15 z-20 border-b bg-card max-lg:rounded-t-lg">
					<div
						class="no-scrollbar flex h-11 items-center gap-1 overflow-x-auto px-3 sm:px-5"
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
								class="-mb-px inline-flex h-11 shrink-0 items-center gap-1.5 border-b-2 px-3 text-base font-semibold tracking-[0.1em] whitespace-nowrap transition-colors [font-variant-caps:all-small-caps] {active ===
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
						{#if active === DEFAULT_TAB && consoleInImage(task)}
							<button
								type="button"
								class="ml-auto inline-flex shrink-0 items-center gap-1 rounded-full border px-3 py-1 text-xs text-muted-foreground hover:text-foreground"
								onclick={() => jump('now')}
								><ArrowDown class="size-3" aria-hidden="true" />Jump to now</button
							>
						{/if}
					</div>
				</div>

				<!-- Every panel is in the page (so a link or search finds it); only the chosen one shows. -->
				{#each tabs as tab (tab.id)}
					<div
						id="panel-{tab.id}"
						role="tabpanel"
						aria-labelledby="tab-{tab.id}"
						tabindex="0"
						class="outline-none {tab.id === DEFAULT_TAB ? '' : 'px-4 py-6 sm:px-8'}"
						hidden={active !== tab.id}
					>
						{#if tab.id === DEFAULT_TAB}
							<div bind:this={feed}>
								<TaskTimeline
									bind:this={timeline}
									{task}
									{detail}
									{shots}
									bind:strand={() => strand, (v) => (strands[id] = v)}
									evidence={stageEvidence}
									now={consoleInImage(task) ? nowBlock : undefined}
									onshot={(url) => (shotIndex = shotAt(url))}
									onpreview={() => show('preview')}
								/>
								{#if unseen}
									<div
										class="pointer-events-none sticky bottom-6 z-10 flex h-0 items-end justify-center"
									>
										<button
											type="button"
											class="pointer-events-auto inline-flex items-center gap-1 rounded-full border bg-card px-3 py-1 text-xs text-muted-foreground shadow-sm hover:text-foreground"
											onclick={() => following?.follow.jump()}
											><ArrowDown class="size-3" aria-hidden="true" />Jump to latest</button
										>
									</div>
								{/if}
							</div>
						{:else if tab.id === 'preview'}{@render previewPanel(task)}
						{:else if tab.id === 'changes'}<div class="max-w-5xl">{@render filesBlock()}</div>
						{:else if tab.id === 'screenshots'}{@render screenshotsPanel()}
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
				url={task.preview?.url ?? ''}
				talk={task.status !== 'landed'}
				from={studioFrom}
				onclose={() => show(active)}
			/>
		{/if}
		<Lightbox {shots} bind:index={shotIndex} />
		<DiffDialog taskId={task.id} bind:file={diffFile} />
	{/if}
</main>
