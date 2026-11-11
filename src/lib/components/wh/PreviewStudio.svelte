<script lang="ts">
	import { onMount } from 'svelte';
	import type { Pointer } from '$lib/previewhelper';
	import { zoom, type Box } from '$lib/motion';
	import { addressRewrites } from '$lib/client/addresses.svelte';
	import { currentFleet } from '$lib/client/live.svelte';
	import { phone } from '$lib/client/phone.svelte';
	import { previewChecks, urlKey } from '$lib/client/previewchecks.svelte';
	import type { PreviewContext } from '$lib/plugins/types';
	import {
		ExternalLink,
		MessageSquare,
		Monitor,
		PanelRightClose,
		RotateCw,
		Smartphone,
		X
	} from '@lucide/svelte';
	import LivePreview from './LivePreview.svelte';
	import PreviewHelper from './PreviewHelper.svelte';
	import PreviewActions from './plugins/PreviewActions.svelte';

	/**
	 * A task's live preview full screen: the page on the left, the preview
	 * helper on the right, to talk it through and build the feedback list that
	 * goes to Firstmate as one message (PreviewHelper). The conversation and
	 * list are the same as on the task page's Preview tab.
	 *
	 * The helper sits beside the page rather than floating over it: a panel over
	 * the page hides the very part being talked about and reads as one more
	 * layer, while a docked panel never covers the page and folds away to give
	 * it the full width. `talk={false}` (work that has landed) leaves it out.
	 * `from` is where it was opened from (a thumbnail, a button): it grows out
	 * of that place and shrinks back into it when closed. A preview no task
	 * reported (`taskId` null: one Firstmate linked, a review board) has no
	 * helper: there is no worker to send its feedback to.
	 *
	 * On a phone the page takes the whole screen, under a bar with Close, the
	 * title and address, and Reload. A dock at the foot, in reach of a thumb,
	 * switches the page between the phone's width and a desktop's (scaled to
	 * fit), opens it in a new tab, opens the helper, and holds plugins'
	 * preview actions (Share for review). The helper rises over the page as a
	 * sheet, closed at first, and steps aside while the captain points.
	 */
	let {
		taskId,
		title,
		url,
		talk = true,
		board = false,
		from = null,
		onclose
	}: {
		taskId: string | null;
		title: string;
		url: string;
		talk?: boolean;
		/** Whether it is a review board, for plugins' preview actions. */
		board?: boolean;
		from?: Box | null;
		onclose: () => void;
	} = $props();

	const helper = $derived(talk && !!taskId);
	// On a phone the helper would cover the page, so it waits to be asked for.
	let panel = $state(!phone.current);
	// On a phone, the page drawn at a desktop's width instead of the phone's.
	let wide = $state(false);
	let preview = $state<ReturnType<typeof LivePreview> | null>(null);

	// What the page's check found, for the phone's bar and dock: whether it answers, and its
	// address as checked (a remote preview's forward), as this browser reaches it (LivePreview).
	const check = $derived(previewChecks.checks[taskId ?? urlKey(url)] ?? null);
	const live = $derived(check?.state === 'live');
	const shown = $derived(addressRewrites.view(check?.url ?? url));
	const address = $derived(URL.parse(shown)?.host ?? shown);
	const action = $derived<PreviewContext | null>(
		live && check?.url
			? {
					url: check.url,
					taskId,
					title,
					projectId: taskId
						? (currentFleet()?.tasks.find((t) => t.id === taskId)?.projectId ?? null)
						: null,
					board
				}
			: null
	);
	let pointing = $state(false);
	let pointed = $state<{ pointer: Pointer; at: { x: number; y: number } } | null>(null);
	let dialog = $state<HTMLElement | null>(null);

	onMount(() => {
		const before = document.activeElement as HTMLElement | null;
		const overflow = document.body.style.overflow;
		document.body.style.overflow = 'hidden';
		dialog?.focus();
		return () => {
			document.body.style.overflow = overflow;
			before?.focus?.();
		};
	});

	function onkeydown(e: KeyboardEvent) {
		if (e.key !== 'Escape') return;
		// Esc while pointing stops pointing; in a half-written message it clears focus first.
		if (pointing) {
			e.preventDefault();
			pointing = false;
			return;
		}
		const el = e.target as HTMLElement;
		if (el instanceof HTMLTextAreaElement && el.value.trim()) {
			el.blur();
			return;
		}
		e.preventDefault();
		onclose();
	}
</script>

<svelte:window {onkeydown} />

<div
	bind:this={dialog}
	class="fixed inset-0 z-50 flex flex-col bg-background outline-none"
	role="dialog"
	aria-modal="true"
	aria-label="Live preview of {title}, full screen"
	tabindex="-1"
	data-preview-studio
	transition:zoom={{ from }}
>
	<div class="flex h-12 shrink-0 items-center gap-3 border-b px-3 max-md:hidden sm:px-4">
		<p class="min-w-0 flex-1 truncate text-sm">
			<span class="font-medium">{title}</span>
			<span class="text-muted-foreground">· Live preview</span>
		</p>
		{#if helper && panel}
			<button
				type="button"
				class="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
				onclick={() => (panel = false)}
				><PanelRightClose class="size-4" aria-hidden="true" />Hide the helper</button
			>
		{/if}
		<button
			type="button"
			class="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs hover:bg-accent"
			onclick={onclose}
			aria-label="Close full screen (Esc)"
			title="Close (Esc)"><X class="size-4" aria-hidden="true" />Close</button
		>
	</div>

	<div
		class="flex shrink-0 items-center gap-1 border-b px-1 pt-[env(safe-area-inset-top,0px)] md:hidden"
		data-preview-phone-bar
	>
		<button
			type="button"
			class="grid size-11 shrink-0 place-items-center rounded-full hover:bg-accent"
			onclick={onclose}
			aria-label="Close full screen"><X class="size-5" aria-hidden="true" /></button
		>
		<div class="min-w-0 flex-1 py-1 text-center">
			<p class="truncate text-sm font-medium">{title}</p>
			<p class="truncate font-mono text-xs text-muted-foreground" title={shown}>{address}</p>
		</div>
		<button
			type="button"
			class="grid size-11 shrink-0 place-items-center rounded-full hover:bg-accent disabled:opacity-40"
			onclick={() => preview?.reload()}
			disabled={!check}
			aria-label={live ? 'Reload the preview' : 'Check the preview again'}
			><RotateCw class="size-5" aria-hidden="true" /></button
		>
	</div>

	<div class="relative flex min-h-0 flex-1">
		<div class="min-w-0 flex-1 p-3 max-md:p-0">
			<LivePreview
				bind:this={preview}
				{taskId}
				url={taskId ? null : url}
				fill
				toolbar={!phone.current}
				desktop={phone.current && wide}
				pointing={helper && panel && pointing}
				pin={helper && panel ? (pointed?.at ?? null) : null}
				onpoint={(p, at) => {
					pointed = { pointer: p, at };
					pointing = false;
				}}
			/>
		</div>

		{#if helper && panel && taskId}
			<!-- On a phone, a sheet over the lower page, out of the way while the captain points. -->
			<aside
				class="flex min-h-0 w-[24rem] shrink-0 border-l bg-panel p-3 max-md:absolute max-md:inset-x-0 max-md:bottom-0 max-md:z-10 max-md:h-[88%] max-md:w-auto max-md:overflow-y-auto max-md:overscroll-contain max-md:rounded-t-2xl max-md:border-t max-md:border-l-0 max-md:px-2 max-md:pt-0 max-md:pb-2 max-md:shadow-2xl xl:w-[26rem] {pointing
					? 'max-md:hidden'
					: ''}"
				data-preview-helper-panel
			>
				<div class="flex min-h-0 w-full flex-col">
					<!-- The helper names itself; a phone adds a handle and a way to put it away. -->
					<div class="flex shrink-0 items-center justify-end md:hidden">
						<span
							class="absolute top-2 left-1/2 h-1 w-10 -translate-x-1/2 rounded-full bg-muted-foreground/40"
							aria-hidden="true"
						></span>
						<button
							type="button"
							class="grid size-11 place-items-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground"
							onclick={() => (panel = false)}
							aria-label="Hide the helper"><X class="size-5" aria-hidden="true" /></button
						>
					</div>
					<PreviewHelper
						task={{ id: taskId, shortTitle: title }}
						{url}
						bind:pointing
						bind:attached={pointed}
					/>
				</div>
			</aside>
		{:else if helper}
			<button
				type="button"
				class="absolute right-5 bottom-5 inline-flex items-center gap-2 rounded-full border bg-background px-4 py-2 text-sm font-medium shadow-lg hover:bg-accent max-md:hidden"
				onclick={() => (panel = true)}
				><MessageSquare class="size-4" aria-hidden="true" />Talk it through</button
			>
		{/if}
	</div>
	<div
		class="flex shrink-0 items-center gap-2 border-t bg-background px-3 pt-2 pb-[max(0.5rem,env(safe-area-inset-bottom,0px))] md:hidden"
		data-preview-dock
	>
		<button
			type="button"
			class="grid size-11 shrink-0 place-items-center rounded-xl border hover:bg-accent"
			onclick={() => (wide = !wide)}
			aria-pressed={wide}
			aria-label={wide ? 'Show at the phone’s width' : 'Show at a desktop’s width'}
			>{#if wide}<Smartphone class="size-5" aria-hidden="true" />{:else}<Monitor
					class="size-5"
					aria-hidden="true"
				/>{/if}</button
		>
		{#if live || check?.state === 'blocked'}
			<a
				href={shown}
				target="_blank"
				rel="noreferrer"
				class="grid size-11 shrink-0 place-items-center rounded-xl border hover:bg-accent"
				aria-label="Open in a new tab"><ExternalLink class="size-5" aria-hidden="true" /></a
			>
		{/if}
		{#if helper && !panel}
			<button
				type="button"
				class="inline-flex h-11 shrink-0 items-center gap-2 rounded-xl border px-3 text-sm font-medium hover:bg-accent"
				onclick={() => (panel = true)}
				aria-label="Talk it through"
				><MessageSquare class="size-4 shrink-0" aria-hidden="true" />Talk</button
			>
		{/if}
		{#if action}
			<span class="flex min-w-0 flex-1 flex-wrap items-center justify-end gap-1"
				><PreviewActions preview={action} /></span
			>
		{/if}
	</div>
</div>
