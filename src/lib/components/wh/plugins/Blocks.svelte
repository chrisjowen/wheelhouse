<script lang="ts">
	import { safeHref } from '$lib/plugins/blocks';
	import type { Block, Tone } from '$lib/plugins/types';
	import {
		Check,
		CircleAlert,
		CircleDashed,
		CircleHelp,
		ExternalLink,
		LoaderCircle,
		X
	} from '@lucide/svelte';

	/** Built-in renderers for plugin blocks. Plugin text is always shown as text, never HTML. */
	let { blocks }: { blocks: Block[] } = $props();

	const toneClass: Record<Tone, string> = {
		ok: 'text-success',
		warn: 'text-warning',
		fail: 'text-danger',
		pending: 'text-muted-foreground',
		unknown: 'text-muted-foreground'
	};
	const external = (href: string) => !href.startsWith('/');
</script>

{#snippet link(label: string, href: string | null | undefined, cls = 'text-sea hover:underline')}
	{@const safe = safeHref(href)}
	{#if safe}<a
			href={safe}
			class="inline-flex items-center gap-1 {cls}"
			target={external(safe) ? '_blank' : undefined}
			rel={external(safe) ? 'noreferrer' : undefined}
			>{label}{#if external(safe)}<ExternalLink
					class="size-3.5 shrink-0"
					aria-hidden="true"
				/>{/if}</a
		>{:else}{label}{/if}
{/snippet}

<div class="space-y-3">
	{#each blocks as b, i (i)}
		{#if b.block === 'text.v1'}
			<p
				class="text-sm leading-relaxed whitespace-pre-line {b.muted ? 'text-muted-foreground' : ''}"
				data-block="text.v1"
			>
				{b.text}
			</p>
		{:else if b.block === 'kv.v1'}
			<dl
				class="grid grid-cols-[minmax(0,8rem)_minmax(0,1fr)] gap-x-4 gap-y-1.5 text-sm"
				data-block="kv.v1"
			>
				{#each b.items as item, j (j)}
					<dt class="truncate text-muted-foreground">{item.key}</dt>
					<dd class="min-w-0 break-words">{@render link(item.value, item.href)}</dd>
				{/each}
			</dl>
		{:else if b.block === 'links.v1'}
			<ul class="flex flex-wrap gap-x-5 gap-y-1.5 text-sm" data-block="links.v1">
				{#each b.links as l, j (j)}
					<li class="min-w-0">
						{@render link(l.label, l.href)}{#if l.note}<span class="ml-1.5 text-muted-foreground"
								>{l.note}</span
							>{/if}
					</li>
				{/each}
			</ul>
		{:else if b.block === 'table.v1'}
			<div class="overflow-x-auto rounded-lg border" data-block="table.v1">
				<table class="w-full text-sm">
					{#if b.columns.length}
						<thead class="border-b text-left text-xs text-muted-foreground">
							<tr
								>{#each b.columns as c, j (j)}<th class="px-3 py-2 font-medium">{c}</th>{/each}</tr
							>
						</thead>
					{/if}
					<tbody class="divide-y">
						{#each b.rows as row, j (j)}
							<tr>
								{#each row as cell, k (k)}
									<td class="px-3 py-2"
										>{#if typeof cell === 'string'}{cell}{:else}{@render link(
												cell.text,
												cell.href
											)}{/if}</td
									>
								{/each}
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{:else if b.block === 'image.v1'}
			{@const src = safeHref(b.src)}
			{#if src}
				<figure data-block="image.v1">
					{#if safeHref(b.href)}
						<a href={safeHref(b.href)} target="_blank" rel="noreferrer"
							><img {src} alt={b.alt} loading="lazy" class="max-h-96 rounded-lg border" /></a
						>
					{:else}
						<img {src} alt={b.alt} loading="lazy" class="max-h-96 rounded-lg border" />
					{/if}
				</figure>
			{/if}
		{:else if b.block === 'status.v1'}
			<p class="flex items-start gap-2 text-sm" data-block="status.v1">
				<span class="mt-0.5 {toneClass[b.tone]}" aria-hidden="true">
					{#if b.tone === 'ok'}<Check class="size-4" />
					{:else if b.tone === 'fail'}<X class="size-4" />
					{:else if b.tone === 'warn'}<CircleAlert class="size-4" />
					{:else if b.tone === 'pending'}<LoaderCircle class="size-4" />
					{:else}<CircleHelp class="size-4" />{/if}
				</span>
				<span class="min-w-0">
					<span
						class="font-medium {b.tone === 'fail' || b.tone === 'warn' ? toneClass[b.tone] : ''}"
						>{b.label}</span
					>
					{#if b.detail}<span class="block text-muted-foreground">{b.detail}</span>{/if}
				</span>
			</p>
		{:else if b.block === 'graph.v1'}
			<!-- A placeholder: nodes and edges as lists until a chart renderer lands. -->
			<div class="rounded-lg border border-dashed p-3 text-sm" data-block="graph.v1">
				<p class="text-xs text-muted-foreground">
					{`${b.nodes.length} ${b.nodes.length === 1 ? 'node' : 'nodes'}, ${b.edges.length} ${b.edges.length === 1 ? 'link' : 'links'}`}
				</p>
				<ul class="mt-2 flex flex-wrap gap-1.5">
					{#each b.nodes as n (n.id)}
						<li class="rounded-md bg-muted px-2 py-0.5 text-xs">
							{n.label}{#if n.kind}<span class="ml-1 text-muted-foreground">{n.kind}</span>{/if}
						</li>
					{/each}
				</ul>
				{#if b.edges.length}
					<ul class="mt-2 space-y-0.5 font-mono text-xs text-muted-foreground">
						{#each b.edges as e, j (j)}<li>
								{e.from} → {e.to}{e.label ? ` (${e.label})` : ''}
							</li>{/each}
					</ul>
				{/if}
			</div>
		{:else}
			<!-- A block this Wheelhouse does not know: shown as plain data, never interpreted. -->
			<div class="rounded-lg border border-dashed p-3 text-xs" data-block="unknown">
				<p class="flex items-center gap-1.5 text-muted-foreground">
					<CircleDashed class="size-3.5" aria-hidden="true" />This Wheelhouse cannot show a “{b.block ===
					'unknown'
						? b.type
						: 'unknown'}” block.
				</p>
				{#if b.block === 'unknown'}<pre
						class="mt-2 font-mono break-all whitespace-pre-wrap text-muted-foreground">{b.preview}</pre>{/if}
			</div>
		{/if}
	{/each}
</div>
