<script lang="ts">
	import { live } from '$lib/client/live.svelte';
	import { addressRewrites } from '$lib/client/addresses.svelte';
	import { ago } from '$lib/format';
	import { frameSandbox, type PreviewCheck } from '$lib/preview';
	import { ExternalLink, Maximize2, MonitorOff, RotateCw } from '@lucide/svelte';
	import PreviewFeedback from './PreviewFeedback.svelte';

	/**
	 * A worker's reported preview, embedded: the server checks it is on this
	 * machine and answering (api/tasks/[id]/preview) before a frame is shown,
	 * and says plainly when it is not. `compact` draws it on a card, scaled down
	 * from a desktop-sized page; `fill` takes the whole height of its container
	 * (the full-screen view); otherwise it fills the width at a usable height.
	 * The feedback box underneath sends to the task's worker through Firstmate;
	 * work that has landed has no worker to send it to, so it is left out.
	 * `onfullscreen` adds a Full screen button to the toolbar. `onopen` makes a
	 * compact preview a picture of the page (it takes no clicks or scrolling)
	 * that opens it when clicked, and `toolbar={false}` leaves the address row
	 * out, for a card that draws its own (the chat's preview cards).
	 */
	let {
		taskId,
		compact = false,
		fill = false,
		feedback = true,
		toolbar = true,
		onfullscreen,
		onopen
	}: {
		taskId: string;
		compact?: boolean;
		fill?: boolean;
		feedback?: boolean;
		toolbar?: boolean;
		onfullscreen?: () => void;
		onopen?: () => void;
	} = $props();

	const RECHECK_MS = 15_000;
	const DESKTOP = { w: 1280, h: 800 };

	let check = $state<PreviewCheck | null>(null);
	let failed = $state(false);
	let reloads = $state(0);
	let width = $state(0);

	async function load() {
		try {
			const r = await fetch(`/api/tasks/${encodeURIComponent(taskId)}/preview`);
			if (!r.ok) throw new Error(String(r.status));
			check = (await r.json()) as PreviewCheck;
			failed = false;
		} catch {
			failed = true;
		}
	}

	$effect(() => {
		void taskId;
		void load();
		const t = setInterval(load, RECHECK_MS);
		return () => clearInterval(t);
	});

	const url = $derived(check?.url ?? null);
	// The check only ever loads in the browser, so `location` is there whenever a frame is drawn.
	// Where a plugin's address rewrite says while one is on (see lib/plugins/addresses.ts); else as reported.
	const shown = $derived(url && check ? addressRewrites.view(url) : null);
	const sandbox = $derived(shown ? frameSandbox(shown, location.origin) : '');
	const scale = $derived(width ? width / DESKTOP.w : 0);
</script>

<div
	class="min-w-0 {fill ? 'flex h-full flex-col' : ''}"
	data-live-preview={check?.state ?? 'checking'}
>
	{#if toolbar}<div class="flex items-center gap-2 text-xs text-muted-foreground">
			<span class="min-w-0 flex-1 truncate font-mono" title={url ?? undefined}
				>{url ?? 'Live preview'}</span
			>
			{#if check?.state === 'live' || check?.state === 'blocked' || check?.state === 'down'}
				<button
					type="button"
					class="rounded p-1 hover:bg-accent hover:text-foreground"
					onclick={() => {
						reloads++;
						void load();
					}}
					aria-label="Reload the preview"
					title="Reload"><RotateCw class="size-3.5" /></button
				>
				<a
					href={shown}
					target="_blank"
					rel="noreferrer"
					class="inline-flex shrink-0 items-center gap-1 rounded px-1 py-0.5 text-sea hover:underline"
					>Open in new tab<ExternalLink class="size-3.5" aria-hidden="true" /></a
				>
			{/if}
			{#if onfullscreen && check?.state === 'live'}
				<button
					type="button"
					class="inline-flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 font-medium text-foreground hover:bg-accent"
					onclick={onfullscreen}
					data-preview-fullscreen
					><Maximize2 class="size-3.5" aria-hidden="true" />Full screen</button
				>
			{/if}
		</div>{/if}

	<div
		class="group relative w-full overflow-hidden bg-muted/40 {toolbar
			? 'mt-1.5 rounded-lg border'
			: ''} {compact
			? 'aspect-[16/10]'
			: fill
				? 'min-h-0 flex-1'
				: check?.state === 'live'
					? 'h-[70vh] min-h-80'
					: 'h-40'}"
		bind:clientWidth={width}
	>
		{#if check?.state === 'live' && shown}
			{#key `${shown} ${reloads}`}
				{#if compact}
					{#if scale}
						<iframe
							src={shown}
							title="Live preview of {url}"
							{sandbox}
							referrerpolicy="no-referrer"
							loading="lazy"
							inert={!!onopen}
							class="absolute top-0 left-0 origin-top-left border-0 bg-white {onopen
								? 'pointer-events-none'
								: ''}"
							style="width:{DESKTOP.w}px;height:{DESKTOP.h}px;transform:scale({scale})"
						></iframe>
					{/if}
					{#if onopen}
						<button
							type="button"
							class="absolute inset-0 cursor-zoom-in"
							aria-label="Open the preview full size"
							onclick={onopen}
							data-preview-open
							><span
								class="absolute right-2.5 bottom-2.5 flex items-center gap-1.5 rounded-md border border-hair bg-card/95 px-2 py-1 text-xs font-medium text-foreground opacity-0 shadow-sm transition-opacity group-focus-within:opacity-100 group-hover:opacity-100"
								><Maximize2 class="size-3.5" aria-hidden="true" />Open full size</span
							></button
						>
					{/if}
				{:else}
					<iframe
						src={shown}
						title="Live preview of {url}"
						{sandbox}
						referrerpolicy="no-referrer"
						class="size-full border-0 bg-white"
					></iframe>
				{/if}
			{/key}
		{:else}
			<div class="grid size-full place-items-center p-4 text-center text-muted-foreground">
				<div>
					{#if !check && !failed}
						<p class="text-sm">Checking the preview…</p>
					{:else}
						<MonitorOff class="mx-auto size-6" aria-hidden="true" />
						<p class="mt-2 text-sm font-medium">
							{failed
								? 'Could not check the preview'
								: check?.state === 'down'
									? 'Preview not running'
									: check?.state === 'blocked'
										? 'Preview cannot be embedded'
										: check?.state === 'refused'
											? 'Preview not shown here'
											: 'No live preview reported'}
						</p>
						<p class="mt-1 text-xs">
							{failed
								? 'Wheelhouse did not answer; it will try again.'
								: check?.state === 'down'
									? `Nothing answered at this address${check.reportedAt ? `; reported ${ago(check.reportedAt, live.now)}` : ''}. Wheelhouse checks again every 15 seconds.`
									: check?.state === 'blocked'
										? `${check.reason} Open it in a new tab instead.`
										: (check?.reason ?? '')}
						</p>
					{/if}
				</div>
			</div>
		{/if}
	</div>

	{#if feedback && url}<PreviewFeedback {taskId} {url} />{/if}
</div>
