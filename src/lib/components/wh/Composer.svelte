<script lang="ts">
	import { onMount } from 'svelte';
	import type { TaskSummary } from '$lib/types';
	import { Button } from '$lib/components/ui/button';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
	import { ArrowUp, ChevronDown, X } from '@lucide/svelte';

	let {
		tasks,
		taskId = $bindable(null),
		disabled = false,
		disabledReason = null,
		onSend
	}: {
		tasks: TaskSummary[];
		taskId?: string | null;
		disabled?: boolean;
		disabledReason?: string | null;
		onSend: (text: string, taskId: string | null) => void;
	} = $props();

	let text = $state('');
	let field: HTMLTextAreaElement | null = $state(null);
	let mac = $state(true);
	const MAX_HEIGHT = 200;

	onMount(() => {
		mac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
		if (taskId) field?.focus();
	});

	// Grow with the text up to a cap; past it the field scrolls without a scrollbar.
	$effect(() => {
		void text;
		if (!field) return;
		field.style.height = 'auto';
		field.style.height = `${Math.min(field.scrollHeight, MAX_HEIGHT)}px`;
	});

	const canSend = $derived(!disabled && text.trim().length > 0);
	// Tasks worth asking about first: live work, then queued, then landed.
	const ORDER: Record<string, number> = { landed: 2, queued: 1 };
	const choices = $derived(
		[...tasks].sort((a, b) => (ORDER[a.status] ?? 0) - (ORDER[b.status] ?? 0)).slice(0, 40)
	);

	function send() {
		if (!canSend) return;
		onSend(text.trim(), taskId);
		text = '';
		field?.focus();
	}

	function keydown(e: KeyboardEvent) {
		if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
			e.preventDefault();
			send();
		}
	}
</script>

<div
	class="rounded-2xl border bg-card shadow-xs transition-shadow focus-within:border-ring/60 focus-within:ring-3 focus-within:ring-ring/20"
>
	<label for="composer" class="sr-only">Message Firstmate</label>
	<textarea
		id="composer"
		bind:this={field}
		bind:value={text}
		onkeydown={keydown}
		rows="1"
		placeholder={disabled ? 'Messaging is unavailable' : 'Message Firstmate…'}
		{disabled}
		class="no-scrollbar block max-h-[200px] w-full resize-none bg-transparent px-4 pt-4 pb-2 text-[15px] leading-relaxed outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed"
	></textarea>
	<div class="flex items-center gap-2 px-2 pb-2">
		{#if taskId}
			<span
				class="inline-flex h-8 max-w-[60%] items-center gap-1.5 rounded-md bg-muted px-2.5 text-sm text-muted-foreground"
			>
				About <span class="truncate font-mono text-xs text-foreground">{taskId}</span>
				<button
					class="rounded-sm p-0.5 hover:bg-background hover:text-foreground"
					aria-label="Remove task context"
					onclick={() => (taskId = null)}><X class="size-3.5" /></button
				>
			</span>
		{:else}
			<DropdownMenu.Root>
				<DropdownMenu.Trigger {disabled}>
					{#snippet child({ props })}
						<Button
							{...props}
							variant="outline"
							size="sm"
							class="border-dashed font-normal text-muted-foreground"
							>Add task context<ChevronDown class="size-4" /></Button
						>
					{/snippet}
				</DropdownMenu.Trigger>
				<DropdownMenu.Content align="start" class="no-scrollbar max-h-72 w-72 overflow-y-auto">
					{#if !choices.length}
						<DropdownMenu.Item disabled>No tasks right now</DropdownMenu.Item>
					{/if}
					{#each choices as t (t.id)}
						<DropdownMenu.Item onSelect={() => (taskId = t.id)} class="flex-col items-start gap-0">
							<span class="w-full truncate">{t.title}</span>
							<span class="w-full truncate font-mono text-xs text-muted-foreground">{t.id}</span>
						</DropdownMenu.Item>
					{/each}
				</DropdownMenu.Content>
			</DropdownMenu.Root>
		{/if}
		<span class="ml-auto hidden items-center gap-1 text-xs text-muted-foreground sm:flex">
			<kbd class="rounded border bg-muted px-1.5 py-0.5 font-sans">{mac ? '⌘' : 'Ctrl'}</kbd>
			<kbd class="rounded border bg-muted px-1.5 py-0.5 font-sans">Enter</kbd>
		</span>
		<Button size="sm" onclick={send} disabled={!canSend} class="ml-auto sm:ml-0"
			><ArrowUp />Send</Button
		>
	</div>
</div>
{#if disabled && disabledReason}
	<p class="mt-2 text-xs text-danger">{disabledReason}</p>
{/if}
