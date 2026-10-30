<script lang="ts">
	import { AlertTriangle, Check } from '@lucide/svelte';

	/**
	 * What came of a change on a Plugins page, at the foot of the screen for a
	 * few seconds: saved (and whether it needs a restart), or why it was not.
	 */
	let { note }: { note: { text: string; ok: boolean } | null } = $props();
</script>

<div
	class="pointer-events-none fixed right-4 bottom-4 left-4 z-50 flex justify-end"
	aria-live="polite"
>
	{#if note}
		<p
			class="pointer-events-auto flex max-w-md items-start gap-2 rounded-md border bg-card px-4 py-2.5 text-sm shadow-lg"
			role={note.ok ? 'status' : 'alert'}
		>
			{#if note.ok}<Check class="mt-0.5 size-4 shrink-0 text-success" />{:else}<AlertTriangle
					class="mt-0.5 size-4 shrink-0 text-danger"
				/>{/if}<span>{note.text}</span>
		</p>
	{/if}
</div>
