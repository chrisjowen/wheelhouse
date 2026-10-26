<script lang="ts">
	import type { HTMLTextareaAttributes } from 'svelte/elements';
	import { Textarea } from '$lib/components/ui/textarea';
	import { cn } from '$lib/utils.js';
	import { fieldTarget } from '$lib/voice/dictation.svelte';
	import MicButton from './MicButton.svelte';

	/** A textarea with a mic in its corner for dictating into it (see MicButton). */
	let {
		value = $bindable(),
		class: className,
		...rest
	}: Omit<HTMLTextareaAttributes, 'value'> & { value?: string } = $props();

	let ref = $state<HTMLTextAreaElement | null>(null);
	let listening = $state(false);
</script>

<div class="relative w-full min-w-0">
	<Textarea bind:ref bind:value class={cn(className, listening ? 'pr-24' : 'pr-10')} {...rest} />
	<div class="absolute right-1.5 bottom-1.5">
		<MicButton
			field={ref}
			target={() => fieldTarget(ref!)}
			bind:listening
			size="sm"
			disabled={!!rest.disabled}
		/>
	</div>
</div>
