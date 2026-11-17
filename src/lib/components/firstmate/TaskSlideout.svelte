<script lang="ts">
	/**
	 * A task slid out over the page from On deck, three quarters of the screen
	 * wide (the whole screen on a phone), so the captain sees how it is going
	 * without leaving the bridge. At the top, the task at a glance and in large
	 * type: its state, what it is waiting on, its pull request and checks, who is
	 * on it and what they are doing now, its passage, and beside that its live
	 * preview (else the worker's live console, else its latest screenshot).
	 * Under it, the task page itself (TaskView): the Timeline, Chat and the other
	 * tabs. It is a dialog: Escape, a click outside or Close shut it, and focus
	 * goes back to the line that opened it. Open full page goes to the task page.
	 * It is drawn once for every page (SlideoutHost), which opens it for any link
	 * to a task's page; `tab` is the tab such a link named.
	 */
	import { Dialog } from 'bits-ui';
	import { goto } from '$app/navigation';
	import {
		ArrowUpRight,
		CircleCheck,
		CircleDashed,
		CircleX,
		Compass,
		ExternalLink,
		GitPullRequest,
		LoaderCircle,
		MessageSquare,
		Timer,
		X
	} from '@lucide/svelte';
	import { agentLine, consoleInImage, harnessName, nowLabel, nowLine } from '$lib/card';
	import { checksLine, ciChecksLine, showsChecks } from '$lib/checks';
	import { currentFleet, live } from '$lib/client/live.svelte';
	import { previewChecks } from '$lib/client/previewchecks.svelte';
	import { pullRequests } from '$lib/client/pullrequests';
	import { ago } from '$lib/format';
	import { etaLine } from '$lib/insights';
	import type { Box } from '$lib/motion';
	import { lineState } from '$lib/ondeck';
	import { prState } from '$lib/taskpage';
	import type { TaskDetail, TaskSummary } from '$lib/types';
	import ChecksStrip from '$lib/components/wh/ChecksStrip.svelte';
	import ConsoleWindow from '$lib/components/wh/ConsoleWindow.svelte';
	import LinkedText from '$lib/components/wh/LinkedText.svelte';
	import LivePreview from '$lib/components/wh/LivePreview.svelte';
	import PreviewStudio from '$lib/components/wh/PreviewStudio.svelte';
	import StageTrack from '$lib/components/wh/StageTrack.svelte';
	import TaskView, { type TaskRead, type TaskSeed } from '$lib/components/wh/TaskView.svelte';
	import WhereBadge from '$lib/components/wh/mates/WhereBadge.svelte';
	import TaskDecisions from '$lib/components/wh/inbox/TaskDecisions.svelte';
	import StateIcon from './StateIcon.svelte';

	let {
		taskId,
		tab = null,
		tasks,
		project = null,
		onClose,
		onChat
	}: {
		/** The task slid out, or null while none is. */
		taskId: string | null;
		/** The tab it opens on (a link's `?tab=`), else the Timeline. */
		tab?: string | null;
		/** The fleet's tasks as On deck has them. */
		tasks: TaskSummary[];
		/** The task's project name. */
		project?: string | null;
		onClose: () => void;
		onChat: (t: TaskSummary) => void;
	} = $props();

	// The evidence is read once per task opened; the task view refreshes it as the fleet changes.
	function readTask(id: string): Promise<TaskRead> {
		return fetch(`/api/tasks/${encodeURIComponent(id)}`)
			.then(async (r) =>
				r.ok
					? { detail: (await r.json()) as TaskDetail, problem: null }
					: { detail: null, problem: `The task’s details cannot be read (${r.status}).` }
			)
			.catch((e: unknown) => ({
				detail: null,
				problem: `The task’s details cannot be read: ${(e as Error)?.message ?? e}`
			}));
	}
	const seed = $derived<TaskSeed | null>(
		taskId ? { id: taskId, detail: readTask(taskId), slotsAt: 0 } : null
	);
	let read = $state<{ id: string; detail: TaskDetail | null } | null>(null);
	const detail = $derived(read && read.id === taskId ? read.detail : null);

	const task = $derived(
		taskId
			? (tasks.find((t) => t.id === taskId) ??
					currentFleet()?.tasks.find((t) => t.id === taskId) ??
					detail?.task ??
					null)
			: null
	);
	const sign = $derived(task ? lineState(task) : null);
	// Under the state in a word: the status in Firstmate's words (when it says more), and how fresh.
	const signNote = $derived(
		task && sign
			? [
					task.statusLabel !== sign.label ? task.statusLabel : null,
					task.current?.observedAt ? `checked ${ago(task.current.observedAt, live.now)}` : null
				]
					.filter(Boolean)
					.join(' · ')
			: ''
	);
	const ev = $derived(detail?.evidence ?? null);
	const pr = $derived(ev?.pr.available ? ev.pr.value : null);
	const prLink = $derived(task?.pr ? pullRequests.review(task.projectId, task.pr) : null);
	const now = $derived(task ? nowLine(task, null, live.now) : null);
	const eta = $derived(task?.eta && !task.eta.openEnded ? etaLine(task.eta) : null);
	const href = $derived(task ? `/tasks/${encodeURIComponent(task.id)}` : '#');

	// What the right of the overview shows: the live preview, else the worker's console, else a screenshot.
	const picture = $derived(
		!task
			? null
			: task.preview && !previewChecks.stopped(task.id)
				? 'preview'
				: consoleInImage(task)
					? 'console'
					: task.thumb.kind === 'screenshot'
						? 'shot'
						: null
	);
	$effect(() => {
		if (task?.preview) return previewChecks.watch(task.id);
	});

	type Tone = 'success' | 'danger' | 'warning' | 'muted';
	// The pull request's checks in a word: from GitHub when read, else the validation run's CI.
	const checks = $derived.by((): { word: string; sub: string; tone: Tone } => {
		const list = pr?.checks ?? [];
		if (list.length) {
			const sub = ciChecksLine(list) ?? '';
			if (list.some((c) => c.state === 'fail')) return { word: 'Failing', sub, tone: 'danger' };
			if (list.some((c) => c.state === 'running' || c.state === 'pending'))
				return { word: 'Running', sub, tone: 'warning' };
			return { word: 'Green', sub, tone: 'success' };
		}
		const p = task?.pipeline;
		if (p?.ci === 'green') return { word: 'Green', sub: 'CI passed', tone: 'success' };
		if (p?.ci === 'red') return { word: 'Failing', sub: 'CI found problems', tone: 'danger' };
		if (p?.ci === 'pending') return { word: 'Running', sub: 'Waiting for CI', tone: 'warning' };
		if (p && p.outcome === 'running')
			return { word: 'Validating', sub: checksLine(p, live.now), tone: 'warning' };
		if (p?.outcome === 'passed')
			return { word: 'Passed', sub: 'Validation passed', tone: 'success' };
		if (p?.outcome === 'failed')
			return { word: 'Failing', sub: 'Validation failed', tone: 'danger' };
		return {
			word: 'None yet',
			sub: task?.pr
				? 'No CI checks reported'
				: task?.status === 'landed'
					? 'None recorded'
					: 'Nothing to check yet',
			tone: 'muted'
		};
	});
	const TONE: Record<Tone, string> = {
		success: 'text-success',
		danger: 'text-danger',
		warning: 'text-warning',
		muted: 'text-muted-foreground'
	};
	const STATE_TONE: Record<string, string> = {
		danger: 'text-danger',
		warning: 'text-warning',
		sea: 'text-sea',
		success: 'text-success',
		busy: 'text-foreground',
		muted: 'text-foreground',
		quiet: 'text-muted-foreground'
	};
	const waiting = $derived(
		!task?.attention
			? null
			: task.attention.owner === 'firstmate'
				? 'Waiting on Firstmate'
				: task.attention.owner === 'reviewers'
					? 'Waiting on reviewers'
					: task.attention.kind === 'review'
						? task.attention.approved
							? 'Ready for you to merge'
							: 'Ready for your review'
						: 'Your decision is needed'
	);

	// The full-screen preview grows out of the picture that opened it.
	let studio = $state<{ id: string; from: Box | null } | null>(null);
	let frame = $state<HTMLElement>();
	let scroller = $state<HTMLElement | null>(null);
	let panel = $state<HTMLElement | null>(null);

	/** A preview opened full screen leaves the slide-out for the task page's own full-screen preview. */
	function fullPreview(id: string) {
		onClose();
		void goto(`/tasks/${encodeURIComponent(id)}?tab=preview&full=1`);
	}

	function openChange(open: boolean) {
		if (!open) onClose();
	}
	// Escape leaves the full-screen preview first (the dialog keeps the key from the preview's own
	// handler, so it is closed here); the slide-out stays.
	function escape(e: KeyboardEvent) {
		const open = document.querySelector('[data-preview-studio]');
		if (!open) return;
		e.preventDefault();
		open.querySelector<HTMLButtonElement>('button[aria-label^="Close full screen"]')?.click();
	}
	const label =
		'[font-variant-caps:all-small-caps] text-[0.95rem] font-semibold tracking-[0.1em] text-muted-foreground';
</script>

<Dialog.Root open={!!taskId} onOpenChange={openChange}>
	<Dialog.Portal>
		<Dialog.Overlay
			class="fixed inset-0 z-50 bg-black/45 backdrop-blur-[2px] duration-200 data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0"
		/>
		<Dialog.Content
			class="fixed inset-y-0 right-0 z-50 flex w-full flex-col bg-background text-foreground shadow-2xl duration-300 outline-none md:w-[75vw] md:border-l md:border-hair data-open:animate-in data-open:slide-in-from-right data-closed:animate-out data-closed:slide-out-to-right"
			bind:ref={panel}
			onEscapeKeydown={escape}
			onOpenAutoFocus={(e) => {
				// Focus the panel itself, not its first button: Tab moves on from there.
				e.preventDefault();
				panel?.focus();
			}}
			data-task-slideout
		>
			{#if task && sign && seed}
				<!-- The bar across the top: what it is, and the ways on from here. -->
				<header
					class="flex h-14 shrink-0 items-center gap-3 border-b bg-header pr-2 pl-5 max-md:pl-4"
				>
					<span
						class="inline-flex shrink-0 items-center gap-1.5 text-sm font-semibold {STATE_TONE[
							sign.tone
						]}"><StateIcon state={sign} decorative class="size-5" />{sign.label}</span
					>
					<span class="min-w-0 truncate text-sm text-muted-foreground max-sm:hidden"
						>{project ?? task.projectId}{task.branch ? ` · ${task.branch}` : ''}</span
					>
					<span class="ml-auto flex shrink-0 items-center gap-1">
						<button
							type="button"
							class="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-md px-2.5 text-sm text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
							onclick={() => onChat(task)}
							><MessageSquare class="size-4" aria-hidden="true" /><span class="max-sm:sr-only"
								>Chat about this</span
							></button
						>
						<a
							{href}
							class="inline-flex h-9 items-center gap-1.5 rounded-md px-2.5 text-sm font-medium text-foreground hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"
							data-open-full-page
							><ArrowUpRight class="size-4" aria-hidden="true" />Open full page</a
						>
						<Dialog.Close
							class="grid size-10 cursor-pointer place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
							aria-label="Close"><X class="size-5" aria-hidden="true" /></Dialog.Close
						>
					</span>
				</header>

				<div bind:this={scroller} class="min-h-0 flex-1 overflow-y-auto overscroll-contain">
					<!-- The task at a glance. -->
					<section class="relative border-b bg-panel" aria-label="Overview" data-slideout-overview>
						<span class="absolute inset-x-0 top-0 h-[3px] bg-gold/80" aria-hidden="true"></span>
						<div
							class="grid gap-x-10 gap-y-7 px-8 pt-8 pb-9 max-md:px-4 max-md:pt-6 max-md:pb-7 {picture
								? 'xl:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]'
								: ''}"
						>
							<div class="min-w-0">
								<p
									class="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground"
								>
									<span class="font-medium text-foreground/80">{project ?? task.projectId}</span>
									{#if task.since}<span aria-hidden="true">·</span><span>filed {task.since}</span
										>{/if}
									<WhereBadge {task} />
								</p>
								<Dialog.Title
									class="mt-2 font-title text-[2.75rem] leading-[1.05] text-balance max-md:text-[2.1rem]"
									>{task.shortTitle}</Dialog.Title
								>
								<Dialog.Description class="mt-4 flex items-start gap-3">
									<StateIcon state={sign} decorative class="mt-0.5 size-7 shrink-0" />
									<span class="min-w-0">
										<span class="block text-xl font-semibold {STATE_TONE[sign.tone]}"
											>{sign.label}</span
										>
										<span class="block text-sm text-muted-foreground">{signNote}</span>
									</span>
								</Dialog.Description>

								{#if task.attention && waiting}
									<div
										class="mt-5 rounded-xl border-l-[3px] px-4 py-3 {task.attention.owner ===
										'captain'
											? 'border-gold bg-gold/10'
											: task.attention.owner === 'reviewers'
												? 'border-muted-foreground/40 bg-muted'
												: 'border-warning bg-warning/10'}"
										data-slideout-attention
									>
										<p
											class="text-sm font-semibold {task.attention.owner === 'captain'
												? 'text-gold'
												: task.attention.owner === 'reviewers'
													? 'text-foreground'
													: 'text-warning'}"
										>
											{waiting}
										</p>
										<p class="mt-1 line-clamp-4 text-[0.95rem] leading-relaxed whitespace-pre-line">
											<LinkedText text={task.attention.text} />
										</p>
									</div>
								{:else if now}
									<p class="mt-5 text-[1.05rem] leading-relaxed" data-slideout-now>
										<span class="mr-1 text-muted-foreground">{nowLabel(now)}</span><LinkedText
											text={now.text}
										/>{#if now.at}<span class="text-muted-foreground"
												>{` · ${ago(now.at, live.now)}`}</span
											>{/if}
									</p>
								{:else if task.summary}
									<p class="mt-5 text-[1.05rem] leading-relaxed">
										<LinkedText text={task.summary} />
									</p>
								{/if}
								<!-- Its open questions, as a badge that opens them in the Decisions slide-out. -->
								<TaskDecisions {task} />

								<!-- The facts, in large type: the pull request, its checks, the crew, the time. -->
								<dl
									class="mt-6 grid grid-cols-2 gap-3 {picture ? '' : 'lg:grid-cols-4'}"
									data-slideout-facts
								>
									<div class="fact">
										<dt class={label}>Pull request</dt>
										<dd>
											{#if task.pr}
												<a
													href={prLink?.href ?? task.pr.url}
													target={prLink && !prLink.external ? undefined : '_blank'}
													rel="noreferrer"
													class="group flex items-baseline gap-1.5 hover:text-sea"
													data-slideout-pr
												>
													<span class="text-2xl font-semibold tabular-nums"
														>{task.pr.number ? `#${task.pr.number}` : 'Open'}</span
													>
													{#if pr}<span class="text-sm text-muted-foreground"
															>{prState(pr.state, pr.draft)}</span
														>{/if}
													{#if prLink && !prLink.external}<Compass
															class="size-3.5 self-center text-muted-foreground group-hover:text-sea"
															aria-hidden="true"
														/>{:else}<ExternalLink
															class="size-3.5 self-center text-muted-foreground group-hover:text-sea"
															aria-hidden="true"
														/>{/if}
												</a>
												<span class="mt-0.5 block truncate text-xs text-muted-foreground"
													>{pr?.reviewDecision
														? pr.reviewDecision.toLowerCase().replace(/_/g, ' ')
														: prLink && !prLink.external
															? 'Review it in Wheelhouse'
															: 'On GitHub'}</span
												>
											{:else}
												<span
													class="flex items-center gap-1.5 text-2xl font-semibold text-muted-foreground"
													><GitPullRequest class="size-5" aria-hidden="true" />None</span
												>
												<span class="mt-0.5 block text-xs text-muted-foreground"
													>{task.status === 'landed' ? 'None recorded' : 'Not opened yet'}</span
												>
											{/if}
										</dd>
									</div>
									<div class="fact">
										<dt class={label}>Checks</dt>
										<dd>
											<span
												class="flex items-center gap-1.5 text-2xl font-semibold {TONE[checks.tone]}"
												data-slideout-checks={checks.tone}
											>
												{#if checks.tone === 'success'}<CircleCheck
														class="size-5"
														aria-hidden="true"
													/>{:else if checks.tone === 'danger'}<CircleX
														class="size-5"
														aria-hidden="true"
													/>{:else if checks.tone === 'warning'}<LoaderCircle
														class="size-5 motion-safe:animate-spin"
														aria-hidden="true"
													/>{:else}<CircleDashed class="size-5" aria-hidden="true" />{/if}
												{checks.word}
											</span>
											<span class="mt-0.5 block truncate text-xs text-muted-foreground"
												>{checks.sub}</span
											>
										</dd>
									</div>
									<div class="fact">
										<dt class={label}>Crew</dt>
										<dd>
											<span class="flex items-center gap-2 text-2xl font-semibold">
												<span
													class="size-2.5 shrink-0 rounded-full {task.busy
														? 'bg-success motion-safe:animate-pulse'
														: 'bg-muted-foreground/50'}"
													aria-hidden="true"
												></span>
												<span class="truncate"
													>{task.worker?.harness
														? harnessName(task.worker.harness)
														: 'Firstmate'}</span
												>
											</span>
											<span
												class="mt-0.5 block truncate text-xs text-muted-foreground"
												title={agentLine(task.worker) ?? undefined}
												>{task.busy ? 'Working now' : 'Not busy'}{task.worker?.model
													? ` · ${task.worker.model}`
													: ''}{task.worker?.name ? ` · ${task.worker.name}` : ''}</span
											>
										</dd>
									</div>
									<div class="fact">
										<dt class={label}>
											{eta ? 'Time left' : task.mergedAt ? 'Landed' : 'Passage'}
										</dt>
										<dd>
											{#if eta}
												<span
													class="flex items-center gap-1.5 text-2xl font-semibold {eta.tone ===
													'warning'
														? 'text-warning'
														: ''}"
													><Timer class="size-5 shrink-0" aria-hidden="true" /><span
														class="truncate"
														title={eta.text}>{eta.text.replace(/^About (.*) left$/, '~$1')}</span
													></span
												>
												<span class="mt-0.5 block truncate text-xs text-muted-foreground"
													>Work time, as similar tasks went</span
												>
											{:else if task.mergedAt}
												<span class="block text-2xl font-semibold"
													>{ago(task.mergedAt, live.now)}</span
												>
												<span class="mt-0.5 block text-xs text-muted-foreground">Merged</span>
											{:else}
												{@const step = task.passage.steps[task.passage.current]}
												<span class="block truncate text-2xl font-semibold"
													>{step?.label ?? task.statusLabel}</span
												>
												<span class="mt-0.5 block text-xs text-muted-foreground"
													>Step {Math.min(task.passage.current + 1, task.passage.steps.length)} of {task
														.passage.steps.length}</span
												>
											{/if}
										</dd>
									</div>
								</dl>

								{#if showsChecks(task)}
									<div class="mt-5"><ChecksStrip pipeline={task.pipeline} busy={task.busy} /></div>
								{/if}
								{#if task.passage.steps.length > 1}
									<div class="mt-6"><StageTrack {task} /></div>
								{/if}
							</div>

							{#if picture}
								<!-- The picture: the live preview (it opens full size), the worker's console, or a screenshot. -->
								<div class="min-w-0 self-start" data-slideout-picture={picture}>
									<p class="mb-2 flex items-center gap-2 {label}">
										{#if picture === 'preview'}<span
												class="size-2 rounded-full bg-success motion-safe:animate-pulse"
												aria-hidden="true"
											></span>Live preview
										{:else if picture === 'console'}<span
												class="size-2 rounded-full {task.busy
													? 'bg-success motion-safe:animate-pulse'
													: 'bg-muted-foreground/50'}"
												aria-hidden="true"
											></span>The worker’s console, live
										{:else}Latest screenshot{/if}
									</p>
									{#if picture === 'preview'}
										<div
											bind:this={frame}
											class="overflow-hidden rounded-xl border bg-card shadow-sm"
										>
											<LivePreview
												taskId={task.id}
												compact
												toolbar={false}
												onopen={() => fullPreview(task.id)}
											/>
										</div>
									{:else if picture === 'console'}
										<ConsoleWindow {task} lines={16} class="rounded-xl shadow-sm" />
									{:else if task.thumb.kind === 'screenshot'}
										<a {href} class="block overflow-hidden rounded-xl border shadow-sm">
											<img
												src={task.thumb.url}
												alt={task.thumb.name}
												class="aspect-[16/10] w-full object-cover object-top"
											/>
										</a>
									{/if}
								</div>
							{/if}
						</div>
					</section>

					<!-- The task page itself: the Timeline, Chat and the other tabs. -->
					{#key task.id}
						<TaskView
							id={task.id}
							{seed}
							embedded
							{tab}
							{scroller}
							onfullpreview={() => fullPreview(task.id)}
							ondetail={(d) => (read = { id: task.id, detail: d })}
						/>
					{/key}
				</div>
				{#if studio?.id === task.id && task.preview}
					<PreviewStudio
						taskId={task.id}
						title={task.shortTitle}
						url={task.preview?.url ?? ''}
						talk={task.status !== 'landed'}
						from={studio?.from ?? null}
						onclose={() => (studio = null)}
					/>
				{/if}
			{:else}
				<Dialog.Title class="sr-only">Task</Dialog.Title>
				<div class="flex h-14 items-center justify-end border-b pr-2">
					<Dialog.Close
						class="grid size-10 cursor-pointer place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
						aria-label="Close"><X class="size-5" aria-hidden="true" /></Dialog.Close
					>
				</div>
				<p class="px-8 py-10 text-muted-foreground">This task is no longer in the fleet.</p>
			{/if}
		</Dialog.Content>
	</Dialog.Portal>
</Dialog.Root>

<style>
	.fact {
		min-width: 0;
		border-radius: 0.875rem;
		border: 1px solid var(--border);
		background: var(--card);
		padding: 0.8rem 1rem 0.85rem;
	}
</style>
