<script lang="ts">
	/**
	 * The one in-progress indicator: a soft ring that pulses around the current
	 * step while the worker is busy. Still for paused, waiting or stale work,
	 * and still under prefers-reduced-motion.
	 */
	let { class: cls = '' }: { class?: string } = $props();
</script>

<span
	class="pointer-events-none absolute inset-0 rounded-full opacity-40 motion-safe:animate-ping {cls}"
	aria-hidden="true"
></span>
