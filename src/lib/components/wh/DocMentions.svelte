<script lang="ts">
	/**
	 * The Markdown files a raw status line names, as links to the reader, for
	 * places that show the line in plain words (which leave paths out). Paths
	 * the shown words (`shown`) already link are left out.
	 */
	import { FileText } from '@lucide/svelte';
	import { docHref, findDocPaths } from '$lib/docpath';

	let { text, shown }: { text: string | null | undefined; shown?: string | null } = $props();
	const linked = $derived(new Set(findDocPaths(shown ?? '').map((m) => m.path)));
	const paths = $derived(
		[...new Set(findDocPaths(text ?? '').map((m) => m.path))].filter((p) => !linked.has(p))
	);
</script>

{#if paths.length}
	<ul class="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-sm" aria-label="Documents">
		{#each paths as p (p)}
			<li>
				<a
					href={docHref(p)}
					title={p}
					class="inline-flex items-center gap-1 text-sea underline-offset-2 hover:underline"
					data-doc-link
					><FileText class="size-3.5 shrink-0" aria-hidden="true" />{p.split('/').at(-1)}</a
				>
			</li>
		{/each}
	</ul>
{/if}
