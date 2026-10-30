<!-- PROTOTYPE: a project's two-letter monogram in one of the app's quiet tile hues. -->
<script lang="ts">
	let { name, size = 'md' }: { name: string; size?: 'md' | 'lg' } = $props();

	const parts = $derived(
		name
			.replace(/-wheelhouse$/, '')
			.split(/[-\s]+/)
			.filter(Boolean)
	);
	const letters = $derived(parts.length > 1 ? `${parts[0][0]}${parts[1][0]}` : name.slice(0, 2));
	const hue = $derived([...name].reduce((a, c) => a + c.charCodeAt(0), 0) % 6);
</script>

<span
	class="project-tile shrink-0 uppercase {size === 'lg' ? '!h-9 !w-11 !rounded-md !text-sm' : ''}"
	data-hue={hue}
	aria-hidden="true">{letters}</span
>
