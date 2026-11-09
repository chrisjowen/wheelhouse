<script lang="ts">
	import { page } from '$app/state';
	import { currentFleet, live } from '$lib/client/live.svelte';
	import { inbox } from '$lib/client/inbox.svelte';
	import { previewChecks } from '$lib/client/previewchecks.svelte';
	import { pullRequests } from '$lib/client/pullrequests';
	import { agentLine } from '$lib/card';
	import { ago } from '$lib/format';
	import { etaLine } from '$lib/insights';
	import { plainStatus } from '$lib/plain';
	import { awaitingReview } from '$lib/review';
	import { prState } from '$lib/taskpage';
	import type { TaskDetail, TaskSummary } from '$lib/types';
	import { Button } from '$lib/components/ui/button';
	import { Compass, ExternalLink, MessageSquare, MonitorPlay, Timer } from '@lucide/svelte';
	import DocMentions from './DocMentions.svelte';
	import LinkedText from './LinkedText.svelte';
	import RawDetails from './RawDetails.svelte';
	import ReviewPanel from './ReviewPanel.svelte';
	import StageTrack from './StageTrack.svelte';
	import TaskDecisions from './inbox/TaskDecisions.svelte';
	import WhereBadge from './mates/WhereBadge.svelte';
	import { tone, textClass } from './tone';

	/**
	 * A task at a glance, as the task page's overview and the side panel
	 * (TaskSheet) both show it: its project and crew, title and state, what it
	 * is doing now, anything waiting on the captain or Firstmate, the review
	 * evidence while it waits on the captain, a small passage and the time
	 * left, its actions, and its pull request, preview, last check and
	 * delivery. `detail` (the task's evidence) may still be on its way; until
	 * then what needs it is left out. `onpreview` opens the live preview from
	 * the button pressed; `ontime` makes the time left a button that shows the
	 * task's time.
	 */
	let {
		task,
		detail,
		heading = 'h1',
		onpreview,
		ontime
	}: {
		task: TaskSummary;
		detail: TaskDetail | null;
		heading?: 'h1' | 'h2';
		onpreview?: (from: HTMLElement) => void;
		ontime?: () => void;
	} = $props();

	const ev = $derived(detail?.evidence ?? null);
	const shots = $derived(ev?.screenshots.available ? ev.screenshots.value : []);
	const project = $derived(currentFleet()?.projects.find((p) => p.id === task.projectId));
	const t = $derived(tone(task));
	// The project's plugin review tab while one is on, else the PR on GitHub.
	const prLink = $derived(task.pr ? pullRequests.review(task.projectId, task.pr) : null);
	const e = $derived(task.eta && !task.eta.openEnded ? task.eta : null);
</script>

<p class="mt-5 flex flex-wrap items-center gap-x-2 text-sm text-muted-foreground">
	<span
		>{project?.name ?? task.projectId}{agentLine(task.worker)
			? ` · ${agentLine(task.worker)}`
			: ''}</span
	>
	<WhereBadge {task} />
</p>
<svelte:element
	this={heading}
	class="mt-1 font-display text-[1.9rem] leading-tight font-medium text-balance"
	>{task.title}</svelte:element
>
<p
	class="mt-2 text-sm font-medium {t === 'normal' || t === 'landed'
		? 'text-muted-foreground'
		: textClass[t]}"
>
	{task.statusLabel}
</p>
{#if task.activity && !task.attention}
	<p class="mt-2 leading-relaxed" data-now={task.activity.source}>
		<span class="mr-1 text-muted-foreground">Now:</span><LinkedText
			text={task.activity.text}
		/>{#if task.activity.at}<span class="text-muted-foreground"
				>{` · ${task.activity.source === 'pipeline' ? 'started ' : ''}${ago(task.activity.at, live.now)}`}</span
			>{/if}
	</p>
	<DocMentions text={task.summaryRaw} shown={task.activity.text} />
	<RawDetails raw={task.summaryRaw} />
{:else if task.summary && !task.attention}
	<p class="mt-2 leading-relaxed">
		{#if task.summaryIsHistory}<span class="mr-1 text-muted-foreground">Latest update:</span
			>{/if}<LinkedText text={task.summary} />
	</p>
	<DocMentions text={task.summaryRaw} shown={task.summary} />
	<RawDetails raw={task.summaryRaw} />
{/if}

<!-- A decision shows as its decision box (TaskDecisions); without the inbox, as text. -->
{#if task.attention && !(task.attention.kind === 'decision' && inbox.hasDecision(task.id, page.data.inbox))}
	<div
		class="mt-5 rounded-xl p-4 {task.attention.owner === 'captain'
			? 'bg-sea/10'
			: task.attention.owner === 'reviewers'
				? 'bg-muted'
				: 'bg-warning/10'}"
	>
		<p
			class="text-sm font-medium {task.attention.owner === 'captain'
				? 'text-sea'
				: task.attention.owner === 'reviewers'
					? 'text-foreground'
					: 'text-warning'}"
		>
			{task.attention.owner === 'firstmate'
				? 'Waiting on Firstmate'
				: task.attention.owner === 'reviewers'
					? 'Waiting on reviewers'
					: task.attention.kind === 'review'
						? task.attention.approved
							? 'Ready for you to merge'
							: 'Ready for your review'
						: 'Your decision is needed'}
		</p>
		<p class="mt-1 text-sm leading-relaxed whitespace-pre-line">
			<LinkedText text={task.attention.text} />
		</p>
		{#if task.attention.owner === 'firstmate'}<DocMentions
				text={task.summaryRaw}
				shown={task.attention.text}
			/><RawDetails raw={task.summaryRaw} />{/if}
		{#if ev && ev.decisions.length > 1}
			<ul class="mt-2 list-disc space-y-1 pl-5 text-sm">
				{#each ev.decisions.slice(1) as d, i (i)}
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

<TaskDecisions {task} now={live.now} />

{#if awaitingReview(task)}
	<!-- The review evidence comes first while the work waits on the captain. -->
	<div class="mt-5"><ReviewPanel {task} {shots} /></div>
{/if}

<div class="mt-6">
	<StageTrack {task} />
</div>
{#if e}
	{@const l = etaLine(e)}
	{#if ontime}
		<button
			type="button"
			class="mt-4 flex items-center gap-2 text-left text-sm hover:underline {l.tone === 'warning'
				? 'text-warning'
				: 'text-muted-foreground'}"
			onclick={ontime}><Timer class="size-4 shrink-0" aria-hidden="true" />{l.text}</button
		>
	{:else}
		<p
			class="mt-4 flex items-center gap-2 text-sm {l.tone === 'warning'
				? 'text-warning'
				: 'text-muted-foreground'}"
		>
			<Timer class="size-4 shrink-0" aria-hidden="true" />{l.text}
		</p>
	{/if}
{/if}

<div class="mt-6 flex flex-wrap gap-2">
	{#if task.preview && onpreview}
		<Button
			variant={task.attention?.owner === 'captain' && !task.pr ? 'default' : 'outline'}
			onclick={(ev: MouseEvent) => onpreview(ev.currentTarget as HTMLElement)}
			data-open-preview><MonitorPlay />Live preview</Button
		>
	{/if}
	{#if task.passage.link && task.passage.link.url !== task.preview?.url && !awaitingReview(task)}
		<!-- The current step's declared link, e.g. the live site once Deployed. -->
		<Button variant="outline" href={task.passage.link.url} target="_blank" rel="noreferrer"
			>{task.passage.link.label}<ExternalLink /></Button
		>
	{/if}
	{#if prLink}
		<!-- A plugin's review tab while one is on for the project, else the PR on GitHub. -->
		<Button
			variant="outline"
			href={prLink.href}
			target={prLink.external ? '_blank' : undefined}
			rel={prLink.external ? 'noreferrer' : undefined}
			data-review-pr
			><Compass />Review the pull request{#if prLink.external}<ExternalLink />{/if}</Button
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
				{#if ev?.pr.available}<span class="text-muted-foreground"
						>{prState(ev.pr.value.state, ev.pr.value.draft)}</span
					>{/if}
			{:else}<span class="text-muted-foreground">None yet</span>{/if}
		</dd>
	</div>
	<div>
		<dt class="text-muted-foreground">Preview</dt>
		<dd>
			{#if task.preview && previewChecks.stopped(task.id)}<span
					class="text-muted-foreground"
					data-preview-stopped>Stopped; reported {ago(task.preview.reportedAt, live.now)}</span
				>
			{:else if task.preview}<a
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
