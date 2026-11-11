<script lang="ts">
	import { tick, type Snippet } from 'svelte';
	import {
		Bot,
		Check as CheckIcon,
		ChevronRight,
		CircleDashed,
		ExternalLink,
		FileText,
		GitMerge,
		GitPullRequest,
		MonitorPlay,
		Rocket,
		ShieldCheck,
		Sparkles,
		X
	} from '@lucide/svelte';
	import { live } from '$lib/client/live.svelte';
	import { previewChecks } from '$lib/client/previewchecks.svelte';
	import { ago, clock } from '$lib/format';
	import { plainStatus } from '$lib/plain';
	import { stepGist } from '$lib/taskpage';
	import {
		strandOf,
		taskTimeline,
		type Shot,
		type Strand,
		type TimelineItem
	} from '$lib/tasktimeline';
	import { PARTY_LABEL, type TalkEntry } from '$lib/buildlog';
	import type { PassageStep, TaskDetail, TaskSummary } from '$lib/types';
	import BusyRing from '../BusyRing.svelte';
	import ChangeRequests from '../ChangeRequests.svelte';
	import LinkedText from '../LinkedText.svelte';
	import QuestionList from '../QuestionList.svelte';
	import RawDetails from '../RawDetails.svelte';
	import { tone, textClass } from '../tone';
	import TaskBrief from './TaskBrief.svelte';

	/**
	 * The whole story of a task, oldest first: the instructions its worker was
	 * given, then each stage it has reached with what happened in it, as a
	 * conversation. The worker speaks on the left (its updates, questions,
	 * previews and screenshots); Firstmate, the automated review's answers and
	 * the captain on the right; and what happened to the work (the worker
	 * started, a validation run, a pull request ready or merged, a new run) on
	 * the line between them. Each stage ends with what it produced (`evidence`,
	 * from the page), and the current one with the worker's live console
	 * (`now`). Stages fold; the filter shows one strand of the story.
	 */
	let {
		task,
		detail,
		shots,
		strand = $bindable('all'),
		evidence,
		now,
		onshot,
		onpreview
	}: {
		task: TaskSummary;
		detail: TaskDetail;
		shots: Shot[];
		strand?: Strand | 'all';
		evidence: Snippet<[PassageStep]>;
		now?: Snippet;
		onshot: (url: string) => void;
		onpreview: () => void;
	} = $props();

	const talk = $derived(detail.build.conversation);
	const tl = $derived(
		taskTimeline({
			steps: task.passage.steps,
			history: detail.timeline.available ? detail.timeline.value : [],
			talk: talk.available ? talk.value : null,
			shots,
			validations: detail.validations,
			runs: task.runs?.runs ?? [],
			preview: task.preview ? { url: task.preview.url, at: task.preview.reportedAt } : null
		})
	);
	const t = $derived(tone(task));
	/** Who gave the worker its instructions: Firstmate, or the second mate that owns the task. */
	const boss = $derived(task.secondMate ? `Second mate ${task.secondMate.id}` : 'Firstmate');
	const keep = (i: TimelineItem) => strand === 'all' || strandOf(i) === strand;
	const lastSection = $derived(tl.sections.findLast((s) => s.step.state !== 'skipped'));

	const FILTERS: { id: Strand | 'all'; label: string }[] = [
		{ id: 'all', label: 'Everything' },
		{ id: 'talk', label: 'Conversation' },
		{ id: 'updates', label: 'Updates' },
		{ id: 'checks', label: 'Checks and pull request' }
	];

	// Every stage starts open, so the page reads as the whole story; one folds to a line.
	let toggled = $state<Record<string, boolean>>({});
	const isOpen = (key: string) => toggled[`${task.id} ${key}`] ?? true;
	const flip = (key: string) => (toggled[`${task.id} ${key}`] = !isOpen(key));
	const keys = $derived(['brief', ...tl.sections.map((s) => s.step.key)]);
	const allOpen = $derived(keys.every(isOpen));
	function setAll(open: boolean) {
		for (const k of keys) toggled[`${task.id} ${k}`] = open;
	}

	let opened = $state<Record<string, boolean>>({});
	const LONG = 280;
	function jump(id: string) {
		const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
		document
			.getElementById(id)
			?.scrollIntoView({ block: 'start', behavior: reduce ? 'auto' : 'smooth' });
	}

	/**
	 * Bring the Checks section or the live console (Now) into view, unfolding
	 * the stage that holds it and showing everything when a filter hides it.
	 */
	export async function reveal(what: 'checks' | 'now') {
		const sec =
			what === 'checks'
				? tl.sections.find((x) => x.step.evidence.includes('validation'))
				: lastSection;
		if (sec) toggled[`${task.id} ${sec.step.key}`] = true;
		if (what === 'checks' ? strand === 'talk' || strand === 'updates' : strand !== 'all') {
			strand = 'all';
		}
		await tick();
		jump(what === 'checks' ? 'task-checks' : 'now');
	}

	/** What a stage's current state is, in a few words. */
	function stateWords(s: PassageStep): string | null {
		if (s.state === 'skipped') return 'skipped';
		if (s.state !== 'current') return null;
		if (s.failed) return 'failed';
		if (task.status === 'landed') return null;
		return t === 'trouble'
			? `${task.statusLabel.toLowerCase()} here`
			: t === 'you'
				? 'waiting on you'
				: t === 'firstmate'
					? 'waiting on Firstmate'
					: task.status === 'done'
						? 'finished, with Firstmate'
						: 'in progress';
	}
	/** The worker's entries sit together; only the first of a run of them names it. */
	const WORKER = new Set(['status', 'preview', 'shots']);
	const worker = (i: TimelineItem) =>
		WORKER.has(i.kind) ||
		(i.kind === 'talk' && (i.entry.kind === 'question' || i.entry.kind === 'blocked'));
	const lead = (e: TalkEntry): string => {
		switch (e.kind) {
			case 'question':
				return `asked ${boss}`;
			case 'blocked':
				return `asked ${boss} for help`;
			case 'review':
				return `asked ${boss}`;
			case 'steer':
				return `${boss} → the worker`;
			case 'captain':
				return e.to === 'worker' ? 'Your feedback, passed on to the worker' : `You → ${boss}`;
		}
	};
	const OUTCOME: Record<TalkEntry['outcome']['state'], string> = {
		open: 'bg-warning/10 text-warning',
		answered: 'bg-success/10 text-success',
		cleared: 'bg-muted text-muted-foreground',
		read: 'bg-muted text-muted-foreground',
		unread: 'bg-sea/10 text-sea',
		sent: 'bg-muted text-muted-foreground'
	};
	const time = (at: string | null) => (at ? clock(at) : '');
</script>

{#snippet longText(id: string, text: string)}
	{@const long = text.length > LONG}
	<p
		class="text-sm leading-relaxed whitespace-pre-line {long && !opened[id] ? 'line-clamp-4' : ''}"
	>
		<LinkedText {text} />
	</p>
	{#if long}
		<button
			type="button"
			class="touch-target mt-1 text-xs text-muted-foreground hover:text-foreground hover:underline"
			aria-expanded={!!opened[id]}
			onclick={() => (opened[id] = !opened[id])}>{opened[id] ? 'Show less' : 'Show all'}</button
		>
	{/if}
{/snippet}

{#snippet avatar(kind: 'worker' | 'review')}
	<span
		class="grid size-8 shrink-0 place-items-center rounded-full border bg-muted text-muted-foreground"
		aria-hidden="true"
	>
		{#if kind === 'review'}<ShieldCheck class="size-4" />{:else}<Bot class="size-4" />{/if}
	</span>
{/snippet}

<!-- Left: the worker or the review. `head` names it unless it continues a run of the worker's entries. -->
{#snippet left(
	kind: 'worker' | 'review',
	head: boolean,
	what: string,
	at: string | null,
	body: Snippet,
	accent = false
)}
	<div class="flex items-start gap-3">
		{#if head}{@render avatar(kind)}{:else}<span class="w-8 shrink-0"></span>{/if}
		<div class="min-w-0 flex-1">
			{#if head}
				<p class="mb-1 flex flex-wrap items-baseline gap-x-2 text-xs text-muted-foreground">
					<span class="text-sm font-semibold text-foreground"
						>{kind === 'review' ? 'The automated review' : 'The worker'}</span
					>{what}<time class="tabular" datetime={at ?? undefined}>{time(at)}</time>
				</p>
			{/if}
			<div class="bubble bubble-firstmate {accent ? 'border-l-2 !border-l-warning' : ''}">
				{@render body()}
			</div>
		</div>
	</div>
{/snippet}

<!-- Right: Firstmate (or the second mate) and the captain. -->
{#snippet right(who: string, at: string | null, captain: boolean, body: Snippet, pill?: Snippet)}
	<div class="flex flex-col items-end">
		<p class="mb-1 flex flex-wrap items-baseline justify-end gap-x-2 text-xs text-muted-foreground">
			<span class="text-sm font-semibold text-foreground">{who}</span>
			{@render pill?.()}
			<time class="tabular" datetime={at ?? undefined}>{time(at)}</time>
		</p>
		<div
			class="bubble max-w-[min(85%,62ch)] {captain
				? 'bubble-captain !whitespace-normal'
				: 'bubble-firstmate !border-sea/40'}"
		>
			{@render body()}
		</div>
	</div>
{/snippet}

{#snippet outcome(e: TalkEntry)}
	<span class="rounded-full px-2 py-0.5 text-xs font-medium {OUTCOME[e.outcome.state]}"
		>{e.outcome.label}</span
	>
{/snippet}

{#snippet talkItem(e: TalkEntry, head: boolean)}
	{#if e.kind === 'question' || e.kind === 'blocked' || e.kind === 'review'}
		{#snippet asked()}
			<p class="font-medium">{e.title}</p>
			{#if e.body}<div class="mt-1">{@render longText(`${e.id} body`, e.body)}</div>{/if}
			{#if e.questions.length}<div class="mt-3"><QuestionList questions={e.questions} /></div>{/if}
			<p class="mt-2">{@render outcome(e)}</p>
		{/snippet}
		{@render left(
			e.kind === 'review' ? 'review' : 'worker',
			head || e.kind === 'review',
			lead(e),
			e.at,
			asked,
			e.outcome.state === 'open'
		)}
		{#if e.reply}
			{@const r = e.reply}
			{#snippet reply()}{@render longText(`${e.id} reply`, r.text)}{/snippet}
			<div class="mt-4">
				{@render right(
					r.from === 'worker'
						? 'The worker noted'
						: `${r.from === 'captain' ? 'You' : PARTY_LABEL[r.from]} answered`,
					r.at,
					r.from === 'captain',
					reply
				)}
			</div>
		{/if}
	{:else}
		{#snippet said()}
			{#if e.kind === 'captain'}<p class="text-xs text-muted-foreground">{e.title}</p>{/if}
			{#if e.kind !== 'captain'}<p class="font-medium">{e.title}</p>{/if}
			{#if e.body}<div class="mt-1">{@render longText(`${e.id} body`, e.body)}</div>{/if}
		{/snippet}
		{#snippet pill()}{@render outcome(e)}{/snippet}
		{@render right(e.kind === 'captain' ? 'You' : boss, e.at, e.kind === 'captain', said, pill)}
		{#if e.reply}
			{@const r = e.reply}
			{#snippet reply()}{@render longText(`${e.id} reply`, r.text)}{/snippet}
			<div class="mt-4">{@render right(`${PARTY_LABEL[r.from]} replied`, r.at, false, reply)}</div>
		{/if}
	{/if}
{/snippet}

{#snippet item(i: TimelineItem, head: boolean)}
	{#if i.kind === 'event' || i.kind === 'validation'}
		<div class="flex items-center gap-3 text-sm text-muted-foreground" data-entry={i.kind}>
			<span
				class="grid size-8 shrink-0 place-items-center rounded-full border bg-card"
				aria-hidden="true"
			>
				{#if i.kind === 'validation'}<ShieldCheck class="size-3.5" />
				{:else if i.event === 'launched'}<Rocket class="size-3.5" />
				{:else if i.event === 'pr-ready'}<GitPullRequest class="size-3.5 text-sea" />
				{:else if i.event === 'merged'}<GitMerge class="size-3.5 text-success" />
				{:else}<CheckIcon class="size-3.5" />{/if}
			</span>
			<p class="min-w-0 flex-1">
				{#if i.kind === 'validation'}
					<span class="text-foreground">Validation run started</span> · {i.run.text}
					{#if i.latest}
						· <button
							type="button"
							class="touch-target text-sea hover:underline"
							onclick={() => reveal('checks')}>See the checks</button
						>
					{/if}
				{:else}
					<span class={i.event === 'merged' ? 'font-medium text-success' : 'text-foreground'}
						>{i.event === 'launched' ? `${boss} started the worker` : i.text}</span
					>
					{#if i.url}
						<a
							href={i.url}
							target="_blank"
							rel="noreferrer"
							class="touch-target ml-1 inline-flex items-center gap-1 text-sea hover:underline"
							>Open<ExternalLink class="size-3" aria-hidden="true" /></a
						>
					{/if}
				{/if}
			</p>
			<time class="tabular shrink-0 text-xs" datetime={i.at}>{clock(i.at)}</time>
		</div>
	{:else if i.kind === 'status'}
		{@const plain = plainStatus(i.state, i.text)}
		{#snippet said()}
			<p class="text-sm"><LinkedText text={plain} /></p>
			<RawDetails raw={i.state ? `${i.state}: ${i.text.trim()}` : i.text} {plain} />
		{/snippet}
		<div data-entry="status">{@render left('worker', head, '', i.at, said)}</div>
	{:else if i.kind === 'preview'}
		{@const current = task.preview?.url === i.url}
		{@const stopped = current && previewChecks.stopped(task.id)}
		{#snippet card()}
			<div class="flex items-center gap-2 text-sm">
				<MonitorPlay class="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
				{#if !current}
					<span class="text-muted-foreground">An earlier preview, since replaced</span>
				{:else if stopped}
					<span class="text-muted-foreground" data-preview-stopped
						>Preview stopped. {previewChecks.checks[task.id]?.reason ?? ''}</span
					>
				{:else}
					<button type="button" class="touch-target text-sea hover:underline" onclick={onpreview}
						>Open the live preview</button
					>
				{/if}
			</div>
			<p class="mt-1 truncate font-mono text-xs text-muted-foreground" title={i.url}>{i.url}</p>
		{/snippet}
		<div data-entry="preview">
			{@render left('worker', head, 'reported a live preview', i.at, card)}
		</div>
	{:else if i.kind === 'shots'}
		{#snippet strip()}
			<div class="flex flex-wrap gap-2">
				{#each i.shots as s (s.url)}
					<button
						type="button"
						class="w-36 shrink-0 cursor-zoom-in text-left"
						onclick={() => onshot(s.url)}
						aria-label="Enlarge {s.name}"
					>
						<img
							src={s.url}
							alt={s.name}
							loading="lazy"
							class="aspect-[16/10] w-full rounded-md border object-cover object-top"
						/>
						<span class="mt-1 block truncate text-xs text-muted-foreground">{s.name}</span>
					</button>
				{/each}
			</div>
		{/snippet}
		<div data-entry="shots">
			{@render left(
				'worker',
				head,
				`saved ${i.shots.length === 1 ? 'a screenshot' : `${i.shots.length} screenshots`}`,
				i.at,
				strip
			)}
		</div>
	{:else if i.kind === 'run'}
		<div class="rounded-xl border border-sea/40 bg-sea/5 p-4" data-entry="run">
			<p class="flex items-baseline gap-2 text-sm">
				<span class="font-medium">Run {i.run.n} started</span>
				{#if i.run.basis}<span class="text-muted-foreground">· {i.run.basis}</span>{/if}
				<time class="tabular ml-auto text-xs text-muted-foreground" datetime={i.at}
					>{clock(i.at)}</time
				>
			</p>
			{#if i.run.changes.length}<div class="mt-2"><ChangeRequests run={i.run} /></div>{/if}
		</div>
	{:else if i.kind === 'talk'}
		<div data-entry="talk" data-talk={i.entry.kind}>{@render talkItem(i.entry, head)}</div>
	{/if}
{/snippet}

<div class="grid xl:grid-cols-[minmax(0,1fr)_14rem]">
	<div class="min-w-0 px-4 py-6 sm:px-8">
		<div class="mb-6 flex flex-wrap items-center gap-2">
			<div class="flex flex-wrap gap-2" role="group" aria-label="Show">
				{#each FILTERS as f (f.id)}
					<button
						type="button"
						class="rounded-full border px-3 py-1 text-xs transition-colors max-md:min-h-11 max-md:px-4 max-md:text-sm {strand ===
						f.id
							? 'border-foreground bg-foreground text-background'
							: 'text-muted-foreground hover:text-foreground'}"
						aria-pressed={strand === f.id}
						onclick={() => (strand = f.id)}>{f.label}</button
					>
				{/each}
			</div>
			<button
				type="button"
				class="touch-target ml-auto text-xs text-muted-foreground hover:text-foreground hover:underline"
				onclick={() => setAll(!allOpen)}>{allOpen ? 'Fold all' : 'Open all'}</button
			>
		</div>
		{#if !detail.timeline.available}
			<p class="mb-6 text-sm text-muted-foreground">
				Its history is not available: {detail.timeline.reason}
			</p>
		{/if}

		<ol aria-label="Timeline">
			<!-- First, what the worker was told to do. -->
			<li class="relative flex scroll-mt-28 gap-4 pb-8" id="stage-brief" data-stage="brief">
				<span class="absolute top-7 bottom-0 left-[11px] w-0.5 bg-foreground/40"></span>
				<span
					class="relative z-10 mt-0.5 grid size-6 shrink-0 place-items-center rounded-full bg-foreground text-background"
					><FileText class="size-3.5" aria-hidden="true" /></span
				>
				<div class="min-w-0 flex-1">
					<button
						type="button"
						class="touch-target group flex w-full items-baseline gap-2 text-left"
						aria-expanded={isOpen('brief')}
						onclick={() => flip('brief')}
					>
						<span class="font-display text-[1.12rem] font-medium group-hover:underline"
							>Instructions</span
						>
						<span class="min-w-0 truncate text-sm text-muted-foreground"
							>what {boss} asked the worker to do</span
						>
						<ChevronRight
							class="ml-auto size-4 shrink-0 self-center text-muted-foreground transition-transform {isOpen(
								'brief'
							)
								? 'rotate-90'
								: ''}"
							aria-hidden="true"
						/>
					</button>
					{#if isOpen('brief')}
						<div class="mt-3"><TaskBrief brief={detail.brief} taskId={task.id} /></div>
					{/if}
				</div>
			</li>

			{#each tl.sections as sec, n (sec.step.key)}
				{@const s = sec.step}
				{@const done = s.state === 'done'}
				{@const current = s.state === 'current'}
				{@const finished = current && task.status === 'landed' && !s.failed}
				{@const open = s.state !== 'skipped' && isOpen(s.key)}
				{@const items = sec.items.filter(keep)}
				{@const words = stateWords(s)}
				{@const gist = open ? null : stepGist(s, task, detail.evidence)}
				<li
					class="relative flex scroll-mt-28 gap-4 {open ? 'pb-10' : 'pb-5'}"
					id="stage-{s.key}"
					data-stage={s.key}
					data-open={open}
				>
					{#if n < tl.sections.length - 1 || tl.upcoming.length}
						<span
							class="absolute top-7 bottom-0 left-[11px] {done
								? 'w-0.5 bg-foreground/40'
								: 'w-0 border-l border-dotted border-input'}"
						></span>
					{/if}
					<span
						class="relative z-10 mt-0.5 grid size-6 shrink-0 place-items-center rounded-full text-xs font-medium {done
							? 'bg-foreground text-background'
							: current
								? t === 'trouble' || s.failed
									? 'bg-danger text-white'
									: t === 'you'
										? 'bg-sea text-on-accent'
										: finished
											? 'bg-success text-on-accent'
											: 'bg-foreground text-background ring-4 ring-foreground/15'
								: 'border border-dashed bg-background text-muted-foreground'}"
					>
						{#if current && !finished && task.busy}<BusyRing class="bg-foreground" />{/if}
						{#if done || finished}<CheckIcon class="size-3.5" aria-hidden="true" />
						{:else if s.failed}<X class="size-3.5" aria-hidden="true" />
						{:else}{n + 1}{/if}
					</span>
					<div class="min-w-0 flex-1">
						<button
							type="button"
							class="touch-target group flex w-full min-w-0 items-baseline gap-2 text-left disabled:cursor-default"
							disabled={s.state === 'skipped'}
							aria-expanded={s.state === 'skipped' ? undefined : open}
							aria-controls="stage-body-{s.key}"
							onclick={() => flip(s.key)}
						>
							<span
								class="shrink-0 font-display text-[1.12rem] font-medium group-enabled:group-hover:underline {s.state ===
								'skipped'
									? 'text-muted-foreground italic'
									: ''}">{s.label}</span
							>
							{#if words}
								<span
									class="shrink-0 text-sm {s.failed
										? 'text-danger'
										: t === 'normal' || t === 'landed' || s.state === 'skipped'
											? 'text-muted-foreground'
											: textClass[t]}">{words}</span
								>
							{/if}
							{#if s.state === 'skipped' && s.note}
								<span class="min-w-0 truncate text-sm text-muted-foreground" title={s.note}
									>· {s.note}</span
								>
							{:else if gist}
								<span class="min-w-0 truncate text-sm text-muted-foreground" title={gist}
									>· {gist}</span
								>
							{/if}
							{#if sec.at}<time
									class="tabular ml-auto shrink-0 text-xs text-muted-foreground"
									datetime={sec.at}
									title={ago(sec.at, live.now)}>{clock(sec.at)}</time
								>{/if}
							{#if s.state !== 'skipped'}<ChevronRight
									class="{sec.at
										? ''
										: 'ml-auto'} size-4 shrink-0 self-center text-muted-foreground transition-transform {open
										? 'rotate-90'
										: ''}"
									aria-hidden="true"
								/>{/if}
						</button>
						{#if open}
							<div id="stage-body-{s.key}" class="mt-4 space-y-5">
								{#if s.note}<p class="text-xs text-muted-foreground">
										<LinkedText text={s.note} />
									</p>{/if}
								{#each items as i, k (k)}
									{@const prev = items[k - 1]}
									{@render item(i, !prev || !worker(prev))}
								{/each}
								{#if strand === 'all' || strand === 'checks'}{@render evidence(s)}{/if}
								{#if sec === lastSection && now}{@render now()}{/if}
							</div>
						{/if}
					</div>
				</li>
			{/each}

			{#if tl.upcoming.length}
				<li class="flex items-start gap-4 text-sm text-muted-foreground" data-stage="upcoming">
					<span
						class="grid size-6 shrink-0 place-items-center rounded-full border border-dashed bg-background"
						><CircleDashed class="size-3.5" aria-hidden="true" /></span
					>
					<p class="pt-0.5 italic">
						Still to come: {tl.upcoming.map((s) => s.label).join(' · ')}
					</p>
				</li>
			{/if}
		</ol>
	</div>

	<!-- On a wide screen, the spare width holds the story's outline: jump to any stage. -->
	<nav class="hidden border-l xl:block" aria-label="Stages">
		<div class="sticky top-[6.25rem] p-5 text-sm">
			<p class="text-xs font-medium tracking-wide text-muted-foreground uppercase">On this page</p>
			<ol class="mt-3 space-y-2">
				<li>
					<button type="button" class="hover:underline" onclick={() => jump('stage-brief')}
						>Instructions</button
					>
				</li>
				{#each tl.sections as sec (sec.step.key)}
					<li class="flex items-baseline gap-2">
						<button
							type="button"
							class="truncate hover:underline {sec.step.state === 'current'
								? 'font-medium'
								: sec.step.state === 'skipped'
									? 'text-muted-foreground italic'
									: ''}"
							onclick={() => jump(`stage-${sec.step.key}`)}>{sec.step.label}</button
						>
						{#if sec.at}<span class="tabular ml-auto shrink-0 text-xs text-muted-foreground"
								>{clock(sec.at)}</span
							>{/if}
					</li>
				{/each}
				{#each tl.upcoming as s (s.key)}
					<li class="text-muted-foreground italic">{s.label}</li>
				{/each}
				{#if now}
					<li>
						<button
							type="button"
							class="inline-flex items-center gap-1.5 font-medium hover:underline"
							onclick={() => reveal('now')}
							><Sparkles class="size-3.5 text-success" aria-hidden="true" />Now</button
						>
					</li>
				{/if}
			</ol>
		</div>
	</nav>
</div>
