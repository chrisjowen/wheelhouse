<script lang="ts">
	/**
	 * A feedback list the captain sent from a task's Preview tab, or from a
	 * plugin with the feedback capability, in the chat: the captain's own card,
	 * addressed to Firstmate, with each line and what it points at, whether
	 * Firstmate has seen it, what came of it on the task (the run that took it
	 * up, with a link to it), and its reply (lib/chat/batches.ts).
	 */
	import {
		ArrowRight,
		CircleCheck,
		CircleX,
		LoaderCircle,
		MonitorPlay,
		Puzzle
	} from '@lucide/svelte';
	import { actedOn, type ChatBatch } from '$lib/chat/batches';
	import type { TaskRuns } from '$lib/types';

	let {
		batch,
		project = null,
		runs = null
	}: { batch: ChatBatch; project?: string | null; runs?: TaskRuns | null } = $props();

	const time = (at: string) =>
		new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
	const waiting = $derived(!batch.failed && !batch.seen && batch.status !== 'Sent to Firstmate');
	const from = $derived(batch.batch.plugin);
	const label = $derived(
		from ? `${from.name} feedback` : batch.batch.live ? 'live review' : 'preview feedback'
	);
	const acted = $derived(actedOn(batch.id, runs));
	const taskHref = $derived(`/tasks/${encodeURIComponent(batch.batch.taskId)}`);
</script>

<article class="msg msg-captain" aria-label="Your {label}, {time(batch.at)}" data-feedback-batch>
	<span class="captain-avatar">C</span>
	<div class="min-w-0 flex-1">
		<header class="msg-head">
			<span class="msg-name">You</span><time datetime={batch.at}>{time(batch.at)}</time>
		</header>
		<div
			class="w-full max-w-[34rem] rounded-lg border border-l-[3px] border-l-sea bg-card px-4 py-3 text-left"
		>
			<header class="flex flex-wrap items-center gap-x-2 gap-y-1">
				<span
					class="flex items-center gap-1 rounded bg-sea/10 px-1.5 text-xs leading-[1.15rem] font-medium text-sea"
					>{#if from}<Puzzle class="size-3" aria-hidden="true" />{:else}<MonitorPlay
							class="size-3"
							aria-hidden="true"
						/>{/if}To Firstmate · {label}</span
				>
				{#if project}
					<span
						class="rounded-sm border px-1.5 text-[0.95rem] leading-[1.15rem] font-semibold tracking-[0.08em] text-muted-foreground [font-variant-caps:all-small-caps]"
						>{project}</span
					>
				{/if}
			</header>
			<a
				href="{taskHref}{from ? '' : '?tab=preview'}"
				class="mt-1.5 block text-sm font-medium hover:underline">{batch.batch.title}</a
			>
			{#if from?.subject}
				<p class="mt-0.5 text-xs text-muted-foreground">About {from.subject}</p>
			{/if}
			<ol class="mt-2 list-decimal space-y-1.5 pl-5 text-sm leading-snug">
				{#each batch.batch.items as it, i (i)}
					<li>
						{it.text}
						{#if it.points}<span class="mt-0.5 block text-xs text-muted-foreground"
								>Points at {it.points}</span
							>{/if}
					</li>
				{/each}
			</ol>
			<p
				class="mt-2.5 flex items-center gap-1.5 text-xs {batch.failed
					? 'text-danger'
					: 'text-muted-foreground'}"
				role="status"
			>
				{#if batch.failed}<CircleX
						class="size-3.5"
						aria-hidden="true"
					/>{:else if waiting}<LoaderCircle
						class="size-3 animate-spin"
						aria-hidden="true"
					/>{:else}<CircleCheck
						class="size-3.5 text-success"
						aria-hidden="true"
					/>{/if}{batch.status}
			</p>
			{#if acted}
				<p class="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground" data-feedback-acted>
					<ArrowRight class="size-3.5 text-sea" aria-hidden="true" />
					<a href={taskHref} class="text-sea hover:underline"
						>{acted.addressed
							? `Addressed by the worker in run ${acted.run}`
							: `With the worker · run ${acted.run}`}</a
					>
				</p>
			{/if}
			{#if batch.reply}
				<p class="mt-2 rounded-md bg-muted px-3 py-2 text-sm leading-relaxed whitespace-pre-line">
					<span class="font-medium">Firstmate:</span>
					{batch.reply}
				</p>
			{/if}
		</div>
	</div>
</article>
