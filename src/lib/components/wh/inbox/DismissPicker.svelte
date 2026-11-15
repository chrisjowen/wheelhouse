<script lang="ts">
	/**
	 * Why a decision is being dismissed, asked before it goes: one of the usual
	 * reasons or the captain's own words. Dismissing answers nothing; Firstmate
	 * records the decision closed with the reason, everywhere it is shown.
	 */
	import { X } from '@lucide/svelte';
	import { DISMISS_REASONS, NOTE_MAX } from '$lib/inbox';

	let {
		name,
		disabled = false,
		onDismiss,
		onCancel
	}: {
		/** Unique per decision, for the radio group. */
		name: string;
		disabled?: boolean;
		onDismiss: (reason: string | null) => void;
		onCancel: () => void;
	} = $props();

	const OWN = 'own';
	let picked = $state<string>(DISMISS_REASONS[0]);
	let own = $state('');
	const reason = $derived(picked === OWN ? own.trim() : picked);
</script>

<form
	class="mt-2 rounded-md border bg-background/60 px-3 py-2.5 text-sm"
	onsubmit={(e) => {
		e.preventDefault();
		if (!disabled && (picked !== OWN || reason)) onDismiss(reason || null);
	}}
	data-dismiss-picker
>
	<fieldset>
		<legend class="text-xs font-medium text-muted-foreground">
			Dismiss it without an answer. Why?
		</legend>
		<div class="mt-1.5 flex flex-wrap gap-1.5">
			{#each [...DISMISS_REASONS, OWN] as r (r)}
				<label
					class="inline-flex min-h-9 cursor-pointer items-center gap-1.5 rounded-full border px-2.5 text-xs transition-colors hover:bg-accent has-[:checked]:border-sea has-[:checked]:bg-sea/5 max-md:min-h-11"
				>
					<input
						type="radio"
						name="dismiss-{name}"
						value={r}
						checked={picked === r}
						onchange={() => (picked = r)}
						class="accent-sea"
					/>{r === OWN ? 'Another reason' : r}
				</label>
			{/each}
		</div>
	</fieldset>
	{#if picked === OWN}
		<input
			type="text"
			bind:value={own}
			maxlength={NOTE_MAX}
			placeholder="Why it is not needed"
			aria-label="Your reason for dismissing it"
			class="mt-2 block h-9 w-full rounded-md border border-input bg-background px-2.5 text-sm placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none max-md:h-11 max-md:text-base"
		/>
	{/if}
	<div class="mt-2 flex flex-wrap items-center gap-1.5">
		<button
			type="submit"
			class="inline-flex min-h-9 cursor-pointer items-center gap-1.5 rounded-md border px-3 text-sm font-medium transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50 max-md:min-h-11"
			disabled={disabled || (picked === OWN && !reason)}
			data-dismiss-confirm><X class="size-3.5" aria-hidden="true" />Dismiss it</button
		>
		<button
			type="button"
			class="inline-flex min-h-9 cursor-pointer items-center rounded-md px-2.5 text-sm text-muted-foreground hover:bg-accent hover:text-foreground max-md:min-h-11"
			onclick={onCancel}>Cancel</button
		>
		<span class="text-xs text-muted-foreground">Firstmate records it closed everywhere.</span>
	</div>
</form>
