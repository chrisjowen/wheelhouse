<script lang="ts">
	import { Popover } from 'bits-ui';
	import { Check, Plus } from '@lucide/svelte';
	import { slugify, UNSORTED, type Tag } from '$lib/chat/topics';

	/**
	 * A message's or card's thread, as a small tag in the thread's hue, saying
	 * where it came from when that is worth knowing (a guess, or the captain's
	 * own move). Clicking it moves the message to another thread, or a new
	 * topic, remembered in this browser (lib/client/chattags.svelte.ts).
	 */
	let {
		tag,
		threads,
		onMove
	}: {
		tag: Tag;
		/** Every thread it can move to, with its name and hue (null for Unsorted). */
		threads: { topic: string; name: string; hue: number | null }[];
		onMove: (topic: string) => void;
	} = $props();

	const SOURCE: Record<string, string> = {
		marker: 'Firstmate filed this here',
		decision: 'The decision’s project',
		task: 'The task’s project',
		thread: 'Sent in this thread',
		you: 'You moved this here',
		guess: 'A guess from what it names'
	};

	const me = $derived(
		threads.find((t) => t.topic === tag.topic) ?? { topic: tag.topic, name: tag.topic, hue: null }
	);
	let open = $state(false);
	let fresh = $state('');

	function move(topic: string) {
		open = false;
		fresh = '';
		if (topic && topic !== tag.topic) onMove(topic);
	}
</script>

<Popover.Root bind:open>
	<Popover.Trigger>
		{#snippet child({ props })}
			<button
				{...props}
				class="thread-tag touch-target"
				data-hue={me.hue ?? undefined}
				data-unsorted={tag.topic === UNSORTED ? '' : undefined}
				data-source={tag.source ?? undefined}
				title="{tag.source ? SOURCE[tag.source] : 'Not filed under a thread'}. Click to move it."
				aria-label="Thread: {me.name}{tag.source === 'guess' ? ' (a guess)' : ''}. Move it"
				><span class="thread-tag-name">{me.name}</span>{#if tag.source === 'guess'}<span
						class="thread-tag-src">· guess</span
					>{:else if tag.source === 'you'}<span class="thread-tag-src">· moved</span>{/if}</button
			>
		{/snippet}
	</Popover.Trigger>
	<Popover.Portal>
		<Popover.Content
			align="start"
			sideOffset={4}
			class="z-50 w-60 max-w-[calc(100vw-2rem)] rounded-md bg-popover p-1.5 text-sm text-popover-foreground shadow-md ring-1 ring-foreground/10"
		>
			<p class="px-2 pt-1 pb-1.5 text-xs text-muted-foreground">Move to thread</p>
			<div class="no-scrollbar max-h-64 overflow-y-auto">
				{#each threads as t (t.topic)}
					<button
						class="flex w-full cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-left hover:bg-muted pointer-coarse:min-h-11"
						onclick={() => move(t.topic)}
					>
						<span class="thread-dot" data-hue={t.hue ?? undefined} aria-hidden="true"></span>
						<span class="min-w-0 flex-1 truncate">{t.name}</span>
						{#if t.topic === tag.topic}<Check class="size-3.5 text-muted-foreground" />{/if}
					</button>
				{/each}
			</div>
			<form
				class="mt-1 flex items-center gap-1.5 border-t px-1 pt-1.5"
				onsubmit={(e) => {
					e.preventDefault();
					move(slugify(fresh));
				}}
			>
				<Plus class="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
				<input
					class="min-w-0 flex-1 bg-transparent py-1 text-sm outline-none placeholder:text-muted-foreground"
					placeholder="New topic…"
					aria-label="New topic"
					bind:value={fresh}
				/>
			</form>
		</Popover.Content>
	</Popover.Portal>
</Popover.Root>
