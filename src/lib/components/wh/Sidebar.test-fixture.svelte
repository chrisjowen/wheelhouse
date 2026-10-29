<script lang="ts">
	import type { ComponentProps } from 'svelte';
	import * as Tooltip from '$lib/components/ui/tooltip';
	import Sidebar from './Sidebar.svelte';

	// The menu as the layout mounts it, inside the tooltip provider.
	let props: ComponentProps<typeof Sidebar> = $props();
</script>

<Tooltip.Provider><Sidebar {...props} /></Tooltip.Provider>
