<script lang="ts">
	let { data }: { data: unknown } = $props();
	const boom = (): string => {
		throw new Error(`panel exploded on ${String(data)}`);
	};
</script>

<p>{boom()}</p>
