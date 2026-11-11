<script lang="ts">
	import { addressRewrites } from '$lib/client/addresses.svelte';
	import { previewChecks, urlKey } from '$lib/client/previewchecks.svelte';
	import { frameSandbox } from '$lib/preview';
	import { pointAt, type Pointer } from '$lib/previewhelper';
	import { ExternalLink, Maximize2, MonitorOff, MousePointerClick, RotateCw } from '@lucide/svelte';

	/**
	 * A worker's reported preview, embedded: the server checks it is on this
	 * machine and answering (api/tasks/[id]/preview, kept current by
	 * previewChecks) before a frame is shown. One that does not answer shows a
	 * calm "Preview stopped" with no link to it, and appears by itself once it
	 * answers again. `compact` draws it on a card, scaled down from a
	 * desktop-sized page (and, until it answers, as one short line); `fill`
	 * takes the whole height of its container (the full-screen view); otherwise
	 * it fills the width at a usable height.
	 * `pointing` lays a crosshair over the page: a click names the part of the
	 * page under it (onpoint), the element itself when the preview shares
	 * Wheelhouse's origin, else the spot, which stays marked (`pin`) while the
	 * captain talks about it with the preview helper.
	 * `onfullscreen` adds a Full screen button to the toolbar. `onopen` makes a
	 * compact preview a picture of the page (it takes no clicks or scrolling)
	 * that opens it when clicked, and `toolbar={false}` leaves the address row
	 * out, for a card that draws its own (the chat's preview cards).
	 * `url` in place of `taskId` shows a preview no task reported (one Firstmate
	 * linked, a review board), checked the same way (api/previews/check).
	 * `desktop`, with `fill`, draws the page at desktop width scaled down to fit
	 * (on a phone, to see the wide layout). `reload()` reloads it, for a
	 * toolbar of the caller's own.
	 */
	let {
		taskId = null,
		url: address = null,
		compact = false,
		fill = false,
		desktop = false,
		toolbar = true,
		pointing = false,
		pin = null,
		onpoint,
		onfullscreen,
		onopen
	}: {
		taskId?: string | null;
		url?: string | null;
		compact?: boolean;
		fill?: boolean;
		/** With `fill`, the page at desktop width, scaled down to fit. */
		desktop?: boolean;
		toolbar?: boolean;
		/** Take the next click on the page as pointing at it (onpoint), not as a click. */
		pointing?: boolean;
		/** Where the captain pointed, as fractions of the frame, marked until cleared. */
		pin?: { x: number; y: number } | null;
		onpoint?: (p: Pointer, at: { x: number; y: number }) => void;
		onfullscreen?: () => void;
		onopen?: () => void;
	} = $props();

	let frame = $state<HTMLIFrameElement | null>(null);

	function point(e: MouseEvent) {
		const box = (e.currentTarget as HTMLElement).getBoundingClientRect();
		const x = e.clientX - box.left;
		const y = e.clientY - box.top;
		let el: Element | null = null;
		// A page drawn scaled down is pointed at in its own, unscaled, pixels.
		const k = wide ? scale : 1;
		try {
			// Only a preview on Wheelhouse's own origin can be looked inside.
			el = frame?.contentDocument?.elementFromPoint(x / k, y / k) ?? null;
		} catch {
			el = null;
		}
		const at = { x: box.width ? x / box.width : 0, y: box.height ? y / box.height : 0 };
		onpoint?.(pointAt(el, at, { w: Math.round(box.width), h: Math.round(box.height) }), at);
	}

	const DESKTOP = { w: 1280, h: 800 };

	let reloads = $state(0);
	let width = $state(0);
	let height = $state(0);

	const key = $derived(taskId ?? urlKey(address ?? ''));
	$effect(() => previewChecks.watch(key));

	const check = $derived(previewChecks.checks[key] ?? null);
	const failed = $derived(!!previewChecks.failed[key]);
	const live = $derived(check?.state === 'live');

	const url = $derived(check?.url ?? null);
	// The check only ever loads in the browser, so `location` is there whenever a frame is drawn.
	// Where a plugin's address rewrite says while one is on (see lib/plugins/addresses.ts); else as reported.
	const shown = $derived(url && check ? addressRewrites.view(url) : null);
	const sandbox = $derived(shown ? frameSandbox(shown, location.origin) : '');
	const scale = $derived(width ? width / DESKTOP.w : 0);
	const wide = $derived(fill && desktop && scale > 0 && scale < 1);

	export function reload() {
		reloads++;
		void previewChecks.refresh(key);
	}
</script>

<div
	class="min-w-0 {fill ? 'flex h-full flex-col' : ''}"
	data-live-preview={check?.state ?? 'checking'}
>
	{#if toolbar}<div class="flex items-center gap-2 text-xs text-muted-foreground">
			<span class="min-w-0 flex-1 truncate font-mono" title={url ?? undefined}
				>{url ?? 'Live preview'}</span
			>
			{#if live || check?.state === 'blocked' || check?.state === 'down'}
				<button
					type="button"
					class="rounded p-1 hover:bg-accent hover:text-foreground max-md:grid max-md:size-11 max-md:place-items-center"
					onclick={reload}
					aria-label={live ? 'Reload the preview' : 'Check the preview again'}
					title={live ? 'Reload' : 'Check again'}><RotateCw class="size-3.5" /></button
				>
			{/if}
			<!-- A preview that has stopped gets no link: there is nothing to open. -->
			{#if live || check?.state === 'blocked'}
				<a
					href={shown}
					target="_blank"
					rel="noreferrer"
					class="inline-flex shrink-0 items-center gap-1 rounded px-1 py-0.5 text-sea hover:underline max-md:min-h-11"
					>Open in new tab<ExternalLink class="size-3.5" aria-hidden="true" /></a
				>
			{/if}
			{#if onfullscreen && live}
				<button
					type="button"
					class="inline-flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 font-medium text-foreground hover:bg-accent max-md:min-h-11"
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
			? live
				? 'aspect-[16/10]'
				: ''
			: fill
				? 'min-h-0 flex-1'
				: live
					? 'h-[70vh] min-h-80'
					: 'h-40'}"
		bind:clientWidth={width}
		bind:clientHeight={height}
	>
		{#if live && shown}
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
						bind:this={frame}
						src={shown}
						title="Live preview of {url}"
						{sandbox}
						referrerpolicy="no-referrer"
						class={wide
							? 'absolute top-0 left-0 origin-top-left border-0 bg-white'
							: 'size-full border-0 bg-white'}
						style={wide
							? `width:${DESKTOP.w}px;height:${height / scale}px;transform:scale(${scale})`
							: undefined}
					></iframe>
					{#if pointing}
						<button
							type="button"
							class="absolute inset-0 cursor-crosshair bg-sea/5 ring-2 ring-sea ring-inset"
							aria-label="Point at part of the page"
							onclick={point}
							data-preview-pointing
							><span
								class="pointer-events-none absolute top-3 left-1/2 flex -translate-x-1/2 items-center gap-2 rounded-full bg-sea px-3.5 py-1.5 text-sm text-on-accent shadow-lg"
								><MousePointerClick class="size-4" aria-hidden="true" />Click the part you mean</span
							></button
						>
					{:else if pin}
						<span
							class="pointer-events-none absolute size-5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-sea shadow-md ring-2 ring-sea/40"
							style="left:{pin.x * 100}%;top:{pin.y * 100}%"
							aria-hidden="true"
							data-preview-pin
						></span>
					{/if}
				{/if}
			{/key}
		{:else}
			{@const checking = !check && !failed}
			{@const title = checking
				? 'Checking the preview…'
				: failed
					? 'Could not check the preview'
					: check?.state === 'down'
						? 'Preview stopped'
						: check?.state === 'blocked'
							? 'Preview cannot be embedded'
							: check?.state === 'refused'
								? 'Preview not shown here'
								: 'No live preview reported'}
			{@const why = checking
				? ''
				: failed
					? 'Wheelhouse did not answer; it will try again.'
					: check?.state === 'blocked'
						? `${check.reason} Open it in a new tab instead.`
						: (check?.reason ?? '')}
			{#if compact}
				<!-- On a card, a stopped preview is one quiet line, not an empty page. -->
				<div class="flex items-start gap-2.5 px-4 py-3 text-muted-foreground" data-preview-notice>
					{#if !checking}<MonitorOff class="mt-0.5 size-4 shrink-0" aria-hidden="true" />{/if}
					<p class="min-w-0 text-sm">
						<span class="font-medium {checking ? '' : 'text-foreground'}">{title}</span>
						{#if why}<span class="block text-xs">{why}</span>{/if}
					</p>
				</div>
			{:else}
				<div
					class="grid size-full place-items-center p-4 text-center text-muted-foreground"
					data-preview-notice
				>
					<div>
						{#if checking}
							<p class="text-sm">{title}</p>
						{:else}
							<MonitorOff class="mx-auto size-6" aria-hidden="true" />
							<p class="mt-2 text-sm font-medium">{title}</p>
							<p class="mt-1 text-xs">{why}</p>
						{/if}
					</div>
				</div>
			{/if}
		{/if}
	</div>
</div>
