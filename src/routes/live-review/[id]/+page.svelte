<script lang="ts">
	import ReviewDock from '$lib/components/wh/livereview/ReviewDock.svelte';

	let { data } = $props();
</script>

<svelte:head><title>Live review · {data.title}</title></svelte:head>

{#if data.from}
	<ReviewDock
		taskId={data.taskId}
		title={data.title}
		preview={data.preview}
		from={data.from}
		back={data.back}
	/>
{:else}
	<p class="p-6 text-sm text-muted-foreground">
		This panel opens on a preview Wheelhouse is recording for a live review.
	</p>
{/if}
