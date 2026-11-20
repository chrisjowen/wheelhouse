<script lang="ts">
	/**
	 * A live prototype a task left behind. It is never a frozen copy: while it
	 * answers at its last address it shows live in the preview frame; when it
	 * does not, the page says where its files are kept, shows its screenshots,
	 * and Relaunch asks Firstmate in the chat to serve it again (Wheelhouse
	 * starting it by itself comes later).
	 */
	import { page } from '$app/state';
	import { ArrowLeft, Clock, FileText, MonitorPlay, RotateCcw } from '@lucide/svelte';
	import { fileHref } from '$lib/docpath';
	import { docDate, recordHref, shelfName, STATE_WORDS } from '$lib/documents';
	import { askFirstmate } from '$lib/client/documents.svelte';
	import LivePreview from '$lib/components/wh/LivePreview.svelte';

	let { data } = $props();
	const p = $derived(data.prototype);
	const record = $derived(data.record);

	let asked = $state<'idle' | 'sending' | 'sent' | 'failed'>('idle');
	async function relaunch() {
		asked = 'sending';
		const text = `Please relaunch the prototype "${p.title}" (${p.id}): serve its files from ${data.sourceDir} on a free local port and post the usual preview line, so it shows live on its Documents page again.`;
		const r = await askFirstmate(text, page.data.sessionToken as string);
		asked = r.ok ? 'sent' : 'failed';
	}
	const btn =
		'inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-md border px-3 text-sm hover:bg-accent disabled:cursor-default disabled:opacity-50';
</script>

<svelte:head><title>{p.title} · Prototype · Wheelhouse</title></svelte:head>

<main class="px-4 pt-6 pb-24 sm:px-6 lg:px-10">
	<div
		class="-mx-4 -mt-6 border-b border-hair bg-panel px-4 py-5 sm:-mx-6 sm:px-6 lg:-mx-10 lg:px-10"
	>
		<a
			href={record ? recordHref(record.key) : '/documents'}
			class="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
			><ArrowLeft class="size-4" aria-hidden="true" />{record ? record.title : 'Documents'}</a
		>
		<p class="mt-3 flex items-center gap-2 text-sm text-muted-foreground">
			<MonitorPlay class="size-4 text-working" aria-hidden="true" />Prototype · {shelfName(
				p.project
			)}
			{#if p.mate}<span class="text-working">@{p.mate}</span>{/if}
			<span class="state-dot" data-state={p.state}></span>{STATE_WORDS[p.state]}
		</p>
		<h1 class="mt-1 text-[1.9rem] leading-tight text-balance">{p.title}</h1>
	</div>

	<div class="grid gap-6 py-6 lg:grid-cols-[1fr_20rem]">
		<div class="min-w-0">
			{#if p.state === 'running' && p.url}
				<div class="h-[36rem] overflow-hidden rounded-lg border bg-card" data-proto-state="running">
					<LivePreview url={p.url} fill />
				</div>
			{:else}
				<section class="rounded-lg border bg-card p-5" data-proto-state={p.state}>
					<span
						class="inline-flex items-center gap-1.5 rounded border border-hair px-2 py-0.5 text-xs text-muted-foreground"
						><Clock class="size-3.5" aria-hidden="true" />{p.url
							? `Last ran at ${p.url}`
							: 'No address recorded'}</span
					>
					<h2 class="mt-3 text-xl font-semibold">Not running right now</h2>
					<p class="mt-1 text-sm text-muted-foreground">
						{#if p.mate}This prototype belongs to the second mate {p.mate}; its files are on that
							home, so it runs there.{:else}Its files are kept in <span
								class="font-mono text-foreground">{p.source}/</span
							>. Relaunch asks Firstmate to serve them again on a free local port; it shows live
							here as soon as it answers.{/if}
					</p>
					<div class="mt-4 flex flex-wrap gap-2">
						{#if !p.mate}
							<button
								type="button"
								class="{btn} border-teal/50 bg-teal/10 text-teal"
								disabled={asked === 'sending' || asked === 'sent'}
								onclick={relaunch}
								data-relaunch
								><RotateCcw class="size-4" aria-hidden="true" />{asked === 'sent'
									? 'Asked Firstmate'
									: 'Relaunch'}</button
							>
						{/if}
						{#if record}<a href={recordHref(record.key)} class={btn}
								><FileText class="size-4" aria-hidden="true" />Open the report</a
							>{/if}
					</div>
					{#if asked === 'sent'}<p class="mt-2 text-sm text-muted-foreground">
							Sent to Firstmate in the chat. <a href="/" class="text-sea hover:underline"
								>Open the chat</a
							>
						</p>{:else if asked === 'failed'}<p class="mt-2 text-sm text-danger">
							Firstmate could not be asked. Try again, or ask in the chat.
						</p>{/if}
				</section>
			{/if}

			{#if p.shots.length}
				<p class="mono-label mt-6">Screenshots</p>
				<div class="mt-2 grid gap-4 sm:grid-cols-2">
					{#each p.shots as s (s.path)}
						<figure class="overflow-hidden rounded-lg border bg-card">
							<img src={fileHref(s.path)} alt={s.name} loading="lazy" class="w-full" />
							<figcaption
								class="border-t border-hair px-3 py-1.5 font-mono text-xs text-muted-foreground"
							>
								{s.name}
							</figcaption>
						</figure>
					{/each}
				</div>
			{/if}
		</div>

		<aside class="grid h-fit gap-4 text-sm">
			<section class="rounded-lg border bg-card p-3.5">
				<p class="mono-label">Prototype</p>
				<dl class="mt-2 grid grid-cols-[5.5rem_1fr] gap-x-3 gap-y-1.5 text-xs">
					<dt class="text-muted-foreground">State</dt>
					<dd>{STATE_WORDS[p.state]}</dd>
					<dt class="text-muted-foreground">Files</dt>
					<dd class="font-mono break-all">{p.source}/</dd>
					<dt class="text-muted-foreground">Last address</dt>
					<dd class="font-mono break-all">{p.url ?? 'none recorded'}</dd>
					<dt class="text-muted-foreground">Task id</dt>
					<dd class="font-mono break-all">{p.task}</dd>
					<dt class="text-muted-foreground">Changed</dt>
					<dd>{docDate(p.at)}</dd>
				</dl>
				<p class="mt-3 text-xs text-muted-foreground">
					A prototype is never sealed into its record: this page links to the live thing.
				</p>
			</section>
		</aside>
	</div>
</main>
