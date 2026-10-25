<script lang="ts">
	import { onMount, type Snippet } from 'svelte';

	/**
	 * A panel docked on the right of a full-height view, resizable by dragging
	 * or with the arrow keys on its left edge (a double click restores the
	 * default), its width remembered under `storageKey`. The home page's rail
	 * and the Chart's inspector both sit in one.
	 */
	let {
		storageKey,
		label,
		defaultWidth = 368,
		class: className = '',
		children
	}: {
		storageKey: string;
		/** What the resize handle is called, for assistive technology. */
		label: string;
		defaultWidth?: number;
		class?: string;
		children: Snippet;
	} = $props();

	// svelte-ignore state_referenced_locally
	let width = $state(defaultWidth);
	const clamp = (w: number) =>
		Math.round(Math.min(Math.max(w, 280), Math.min(720, window.innerWidth * 0.6)));

	onMount(() => {
		try {
			const saved = Number(localStorage.getItem(storageKey));
			if (saved) width = clamp(saved);
		} catch {
			// storage unavailable: the default width
		}
	});

	function save() {
		try {
			localStorage.setItem(storageKey, String(width));
		} catch {
			// storage unavailable: the width lasts for this page only
		}
	}
	function drag(e: PointerEvent) {
		const el = e.currentTarget as HTMLElement;
		el.setPointerCapture(e.pointerId);
		const move = (ev: PointerEvent) => (width = clamp(window.innerWidth - ev.clientX));
		const up = () => {
			el.removeEventListener('pointermove', move);
			el.removeEventListener('pointerup', up);
			save();
		};
		el.addEventListener('pointermove', move);
		el.addEventListener('pointerup', up);
	}
	function nudge(e: KeyboardEvent) {
		if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
		e.preventDefault();
		width = clamp(width + (e.key === 'ArrowLeft' ? 24 : -24));
		save();
	}
</script>

<div class="relative shrink-0 border-l {className}" style="width: {width}px">
	<!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
	<div
		role="separator"
		aria-orientation="vertical"
		aria-label={label}
		aria-valuenow={width}
		tabindex="0"
		class="group absolute inset-y-0 -left-1.5 z-10 w-3 cursor-col-resize touch-none outline-none"
		onpointerdown={drag}
		onkeydown={nudge}
		ondblclick={() => {
			width = defaultWidth;
			save();
		}}
	>
		<span
			class="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-transparent transition-colors group-hover:bg-sea group-focus-visible:bg-sea"
		></span>
		<span
			class="absolute top-1/2 left-1/2 h-8 w-1 -translate-1/2 rounded-full bg-border transition-colors group-hover:bg-sea"
		></span>
	</div>
	{@render children()}
</div>
