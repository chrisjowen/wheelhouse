<script lang="ts">
	import { page } from '$app/state';
	import TaskView from '$lib/components/wh/TaskView.svelte';

	let { data } = $props();
</script>

<TaskView id={page.params.id!} seed={data} />
