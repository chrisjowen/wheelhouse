<script lang="ts">
	import { STATE_WORDS, type ProjectState } from '$lib/berths';
	import { Anchor, CircleDot, Hand, TriangleAlert } from '@lucide/svelte';

	/** A project's state in one word, with an icon so it never rests on colour alone. */
	let { state }: { state: ProjectState } = $props();

	const ICONS = {
		'needs-you': Hand,
		'held-up': TriangleAlert,
		'under-way': CircleDot,
		quiet: Anchor
	};
	const TONE: Record<ProjectState, string> = {
		'needs-you': 'border-sea/40 bg-sea/10 text-sea',
		'held-up': 'border-danger/40 bg-danger/10 text-danger',
		'under-way': 'border-hair bg-muted/60 text-foreground',
		quiet: 'border-hair text-muted-foreground'
	};
	const Icon = $derived(ICONS[state]);
</script>

<span
	class="inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium whitespace-nowrap {TONE[
		state
	]}"
>
	<Icon class="size-3.5" aria-hidden="true" />{STATE_WORDS[state]}
</span>
