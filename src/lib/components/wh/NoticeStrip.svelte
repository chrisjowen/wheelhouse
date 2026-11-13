<script lang="ts">
	import { ChevronDown } from '@lucide/svelte';
	import { noticeSummary, type Notice, type NoticeTone } from '$lib/notices';

	/**
	 * One slim line under the header for whatever Wheelhouse cannot currently
	 * see, worst first. It opens to say each in a sentence, closed at first, and
	 * is gone once everything clears.
	 */
	let { items }: { items: Notice[] } = $props();

	let open = $state(false);
	// Gone means gone: the next trouble starts closed again.
	$effect(() => {
		if (!items.length) open = false;
	});

	const band: Record<NoticeTone, string> = {
		danger: 'bg-danger/10',
		warning: 'bg-warning/10',
		quiet: 'bg-muted/60'
	};
	const dot: Record<NoticeTone, string> = {
		danger: 'bg-danger',
		warning: 'bg-warning',
		quiet: 'bg-muted-foreground'
	};
	const worst = $derived(items[0]);
</script>

<!-- Honest strip: what Wheelhouse cannot currently see, said plainly. -->
<div aria-live="polite">
	{#if worst}
		<div class="border-b {band[worst.tone]}" data-notice-strip>
			<button
				type="button"
				class="flex min-h-9 w-full items-center gap-2.5 px-4 py-1.5 text-left text-sm sm:px-6 lg:px-10"
				aria-expanded={open}
				aria-controls="wh-notices"
				onclick={() => (open = !open)}
			>
				<span class="size-2 shrink-0 rounded-full {dot[worst.tone]}" aria-hidden="true"></span>
				<span class="min-w-0 flex-1 truncate font-medium">{noticeSummary(items)}</span>
				<span class="shrink-0 text-xs text-muted-foreground max-sm:hidden"
					>{open ? 'Hide' : 'Details'}</span
				>
				<ChevronDown
					class="size-4 shrink-0 text-muted-foreground transition-transform {open
						? 'rotate-180'
						: ''}"
					aria-hidden="true"
				/>
			</button>
			<ul id="wh-notices" class="space-y-1.5 px-4 pb-2.5 text-sm sm:px-6 lg:px-10" hidden={!open}>
				{#each items as n (n.key)}
					<li class="flex gap-2.5" data-notice={n.key}>
						<span
							class="mt-[0.45rem] size-1.5 shrink-0 rounded-full {dot[n.tone]}"
							aria-hidden="true"
						></span>
						<span class="min-w-0"
							><span class="font-medium">{n.title}.</span>
							<span class="text-muted-foreground">{n.text}</span></span
						>
					</li>
				{/each}
			</ul>
		</div>
	{/if}
</div>
