<script lang="ts">
	import { AudioLines, ChevronRight, FileText } from '@lucide/svelte';
	import { markdown } from '$lib/chat/markdown';
	import { briefKey } from '$lib/live/briefing';
	import { keptDiscussion } from '$lib/client/livecall.svelte';

	/**
	 * A Captain's briefing from Live mode as the chat shows it: the one thing a
	 * call leaves in the chat, sent to Firstmate the moment the call ended.
	 * When this browser kept the discussion behind it, "Show the discussion"
	 * opens it under the briefing, what the captain and the crew said in turn.
	 */
	let { minutes, body }: { minutes: number; body: string } = $props();

	const lines = $derived(keptDiscussion(briefKey(body)));
	let open = $state(false);
	const time = (iso: string) =>
		new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
</script>

<div
	class="w-full max-w-[min(100%,44rem)] overflow-hidden rounded-xl border border-sea/45 bg-card text-left"
	data-live-brief-message
>
	<div
		class="flex items-center gap-2 border-b border-sea/25 bg-sea/10 px-4 py-2.5 text-sm font-semibold text-sea"
	>
		<FileText class="size-4" aria-hidden="true" />Captain’s briefing · from Live mode
		<span class="ml-auto font-mono text-[0.7rem] font-normal">{minutes} min</span>
	</div>
	<div class="chat-md bg-paper px-5 py-4 font-reading text-ink">
		<!-- eslint-disable-next-line svelte/no-at-html-tags -- sanitised by DOMPurify in markdown() -->
		{@html markdown(body)}
	</div>
	{#if lines?.length}
		<div class="border-t border-hair px-4 py-2">
			<button
				type="button"
				class="flex cursor-pointer items-center gap-1.5 text-xs font-medium text-sea hover:underline"
				aria-expanded={open}
				onclick={() => (open = !open)}
				data-live-show-discussion
				><ChevronRight
					class="size-3.5 transition-transform {open ? 'rotate-90' : ''}"
					aria-hidden="true"
				/>{open ? 'Hide the discussion' : 'Show the discussion'}</button
			>
			{#if open}
				<ol class="mt-2 grid gap-2.5 pb-1 text-sm" aria-label="The discussion" data-live-discussion>
					{#each lines as l, i (i)}
						<li class="flex gap-2.5">
							{#if l.who === 'captain'}<span class="captain-avatar mt-0.5 !size-5 !text-[0.7rem]"
									>C</span
								>{:else}<span
									class="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border border-brass bg-sea/10 text-sea"
									><AudioLines class="size-3" aria-hidden="true" /></span
								>{/if}
							<div class="min-w-0 flex-1">
								<p class="text-xs text-muted-foreground">
									<span class="font-medium text-foreground"
										>{l.who === 'captain' ? 'You' : 'Discussion crew'}</span
									>
									· {time(l.at)}
								</p>
								{#if l.who === 'crew'}
									<div class="chat-md mt-0.5">
										<!-- eslint-disable-next-line svelte/no-at-html-tags -- sanitised by DOMPurify in markdown() -->
										{@html markdown(l.text)}
									</div>
								{:else}
									<p class="mt-0.5 leading-relaxed whitespace-pre-line">{l.text}</p>
								{/if}
							</div>
						</li>
					{/each}
				</ol>
			{/if}
		</div>
	{/if}
</div>
