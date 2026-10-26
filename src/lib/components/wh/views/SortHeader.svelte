<script lang="ts" generics="K extends string">
	import { nextSort, type Sort, type SortDir } from '$lib/views';
	import { ArrowDown, ArrowUp, ArrowUpDown } from '@lucide/svelte';

	let {
		label,
		column,
		sort,
		firstDir,
		onsort,
		class: klass = ''
	}: {
		label: string;
		column: K;
		sort: Sort<K>;
		firstDir: SortDir;
		onsort: (s: Sort<K>) => void;
		class?: string;
	} = $props();
	const on = $derived(sort.key === column);
</script>

<th
	scope="col"
	class="px-3 py-2 text-left font-medium first:pl-4 last:pr-4 {klass}"
	aria-sort={on ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
>
	<button
		type="button"
		class="-mx-1 inline-flex cursor-pointer items-center gap-1 rounded-sm px-1 py-0.5 whitespace-nowrap hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none {on
			? 'text-foreground'
			: ''}"
		onclick={() => onsort(nextSort(sort, column, firstDir))}
	>
		{label}
		{#if on}
			{#if sort.dir === 'asc'}<ArrowUp class="size-3.5" aria-hidden="true" />{:else}<ArrowDown
					class="size-3.5"
					aria-hidden="true"
				/>{/if}
		{:else}
			<ArrowUpDown class="size-3.5 opacity-40" aria-hidden="true" />
		{/if}
	</button>
</th>
