<script lang="ts">
	import type { CardTone } from '$lib/harbourboard';

	/**
	 * A task as a small ship under sail, bound for the finish on the right: gold for the
	 * captain, blue at work, red in trouble, teal landed; a quiet one is drawn in outline.
	 * Every ship afloat rides a gentle swell, one at work a little livelier; a landed one is
	 * moored and still.
	 */
	let {
		tone,
		class: cls = 'h-3 w-3.5',
		delay = 0
	}: {
		tone: CardTone;
		class?: string;
		/** Where in the swell it starts, in ms (negative), so ships never bob in step. */
		delay?: number;
	} = $props();

	const TONES: Record<CardTone, string> = {
		you: 'text-gold motion-safe:animate-[wh-swell_4.5s_ease-in-out_infinite]',
		working: 'text-working motion-safe:animate-[wh-swell_2.6s_ease-in-out_infinite]',
		trouble: 'text-danger motion-safe:animate-[wh-swell_5.5s_ease-in-out_infinite]',
		landed: 'text-teal',
		quiet: 'text-muted-foreground motion-safe:animate-[wh-swell_5s_ease-in-out_infinite]'
	};
</script>

<svg
	viewBox="0 0 16 14"
	class="shrink-0 overflow-visible {TONES[tone]} {cls}"
	aria-hidden="true"
	style="animation-delay: {delay}ms"
	data-vessel-tone={tone}
>
	<g
		fill={tone === 'quiet' ? 'none' : 'currentColor'}
		stroke="currentColor"
		stroke-width={tone === 'quiet' ? 1.2 : 0.6}
		stroke-linejoin="round"
	>
		<path d="M7.2 0.8 L13.6 9 H7.2 Z" />
		<path d="M5.8 3 V9 H2.2 Z" />
		<path d="M0.8 10.4 H15.2 L12.6 13.2 H3.2 Z" />
	</g>
</svg>
