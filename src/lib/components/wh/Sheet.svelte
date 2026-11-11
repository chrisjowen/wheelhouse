<script lang="ts">
	import { Dialog as DialogPrimitive } from 'bits-ui';
	import type { Snippet } from 'svelte';
	import { X } from '@lucide/svelte';

	/**
	 * A sheet that rises from the bottom of a phone's screen, for what a
	 * popover holds on a wide one (a picker, a short form). It is a bits-ui
	 * dialog: focus stays inside, Escape and a tap on the scrim close it, and
	 * focus goes back to what opened it. A drag down on its handle closes it
	 * too. It keeps clear of the home bar (safe-area-inset-bottom) and never
	 * takes more than most of the screen, scrolling what it holds.
	 * `onOpenAutoFocus` is the dialog's own: prevent it to keep the phone's
	 * keyboard down until a field is tapped.
	 */
	let {
		open = $bindable(false),
		title,
		children,
		onOpenAutoFocus
	}: {
		open?: boolean;
		title: string;
		children: Snippet;
		onOpenAutoFocus?: (e: Event) => void;
	} = $props();

	// How far the sheet has been dragged down by its handle, in pixels.
	let drag = $state(0);
	let startY: number | null = null;

	function down(e: PointerEvent) {
		startY = e.clientY;
		(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
	}
	function move(e: PointerEvent) {
		if (startY !== null) drag = Math.max(0, e.clientY - startY);
	}
	function up() {
		if (startY === null) return;
		startY = null;
		if (drag > 80) open = false;
		drag = 0;
	}
</script>

<DialogPrimitive.Root bind:open>
	<DialogPrimitive.Portal>
		<DialogPrimitive.Overlay
			class="fixed inset-0 z-50 bg-black/40 duration-200 data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0"
		/>
		<DialogPrimitive.Content
			class="fixed inset-x-0 bottom-0 z-50 flex max-h-[85dvh] flex-col rounded-t-2xl border-t bg-popover pb-[env(safe-area-inset-bottom,0px)] text-popover-foreground shadow-2xl duration-200 outline-none data-open:animate-in data-open:slide-in-from-bottom data-closed:animate-out data-closed:slide-out-to-bottom"
			style={drag ? `transform: translateY(${drag}px)` : undefined}
			{onOpenAutoFocus}
			data-sheet
		>
			<div
				class="flex h-6 shrink-0 cursor-grab touch-none items-center justify-center"
				onpointerdown={down}
				onpointermove={move}
				onpointerup={up}
				onpointercancel={up}
				aria-hidden="true"
			>
				<span class="h-1 w-10 rounded-full bg-muted-foreground/40"></span>
			</div>
			<div class="flex shrink-0 items-center gap-2 pr-1.5 pl-5">
				<DialogPrimitive.Title class="min-w-0 flex-1 truncate font-title text-2xl leading-tight"
					>{title}</DialogPrimitive.Title
				>
				<DialogPrimitive.Close
					class="grid size-11 shrink-0 place-items-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground"
					aria-label="Close"><X class="size-5" aria-hidden="true" /></DialogPrimitive.Close
				>
			</div>
			<div class="min-h-0 flex-1 overflow-y-auto overscroll-contain">
				{@render children()}
			</div>
		</DialogPrimitive.Content>
	</DialogPrimitive.Portal>
</DialogPrimitive.Root>
