<script lang="ts">
	import { page } from '$app/state';
	import { onMount } from 'svelte';
	import { currentFleet, live } from '$lib/client/live.svelte';
	import { sendToInbox } from '$lib/client/chat.svelte';
	import { SESSION_HEADER } from '$lib/client/messages';
	import { ago } from '$lib/format';
	import {
		applyReviewEvent,
		changeNote,
		readingOrder,
		spent,
		threadOf,
		usageLine,
		type GuideItem,
		type ReviewHunk,
		type ReviewRun,
		type ReviewView
	} from '$lib/prreview';
	import { Button } from '$lib/components/ui/button';
	import AskBox from '$lib/components/wh/review/AskBox.svelte';
	import HunkCard from '$lib/components/wh/review/HunkCard.svelte';
	import RunView from '$lib/components/wh/review/RunView.svelte';
	import {
		ArrowLeft,
		ChevronRight,
		Compass,
		ExternalLink,
		GitPullRequest,
		LoaderCircle,
		RefreshCcw,
		Square
	} from '@lucide/svelte';

	let { data } = $props();

	let fetched = $state<ReviewView | null>(null);
	const view = $derived(fetched?.taskId === data.id ? fetched : data.view);
	const id = $derived(data.id);
	const task = $derived(currentFleet()?.tasks.find((t) => t.id === id) ?? null);
	const title = $derived(task?.title ?? data.title ?? id);

	const token = () => page.data.sessionToken as string;
	let model = $state<string | null>(null);
	let effort = $state<string | null>(null);
	const ok = $derived(view.available ? view : null);
	const pick = $derived({
		model: model ?? ok?.config.model ?? 'sonnet',
		effort: effort ?? ok?.config.effort ?? 'low'
	});

	async function refetch() {
		const want = id;
		const r = await fetch(`/api/tasks/${encodeURIComponent(want)}/review`).catch(() => null);
		if (r?.ok) {
			const v: ReviewView = await r.json();
			if (v.taskId === id) fetched = v;
		}
	}

	// Live answers arrive on the shared event stream; a new head of the PR reloads the view, once.
	const looked = new Set<string>();
	onMount(() =>
		live.onReview((e) => {
			if (e.taskId !== id) return;
			if (view.available && e.head !== view.head) {
				if (e.type === 'text' || looked.has(e.head)) return;
				looked.add(e.head);
				return void refetch();
			}
			fetched = applyReviewEvent(view, e);
		})
	);
	// The PR may move on (a fix pushed): look again when the fleet changes, at most every 30 s.
	let lastLook = Date.now();
	$effect(() => {
		void live.revision;
		if (Date.now() - lastLook < 30_000) return;
		lastLook = Date.now();
		void refetch();
	});

	async function post(path: string, body: Record<string, unknown>): Promise<string | null> {
		try {
			const r = await fetch(`/api/tasks/${encodeURIComponent(id)}/review/${path}`, {
				method: 'POST',
				headers: { 'content-type': 'application/json', [SESSION_HEADER]: token() },
				body: JSON.stringify(body)
			});
			const d = await r.json().catch(() => null);
			if (!r.ok) return d?.message ?? `Wheelhouse answered ${r.status}.`;
			if (view.available && d?.run)
				fetched = applyReviewEvent(view, { taskId: id, head: view.head, type: 'run', run: d.run });
			if (view.available && d?.guide)
				fetched = applyReviewEvent(view, {
					taskId: id,
					head: view.head,
					type: 'guide',
					guide: d.guide
				});
			return null;
		} catch {
			return 'Could not reach the Wheelhouse server.';
		}
	}

	const ask = (hunk: ReviewHunk | null, question: string) =>
		post('ask', { question, hunk: hunk?.id ?? null, ...pick });
	const review = (hunk: ReviewHunk | null) => post('check', { hunk: hunk?.id ?? null, ...pick });
	const change = (hunk: ReviewHunk | null, text: string) =>
		sendToInbox(changeNote(ok?.pr ?? null, hunk, text), token(), id);
	const stop = (run: ReviewRun) =>
		void fetch(
			`/api/tasks/${encodeURIComponent(id)}/review/runs/${encodeURIComponent(run.id)}/stop`,
			{
				method: 'POST',
				headers: { [SESSION_HEADER]: token() }
			}
		).catch(() => {});

	let guideError = $state<string | null>(null);
	async function prepare(force = false) {
		if (
			force &&
			!confirm('Write the guide again? It runs the review agent once more for this version.')
		)
			return;
		guideError = await post('guide', { force, ...pick });
	}

	const guideRun = $derived(
		ok ? ([...ok.runs].reverse().find((r) => r.kind === 'guide') ?? null) : null
	);
	const guideGoing = $derived(guideRun?.status === 'running');
	const order = $derived(ok ? readingOrder(ok.files, ok.guide) : null);
	const items = $derived(
		new Map<string, GuideItem>((ok?.guide?.items ?? []).map((i) => [i.hunk, i]))
	);
	const records = $derived(new Map((ok?.guide?.records ?? []).map((r) => [r.label, r])));
	const running = $derived(ok ? ok.runs.filter((r) => r.status === 'running').length : 0);
	const busy = $derived(running >= 2);
	const agentProblem = $derived(ok?.config.unavailable ?? null);
	const total = $derived(ok ? spent(ok.runs) : { usd: 0, runs: 0 });
	const hunkCount = $derived(ok ? ok.files.reduce((n, f) => n + f.hunks.length, 0) : 0);
	const boilerFiles = $derived(order ? new Set(order.boilerplate.map((h) => h.path)).size : 0);
	const short = (sha: string) => sha.slice(0, 7);

	// Beside the diff the panel stays put (sticky on wide screens); its thread scrolls
	// inside it, kept at the newest question as one is asked.
	let prThread = $state<HTMLElement>();
	const prRuns = $derived(ok ? threadOf(ok.runs, null).length : 0);
	$effect(() => {
		void prRuns;
		if (prThread) prThread.scrollTop = prThread.scrollHeight;
	});

	const card = (h: ReviewHunk, rank: number | null, open: boolean) => ({
		hunk: h,
		item: items.get(h.id) ?? null,
		rank,
		records,
		runs: ok ? threadOf(ok.runs, h.id) : [],
		open,
		agentProblem,
		busy,
		onask: ask,
		onreview: review,
		onchange: change,
		onstop: stop
	});
</script>

{#snippet picker()}
	{#if ok}
		<label class="text-xs text-muted-foreground"
			>Model
			<select
				class="mt-1 block rounded-md border bg-background px-2 py-1 text-sm text-foreground"
				bind:value={() => pick.model, (v) => (model = v)}
			>
				{#each ok.config.models as m (m)}<option value={m}
						>{m}{m === ok.config.model ? ' (default)' : ''}</option
					>{/each}
			</select></label
		>
		<label class="text-xs text-muted-foreground"
			>Effort
			<select
				class="mt-1 block rounded-md border bg-background px-2 py-1 text-sm text-foreground"
				bind:value={() => pick.effort, (v) => (effort = v)}
			>
				{#each ok.config.efforts as f (f)}<option value={f}
						>{f}{f === ok.config.effort ? ' (default)' : ''}</option
					>{/each}
			</select></label
		>
	{/if}
{/snippet}

<svelte:head><title>Review · {title} · Wheelhouse</title></svelte:head>

<main class="px-4 py-6 sm:px-6 lg:px-10">
	<div class="surface px-5 py-6 sm:px-8 sm:py-8">
		<a
			href="/tasks/{encodeURIComponent(id)}"
			class="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
			><ArrowLeft class="size-4" aria-hidden="true" />{title}</a
		>
		<h1 class="mt-4 text-2xl">Pull request review</h1>

		{#if !ok}
			<p
				class="mt-6 rounded-lg border border-dashed p-6 text-sm text-muted-foreground"
				data-review="unavailable"
			>
				{view.available ? '' : view.reason}
			</p>
		{:else}
			<p class="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
				{#if ok.pr}
					<a
						href={ok.pr.url}
						target="_blank"
						rel="noreferrer"
						class="inline-flex items-center gap-1 text-sea hover:underline"
						><GitPullRequest class="size-4" aria-hidden="true" />{ok.pr.number
							? `#${ok.pr.number}`
							: 'Pull request'}{ok.pr.title ? ` ${ok.pr.title}` : ''}<ExternalLink
							class="size-3"
							aria-hidden="true"
						/></a
					>
				{/if}
				<span
					>Version <span class="font-mono text-xs">{short(ok.head)}</span> against {ok.base}</span
				>
				<span>{ok.files.length} files, {hunkCount} hunks</span>
			</p>

			<div class="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(20rem,26rem)]">
				<div class="min-w-0 space-y-6">
					<!-- The guide -->
					<section
						class="rounded-lg border bg-card p-5"
						aria-labelledby="guide-h"
						data-guide={ok.guide ? 'ready' : guideGoing ? 'running' : 'none'}
					>
						<h2 id="guide-h" class="flex items-center gap-2 text-lg">
							<Compass class="size-5 text-[var(--brass)]" aria-hidden="true" />The review guide
						</h2>
						{#if ok.guide}
							<p class="mt-2 max-w-prose text-sm leading-relaxed">{ok.guide.summary}</p>
							<p class="mt-2 text-xs text-muted-foreground">
								{ok.guide.items.filter((i) => i.importance !== 'routine').length} of {hunkCount} hunks
								to read first, drawing on {ok.guide.records.length} of the task’s records.
								{#if ok.guide.usage}<span data-usage
										>Written {ago(ok.guide.at, live.now)}: {usageLine(
											ok.guide.usage,
											ok.guide.effort
										)}.</span
									>{/if}
							</p>
							{#if !guideGoing}
								<button
									type="button"
									class="mt-2 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground hover:underline"
									onclick={() => prepare(true)}
									disabled={!!agentProblem}
									><RefreshCcw class="size-3" aria-hidden="true" />Write it again</button
								>
							{/if}
						{:else}
							<p class="mt-2 max-w-prose text-sm leading-relaxed text-muted-foreground">
								The review agent reads this pull request with the task’s records (the brief, the
								commits, the automated review’s findings and Firstmate’s calls, the description) and
								puts the important changes first, with why each was done this way. It says so when
								nothing records a reason. It runs only when you ask, once for this version.
							</p>
							{#if ok.staleGuide}
								<p class="mt-2 text-xs text-warning">
									A guide was written for an earlier version ({short(ok.staleGuide.head)}, {ago(
										ok.staleGuide.at,
										live.now
									)}); the pull request has changed since.
								</p>
							{/if}
						{/if}

						{#if guideGoing && guideRun}
							<div
								class="mt-3 flex flex-wrap items-center gap-3 text-sm text-muted-foreground"
								role="status"
							>
								<LoaderCircle class="size-4 animate-spin" aria-hidden="true" />
								<span
									>Reading {hunkCount} hunks and the records{guideRun.text
										? `, ${guideRun.text.length.toLocaleString()} characters written`
										: ''}…</span
								>
								<button
									type="button"
									class="inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-xs hover:bg-accent hover:text-foreground"
									onclick={() => stop(guideRun)}
									><Square class="size-3" aria-hidden="true" />Stop</button
								>
							</div>
						{:else if !ok.guide}
							<div class="mt-4 flex flex-wrap items-end gap-3">
								{@render picker()}
								<Button
									size="sm"
									onclick={() => prepare(false)}
									disabled={!!agentProblem || busy}
									data-prepare-guide><Compass />Prepare the guide</Button
								>
							</div>
							{#if agentProblem}
								<p class="mt-2 text-xs text-muted-foreground">{agentProblem}</p>
							{:else}
								<p class="mt-2 text-xs text-muted-foreground">
									Its cost and token use show here once it has run.
								</p>
							{/if}
						{/if}
						{#if guideError}
							<p class="mt-2 text-sm text-danger" role="alert">{guideError}</p>
						{:else if guideRun?.status === 'failed' && !ok.guide}
							<p class="mt-2 text-sm text-danger" role="alert">{guideRun.error}</p>
						{/if}
					</section>

					{#if ok.truncated}
						<p class="text-sm text-warning">
							This pull request is large: only its first files are shown.
						</p>
					{/if}

					{#if order && order.start.length}
						<section aria-labelledby="start-h" class="space-y-3">
							<h2 id="start-h" class="text-lg">Read these first</h2>
							{#each order.start as h, i (h.id)}
								<HunkCard {...card(h, i + 1, true)} />
							{/each}
						</section>
					{/if}

					{#if order && order.rest.length}
						<section aria-labelledby="rest-h" class="space-y-3">
							<h2 id="rest-h" class="text-lg">
								{order.start.length ? 'Everything else' : 'The changes'}
							</h2>
							{#if ok.guide}
								<p class="text-xs text-muted-foreground">
									Routine changes, in file order, folded. Open any to see its diff.
								</p>
							{/if}
							{#each order.rest as h (h.id)}
								<HunkCard {...card(h, null, !ok.guide)} />
							{/each}
						</section>
					{/if}

					{#if order && order.boilerplate.length}
						<details class="group rounded-lg border bg-card" data-boilerplate>
							<summary
								class="flex cursor-pointer list-none items-center gap-2 px-4 py-3 text-sm [&::-webkit-details-marker]:hidden"
							>
								<ChevronRight
									class="size-4 text-muted-foreground transition-transform group-open:rotate-90"
									aria-hidden="true"
								/>
								<span class="font-medium">Boilerplate, folded away</span>
								<span class="text-muted-foreground"
									>{order.boilerplate.length} hunks in {boilerFiles} files: lockfiles, generated files,
									snapshots, formatting</span
								>
							</summary>
							<div class="space-y-3 border-t p-4">
								{#each order.boilerplate as h (h.id)}
									<HunkCard {...card(h, null, false)} />
								{/each}
							</div>
						</details>
					{/if}
				</div>

				<!-- Questions about the whole PR -->
				<aside class="min-w-0">
					<section
						class="space-y-3 rounded-lg border bg-[var(--panel)] p-4 xl:sticky xl:top-20 xl:flex xl:max-h-[calc(100vh-6rem)] xl:flex-col"
						aria-labelledby="ask-h"
					>
						<h2 id="ask-h" class="text-lg">Ask about this pull request</h2>
						<p class="text-xs text-muted-foreground">
							Questions and reviews here are about the whole change; each hunk has its own. Answers
							come from the diff and the task’s records, live as they are written.
						</p>
						<div
							bind:this={prThread}
							class="max-h-[60vh] space-y-3 overflow-y-auto xl:max-h-none xl:min-h-0 xl:flex-1"
							data-thread="pr"
						>
							{#each threadOf(ok.runs, null) as r (r.id)}
								<RunView run={r} onstop={stop} />
							{/each}
						</div>
						<AskBox
							scope="this pull request"
							{agentProblem}
							{busy}
							onask={(q) => ask(null, q)}
							onreview={() => review(null)}
							onchange={(t) => change(null, t)}
						/>
						<div class="flex flex-wrap items-end gap-3 border-t pt-3">{@render picker()}</div>
						<p class="text-xs text-muted-foreground" data-spent>
							{total.runs
								? `The review agent has spent ${total.usd < 0.01 ? 'under 1¢' : `$${total.usd.toFixed(3)}`} at list price on this version, over ${total.runs} run${total.runs === 1 ? '' : 's'}.`
								: 'Nothing has run for this version yet.'}
						</p>
					</section>
				</aside>
			</div>
			<p class="mt-6 text-xs text-muted-foreground">From {ok.source}.</p>
		{/if}
	</div>
</main>
