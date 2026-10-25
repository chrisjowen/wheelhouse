<script lang="ts">
	import { Check, LoaderCircle, MessageCircleQuestion, SquareTerminal } from '@lucide/svelte';
	import { act } from '$lib/client/chat.svelte';
	import type { Picker } from '$lib/types';

	/**
	 * A menu Claude Code is waiting on in the Firstmate session - its question
	 * picker or a permission prompt - as buttons. Each choice is pressed by the
	 * server into that same menu (it checks the menu is still on screen); the
	 * card follows the screen, so a multi-question picker moves on by itself.
	 * Answers that need typing go through the terminal.
	 */
	let { picker, token, onterminal }: { picker: Picker; token: string; onterminal: () => void } =
		$props();

	let busy = $state(false);
	let error = $state<string | null>(null);

	async function choose(body: { press: number } | { submit: true }) {
		busy = true;
		error = null;
		const r = await act('/api/firstmate/pick', token, { signature: picker.signature, ...body });
		busy = false;
		if (!r.ok) error = r.error;
	}
</script>

<div
	class="max-w-[80ch] rounded-lg border border-t-2 border-t-sea bg-card p-4"
	role="group"
	aria-label="Firstmate is asking you"
>
	<p class="mb-2 flex items-center gap-2 font-display text-[1.15rem] font-medium">
		<MessageCircleQuestion class="size-4 text-sea" aria-hidden="true" />Firstmate is asking you
		{#if busy}<LoaderCircle class="size-4 animate-spin text-sea" aria-label="Sending" />{/if}
	</p>
	{#if picker.tabs.length > 1}
		<div class="mb-3 flex flex-wrap gap-1.5 text-xs">
			{#each picker.tabs as tab (tab.label)}
				<span
					class="flex items-center gap-1 rounded border px-1.5 py-0.5 {tab.done
						? 'text-muted-foreground'
						: 'border-sea/50 text-foreground'}"
					>{#if tab.done}<Check class="size-3" aria-label="Answered" />{/if}{tab.label}</span
				>
			{/each}
		</div>
	{/if}
	{#if picker.title}<p class="mb-3 text-[15px] whitespace-pre-line">{picker.title}</p>{/if}
	<div class="flex flex-col gap-1.5">
		{#each picker.options as o (o.n)}
			{#if o.freeText}
				<button
					class="flex w-full cursor-pointer items-center gap-3 rounded-lg border border-dashed bg-background px-3 py-2 text-left text-sm text-muted-foreground hover:border-sea/60"
					onclick={onterminal}
				>
					<SquareTerminal class="size-4 shrink-0" aria-hidden="true" />
					<span>Type an answer in Firstmate’s terminal</span>
				</button>
			{:else}
				<button
					class="flex w-full cursor-pointer items-start gap-3 rounded-lg border px-3 py-2 text-left text-sm transition-colors disabled:cursor-default {o.checked
						? 'border-sea bg-sea/10'
						: 'bg-background hover:border-sea/60'}"
					disabled={busy}
					aria-pressed={o.checked === null ? undefined : o.checked}
					onclick={() => choose({ press: o.n })}
				>
					<span class="tabular w-4 shrink-0 text-muted-foreground">
						{#if o.checked}<Check class="size-4 text-sea" aria-label="Chosen" />{:else}{o.n}{/if}
					</span>
					<span class="min-w-0">
						<span class="font-medium">{o.label}</span>
						{#if o.description}<span class="block text-xs text-muted-foreground"
								>{o.description}</span
							>{/if}
					</span>
				</button>
			{/if}
		{/each}
	</div>
	<div class="mt-3 flex flex-wrap items-center gap-3 text-sm">
		{#if picker.multiSelect && picker.submitMoves !== null}
			<button
				class="cursor-pointer rounded-lg bg-foreground px-3 py-1.5 font-medium text-background disabled:opacity-40"
				disabled={busy || !picker.options.some((o) => o.checked)}
				onclick={() => choose({ submit: true })}>Done</button
			>
		{/if}
		<button
			class="flex cursor-pointer items-center gap-1.5 text-muted-foreground hover:text-foreground"
			onclick={onterminal}
			><SquareTerminal class="size-4" aria-hidden="true" />Answer in the terminal instead</button
		>
		{#if error}<p class="w-full text-danger" role="alert">{error}</p>{/if}
	</div>
</div>
