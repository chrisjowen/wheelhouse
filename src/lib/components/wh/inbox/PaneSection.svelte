<script lang="ts">
	/**
	 * One part of a decision in full (Background, Live preview, Documents, Your
	 * answer): a heading that folds it away and opens it again. Open to begin
	 * with; a part folded stays folded while the decision is shown.
	 */
	import type { Snippet } from 'svelte';
	import { ChevronDown } from '@lucide/svelte';

	let {
		id,
		title,
		open = $bindable(true),
		children
	}: {
		/** The part's anchor, for a link to it (`#decision-<id>`), and its data attribute. */
		id: string;
		title: string;
		open?: boolean;
		children: Snippet;
	} = $props();
</script>

<section
	id="decision-{id}"
	class="mt-6 scroll-mt-4"
	aria-labelledby="decision-{id}-title"
	data-pane-section={id}
>
	<h3 id="decision-{id}-title" class="m-0">
		<button
			type="button"
			class="flex w-full cursor-pointer items-center gap-2 py-1 text-left font-sans text-[0.68rem] font-semibold tracking-[0.1em] text-muted-foreground uppercase hover:text-foreground max-md:min-h-11"
			aria-expanded={open}
			aria-controls="decision-{id}-body"
			onclick={() => (open = !open)}
			><ChevronDown
				class="size-3.5 shrink-0 transition-transform {open ? '' : '-rotate-90'}"
				aria-hidden="true"
			/>{title}<span class="h-px min-w-6 flex-1 bg-hair" aria-hidden="true"></span></button
		>
	</h3>
	<div id="decision-{id}-body" class="mt-2" hidden={!open}>
		{@render children()}
	</div>
</section>
