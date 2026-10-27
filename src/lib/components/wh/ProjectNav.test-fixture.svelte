<script lang="ts">
	import type { ComponentProps } from 'svelte';
	import * as Tooltip from '$lib/components/ui/tooltip';
	import ProjectNav from './ProjectNav.svelte';

	// ProjectNav as the layout mounts it, inside the tooltip provider.
	let props: ComponentProps<typeof ProjectNav> = $props();
</script>

<Tooltip.Provider><ProjectNav {...props} /></Tooltip.Provider>
