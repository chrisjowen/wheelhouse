<script lang="ts">
	import type { ComponentProps } from 'svelte';
	import * as Tooltip from '$lib/components/ui/tooltip';
	import ProjectNav from './ProjectNav.svelte';

	// ProjectNav as the layout mounts it, inside the tooltip provider; fold() toggles the icon rail.
	let props: ComponentProps<typeof ProjectNav> = $props();
	let folded = $state(false);
	export const fold = (to: boolean) => (folded = to);
</script>

<Tooltip.Provider><ProjectNav {...props} rail={folded} /></Tooltip.Provider>
