<!-- PROTOTYPE: the project's state in one word, with an icon so it never rests on colour alone. -->
<script lang="ts">
	import { HEALTH_WORDS, type Health } from './prototype-data';
	import { Anchor, CircleDot, Hand, Sprout, TriangleAlert } from '@lucide/svelte';

	let { health, size = 'md' }: { health: Health; size?: 'sm' | 'md' } = $props();

	const ICONS = {
		'needs-you': Hand,
		'held-up': TriangleAlert,
		'under-way': CircleDot,
		quiet: Anchor,
		new: Sprout
	};
	const TONE = {
		'needs-you': 'text-sea border-sea/40 bg-sea/10',
		'held-up': 'text-danger border-danger/40 bg-danger/10',
		'under-way': 'text-foreground border-hair bg-muted/60',
		quiet: 'text-muted-foreground border-hair bg-transparent',
		new: 'text-success border-success/40 bg-success/10'
	};
	const Icon = $derived(ICONS[health]);
</script>

<span
	class="inline-flex shrink-0 items-center gap-1.5 rounded-full border font-medium whitespace-nowrap {TONE[
		health
	]} {size === 'sm' ? 'px-2 py-0 text-xs' : 'px-2.5 py-0.5 text-xs'}"
>
	<Icon class="size-3.5" aria-hidden="true" />{HEALTH_WORDS[health]}
</span>
