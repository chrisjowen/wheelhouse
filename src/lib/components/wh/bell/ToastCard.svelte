<script lang="ts">
	import { onMount } from 'svelte';
	import { Button } from '$lib/components/ui/button';
	import { Check, ExternalLink, X } from '@lucide/svelte';
	import { bell, kindLabel, type Toast } from '$lib/client/bell.svelte';
	import { alertTone, dotClass, textClass } from '../tone';

	let { toast, token }: { toast: Toast; token: string } = $props();
	const a = $derived(toast.alert);
	const tone = $derived(alertTone[a.kind]);

	/** News closes itself after this long (paused while the pointer or focus is on it). */
	const NEWS_MS = 9000;
	let timer: ReturnType<typeof setTimeout> | null = null;
	function hold() {
		if (timer) clearTimeout(timer);
		timer = null;
	}
	function release(ms = NEWS_MS) {
		hold();
		if (!a.captain) timer = setTimeout(() => bell.expire(a.id), ms);
	}
	onMount(() => {
		release();
		return hold;
	});
</script>

<!-- One alert on a solid card: what happened, to which task, and its one-tap actions. -->
<div
	class="pointer-events-auto relative overflow-hidden rounded-md border border-foreground/20 bg-card text-card-foreground shadow-[0_6px_18px_-6px_rgb(20_33_61/0.35)]"
	role={a.captain ? 'alert' : 'status'}
	onmouseenter={hold}
	onmouseleave={() => release(4000)}
	onfocusin={hold}
	onfocusout={() => release(4000)}
>
	<span class="absolute inset-y-0 left-0 w-1 {dotClass[tone]}" aria-hidden="true"></span>
	<div class="py-3 pr-3 pl-4">
		<div class="flex items-start gap-2">
			<div class="min-w-0 flex-1">
				<p class="text-xs font-semibold tracking-wide uppercase {textClass[tone]}">
					{kindLabel(a.kind)}{#if a.captain}<span
							class="ml-1 font-normal tracking-normal text-muted-foreground normal-case"
							>· waiting on you</span
						>{/if}
				</p>
				<p class="mt-0.5 font-display text-base leading-snug font-semibold">{a.title}</p>
				<p class="mt-1 text-sm leading-snug text-muted-foreground">{a.text}</p>
			</div>
			<Button
				variant="ghost"
				size="icon-xs"
				class="-mt-0.5 -mr-1 text-muted-foreground"
				aria-label="Dismiss"
				onclick={() => bell.dismiss(a)}><X /></Button
			>
		</div>
		<div class="mt-2.5 flex flex-wrap items-center gap-1.5">
			{#each a.actions as action, i (action.label)}
				{#if action.kind === 'note'}
					{@const note = bell.notes[action.requestId]}
					{#if note?.state === 'sent'}
						<span class="inline-flex h-7 items-center gap-1 px-1 text-xs font-medium text-success"
							><Check class="size-3.5" aria-hidden="true" />{action.sent}</span
						>
					{:else}
						<Button
							size="sm"
							class="h-7"
							variant={i === 0 ? 'default' : 'outline'}
							disabled={note?.state === 'sending' || !token}
							onclick={() => bell.act(action, token)}
							>{note?.state === 'sending'
								? 'Sending…'
								: note?.state === 'failed'
									? `Retry: ${action.label}`
									: action.label}</Button
						>
					{/if}
				{:else}
					<Button
						size="sm"
						class="h-7"
						variant={i === 0 ? 'default' : 'outline'}
						href={action.href}
						target={action.external ? '_blank' : undefined}
						rel={action.external ? 'noreferrer' : undefined}
						onclick={() => !action.external && bell.dismiss(a)}
						>{action.label}{#if action.external}<ExternalLink class="size-3" />{/if}</Button
					>
				{/if}
			{/each}
		</div>
		{#each a.actions as action (action.label)}
			{#if action.kind === 'note' && bell.notes[action.requestId]?.state === 'failed'}
				{@const n = bell.notes[action.requestId]}
				<p class="mt-1.5 text-xs text-danger">{n.state === 'failed' ? n.error : ''}</p>
			{/if}
		{/each}
	</div>
</div>
