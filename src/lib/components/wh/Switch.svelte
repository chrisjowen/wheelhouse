<script lang="ts">
	/** An on/off switch: a button with the switch role, sea-blue when on, half-way when mixed. */
	let {
		checked,
		mixed = false,
		label,
		disabled = false,
		onchange
	}: {
		checked: boolean;
		/** Neither on nor off: on for some of what it covers. */
		mixed?: boolean;
		/** What it turns on, for screen readers. */
		label: string;
		disabled?: boolean;
		onchange: (on: boolean) => void;
	} = $props();
</script>

<button
	type="button"
	role="switch"
	aria-checked={mixed ? 'mixed' : checked}
	aria-label={label}
	{disabled}
	onclick={() => onchange(!checked)}
	class="relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border transition-colors duration-200 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50 {mixed
		? 'border-sea bg-sea/40'
		: checked
			? 'border-sea bg-sea'
			: 'border-input bg-muted'}"
>
	<span
		class="inline-block size-4.5 rounded-full bg-background shadow-sm transition-transform duration-200 motion-reduce:transition-none"
		style:transform="translateX({mixed ? '0.75rem' : checked ? '1.375rem' : '0.125rem'})"
	></span>
</button>
