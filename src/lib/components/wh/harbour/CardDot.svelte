<script lang="ts">
	import type { CardTone } from '$lib/harbourboard';

	/** A board card's state dot: gold for the captain, blue at work, red in trouble, teal landed. */
	let { tone }: { tone: CardTone } = $props();

	const TONES: Record<CardTone, string> = {
		you: 'bg-gold',
		working: 'bg-working motion-safe:animate-pulse',
		trouble: 'bg-danger',
		landed: 'bg-teal',
		quiet: 'border-[1.5px] border-muted-foreground'
	};
</script>

<span class="inline-block size-[7px] shrink-0 rounded-full {TONES[tone]}" aria-hidden="true"></span>
