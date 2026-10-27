<script lang="ts">
	import type { TaskSummary } from '$lib/types';
	import { live } from '$lib/client/live.svelte';
	import { agentLine, consoleInImage, nowLine, type ConsoleSample } from '$lib/card';
	import { showsChecks } from '$lib/checks';
	import { ago, plural } from '$lib/format';
	import { hintLine, roundLine } from '$lib/buildlog';
	import { changesLine, laterRun } from '$lib/changes';
	import ChecksStrip from './ChecksStrip.svelte';
	import ConsoleWindow from './ConsoleWindow.svelte';
	import EtaLine from './insights/EtaLine.svelte';
	import QuestionList from './QuestionList.svelte';
	import CardPreview from './CardPreview.svelte';
	import ShotStrip from './ShotStrip.svelte';
	import StageTrack from './StageTrack.svelte';
	import Thumb from './Thumb.svelte';
	import { Compass } from '@lucide/svelte';
	import { tone, textClass } from './tone';

	let { task, projectName = null }: { task: TaskSummary; projectName?: string | null } = $props();
	const t = $derived(tone(task));
	// Questions asked about the task and the docs its session referenced, in a few words.
	const hint = $derived(hintLine(task.build));
	// A variable, not a literal: Svelte trims the spaces of a bare " · " inside a block.
	const sep = ' · ';
	const files = $derived(
		task.filesChanged
			? `${task.filesChanged} ${plural(task.filesChanged, 'file', 'files')} changed`
			: null
	);
	// The review's latest questions to Firstmate, shown in place from the checks line or the hint.
	const round = $derived(task.build?.rounds[0] ?? null);
	let showQuestions = $state(false);
	const panelId = $derived(`questions-${task.id}`);
	const questions = $derived(
		round
			? {
					expanded: showQuestions,
					controls: panelId,
					toggle: () => (showQuestions = !showQuestions)
				}
			: null
	);
	// The checks line opens them only while it is about them: held for Firstmate, or answered.
	const lineAsks = $derived(
		!!round && (round.status === 'waiting' || !!task.pipeline?.answered || !!task.pipeline?.gate)
	);
	let sample = $state<ConsoleSample | null>(null);
	const showConsole = $derived(consoleInImage(task));
	const now = $derived(nowLine(task, showConsole ? sample : null, live.now));
	const who = $derived(
		agentLine(task.worker) ?? (task.status === 'queued' ? 'Not started' : 'Crew unknown')
	);
	// Trouble, Firstmate and changes-requested states lead with the state itself; the Now line says why.
	const lead = $derived(
		t === 'trouble' || t === 'firstmate' || task.addressingReview ? task.statusLabel : null
	);
	// The changes that started a later run, counted (the task page lists them).
	const run = $derived(laterRun(task));
	const changes = $derived(run ? changesLine(run.changes) : null);
	const age = $derived(
		!now?.at
			? null
			: now.source === 'console'
				? 'live'
				: now.source === 'pipeline'
					? `started ${ago(now.at, live.now)}`
					: ago(now.at, live.now)
	);
</script>

<!-- The whole card opens the task (its title link covers it); thumbnails and the preview sit above that. -->
<article
	class="group relative min-w-0 rounded-lg border bg-card p-3 transition-colors duration-200 hover:border-input hover:shadow-[0_1px_0_var(--hair)] has-[a[data-card-link]:focus-visible]:ring-3 has-[a[data-card-link]:focus-visible]:ring-ring/50"
>
	{#if showConsole}
		<ConsoleWindow {task} onsample={(s) => (sample = s)} class="rounded-sm" />
	{:else}
		<Thumb {task} class="rounded-sm" />
	{/if}
	<!-- The picture already shows the newest screenshot unless the live console replaced it. -->
	<ShotStrip
		shots={task.shots}
		total={task.screenshots}
		skip={!showConsole && task.thumb.kind === 'screenshot' ? 1 : 0}
	/>
	<div class="px-1 pt-4 pb-1">
		<p class="truncate text-xs text-muted-foreground" title={who}>
			{#if projectName}<span class="text-sea">{projectName}</span> ·
			{/if}{who}
		</p>
		<a
			href="/tasks/{encodeURIComponent(task.id)}"
			data-card-link
			class="mt-0.5 line-clamp-2 leading-snug font-medium group-hover:underline after:absolute after:inset-0 after:rounded-lg after:content-[''] focus-visible:outline-none"
			title={task.title}
		>
			{task.shortTitle}
		</a>
		{#if showsChecks(task)}
			<!-- In the checks stage the strip and its line say what is happening now. -->
			<div class="mt-2">
				<ChecksStrip
					pipeline={task.pipeline}
					busy={task.busy}
					{lead}
					leadClass={textClass[t]}
					questions={lineAsks ? questions : null}
				/>
			</div>
		{:else if now}
			<p
				class="mt-1 line-clamp-2 text-sm {lead ? textClass[t] : 'text-muted-foreground'}"
				data-now={now.source}
			>
				{#if lead}<span class="font-medium">{lead}.</span>{/if}
				<span class="font-medium {lead ? '' : 'text-foreground/80'}">Now:</span>
				{now.text}{#if age}<span class="text-muted-foreground">{` · ${age}`}</span>{/if}
			</p>
		{:else}
			<p
				class="mt-1 line-clamp-1 text-sm {lead ? textClass[t] : 'text-muted-foreground'}"
				title={task.summary ?? undefined}
			>
				{lead ?? task.summary ?? task.statusLabel}
			</p>
		{/if}
		<div class="mt-4"><StageTrack {task} /></div>
		{#if task.eta}<div class="mt-3"><EtaLine eta={task.eta} /></div>{/if}
		{#if files || hint}
			<p class="tabular mt-3 text-xs text-muted-foreground" data-build-hint={hint ? '' : undefined}>
				{#if files}{files}{/if}{#if files && hint?.questions}{sep}{/if}{#if hint?.questions}{#if questions}<button
							type="button"
							class="relative z-10 cursor-pointer underline decoration-muted-foreground/40 underline-offset-2 hover:text-foreground hover:decoration-foreground"
							aria-expanded={questions.expanded}
							aria-controls={panelId}
							onclick={questions.toggle}
							data-build-questions>{hint.questions}</button
						>{:else}<a
							href="/tasks/{encodeURIComponent(task.id)}?tab=talk"
							class="relative z-10 hover:text-foreground hover:underline"
							data-build-questions>{hint.questions}</a
						>{/if}{/if}{#if (files || hint?.questions) && hint?.docs}{sep}{/if}{#if hint?.docs}<a
						href="/tasks/{encodeURIComponent(task.id)}?tab=docs"
						class="relative z-10 hover:text-foreground hover:underline"
						data-build-docs>{hint.docs}</a
					>{/if}
			</p>
		{/if}
		{#if round && showQuestions}
			<section
				id={panelId}
				class="relative z-10 mt-3 rounded-md border border-hair bg-panel p-2.5"
				aria-label="Questions for Firstmate"
				data-card-questions
			>
				<p class="text-xs font-medium">Questions for Firstmate</p>
				<p class="mt-0.5 mb-2 text-xs text-muted-foreground">{roundLine(round, live.now)}</p>
				<QuestionList questions={round.questions} size="card" />
				<a
					href="/tasks/{encodeURIComponent(task.id)}?tab=talk"
					class="mt-2 inline-block text-xs text-muted-foreground hover:text-foreground hover:underline"
					>{task.build && task.build.rounds.length > 1
						? `Earlier questions are in the conversation`
						: 'Open the conversation'}</a
				>
			</section>
		{/if}
		{#if changes}
			<a
				href="/tasks/{encodeURIComponent(task.id)}"
				class="relative z-10 mt-3 block text-xs text-muted-foreground hover:text-foreground hover:underline"
				data-card-changes>Run {run?.n}: {changes}</a
			>
		{/if}
		{#if task.pr}
			<!-- The PR with the review agent's guide; opens the review page, not GitHub. -->
			<a
				href="/tasks/{encodeURIComponent(task.id)}/review"
				class="relative z-10 mt-3 inline-flex items-center gap-1.5 text-xs text-sea hover:underline"
				data-review-pr
				><Compass class="size-3.5" aria-hidden="true" />Review PR{task.pr.number
					? ` #${task.pr.number}`
					: ''}</a
			>
		{/if}
		{#if task.preview}<CardPreview {task} />{/if}
	</div>
</article>
