<script lang="ts">
	/**
	 * A library document: rendered on the sheet, with its folder, tags, status,
	 * git history and the record it was promoted from beside it. Ask Firstmate
	 * to edit opens a side panel in the same Firstmate conversation: the request
	 * goes to Firstmate, which edits the file in the library and commits, and
	 * the new commit appears in the history here as soon as it lands.
	 */
	import { browser } from '$app/environment';
	import { page } from '$app/state';
	import { invalidateAll } from '$app/navigation';
	import { onDestroy } from 'svelte';
	import {
		ArrowLeft,
		Check,
		Folder,
		GitCommitHorizontal,
		Link2,
		LoaderCircle,
		MessagesSquare,
		Pencil,
		RadioTower,
		Send,
		X
	} from '@lucide/svelte';
	import { renderDoc } from '$lib/chat/markdown';
	import { fileHref } from '$lib/docpath';
	import { docDate, libraryHref, shelfName } from '$lib/documents';
	import { askFirstmate } from '$lib/client/documents.svelte';
	import DocSheet from '$lib/components/wh/DocSheet.svelte';
	import DocChip from '$lib/components/wh/docs/DocChip.svelte';
	import LiveDocPicker from '$lib/components/wh/docs/LiveDocPicker.svelte';

	let { data } = $props();
	const lib = $derived(data.lib);
	const d = $derived(lib.doc);
	const dir = $derived(lib.file.slice(0, lib.file.lastIndexOf('/')));
	const filesHref = (rel: string) =>
		`${libraryHref(d.key)}/files/${rel.split('/').map(encodeURIComponent).join('/')}`;
	const body = $derived(
		lib.markdown.replace(/^\s*#\s+(.+)\n/, (m, h: string) => (h.trim() === d.title ? '' : m))
	);
	const html = $derived.by(() => {
		if (!browser) return null;
		let out = renderDoc(body, lib.file);
		for (const rel of lib.attachments) {
			const from = fileHref(`${dir}/${d.slug}/${rel}`);
			out = out.split(`"${from}"`).join(`"${filesHref(rel)}"`);
		}
		return out;
	});
	const folderQuery = $derived(
		`/documents?tab=library&q=${encodeURIComponent(`folder:${d.shelf}/${d.folder}`)}`
	);

	let copied = $state(false);
	async function copy() {
		await navigator.clipboard
			?.writeText(new URL(libraryHref(d.key), location.origin).href)
			.catch(() => {});
		copied = true;
		setTimeout(() => (copied = false), 1600);
	}
	let picking = $state(false);

	// Asking Firstmate to edit: a side panel, the same Firstmate conversation as the chat.
	let editing = $state(false);
	let request = $state('');
	let sent = $state<{ text: string; ok: boolean; error?: string }[]>([]);
	let busy = $state(false);
	let watching: ReturnType<typeof setInterval> | null = null;
	// Just promoted, or just edited: its newest commit is marked in the history.
	let fresh = $state<string | null>(null);
	$effect.pre(() => {
		if (page.url.searchParams.get('promoted')) fresh = data.lib.history[0]?.sha ?? null;
	});
	let waiting = $state(false);
	const newest = $derived(lib.history[0]?.sha ?? null);

	function editText(req: string) {
		return [
			`Please edit the library document "${d.title}": ${req}`,
			'',
			`The file is ${lib.file}, in the Wheelhouse library (a git repository at ${lib.root}). Edit it there and commit with a message that starts "edit: " and names this request; keep its front matter. Reply here when it is done.`
		].join('\n');
	}
	async function send() {
		const req = request.trim();
		if (!req) return;
		busy = true;
		const r = await askFirstmate(editText(req), page.data.sessionToken as string);
		busy = false;
		sent = [...sent, { text: req, ok: r.ok, error: r.ok ? undefined : r.error }];
		if (r.ok) {
			request = '';
			watch();
		}
	}
	/** Look for Firstmate's commit for a few minutes, and show it when it lands. */
	function watch() {
		if (watching) clearInterval(watching);
		waiting = true;
		const since = newest;
		const until = Date.now() + 10 * 60_000;
		watching = setInterval(async () => {
			if (Date.now() > until && watching) {
				clearInterval(watching);
				watching = null;
				waiting = false;
			}
			const r = await fetch(`/api/library/doc?key=${encodeURIComponent(d.key)}`, {
				cache: 'no-store'
			}).catch(() => null);
			const body = (await r?.json().catch(() => null)) as {
				history?: { sha: string }[];
			} | null;
			const top = body?.history?.[0]?.sha;
			if (top && top !== since) {
				fresh = top;
				await invalidateAll();
				if (watching) clearInterval(watching);
				watching = null;
				waiting = false;
			}
		}, 4000);
	}
	onDestroy(() => watching && clearInterval(watching));

	const btn =
		'inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-md border px-2.5 text-sm hover:bg-accent';
</script>

<svelte:head><title>{d.title} · Library · Wheelhouse</title></svelte:head>

<main class="doc-page {editing ? 'lg:pr-[24rem]' : ''}">
	<div class="doc-bar">
		<a
			href="/documents?tab=library"
			class="inline-flex shrink-0 items-center gap-1.5 text-muted-foreground hover:text-foreground"
			><ArrowLeft class="size-4" aria-hidden="true" />Library</a
		>
		<span class="hidden min-w-0 truncate text-muted-foreground sm:inline"
			>/ {shelfName(d.shelf)} / <a href={folderQuery} class="hover:underline">{d.folder}</a> /
			<span class="font-medium text-foreground">{d.title}</span></span
		>
		<span class="ml-auto flex shrink-0 items-center gap-1.5">
			<button type="button" class={btn} onclick={copy}
				>{#if copied}<Check class="size-4" aria-hidden="true" />Copied{:else}<Link2
						class="size-4"
						aria-hidden="true"
					/>Copy link{/if}</button
			>
			<button type="button" class="{btn} max-sm:hidden" onclick={() => (picking = true)}
				><RadioTower class="size-4" aria-hidden="true" />Bring into Live</button
			>
			<button
				type="button"
				class="{btn} border-gold/60 bg-gold/10 text-gold"
				onclick={() => (editing = true)}
				data-ask-edit><Pencil class="size-4" aria-hidden="true" />Ask Firstmate to edit</button
			>
		</span>
	</div>

	<DocSheet {html} text={body}>
		{#snippet header()}
			<p
				class="flex items-center gap-2 font-display text-[1.05rem] tracking-[0.1em] text-muted-foreground [font-variant-caps:all-small-caps]"
			>
				Library · {shelfName(d.shelf)} / {d.folder}
				<span class="status-chip" data-status={d.status}>{d.status}</span>
			</p>
			<h1 id="doc-title" class="mt-3">{d.title}</h1>
			<p class="mt-4 text-sm text-muted-foreground">Updated {docDate(d.updated)}</p>
		{/snippet}
		{#snippet aside()}
			<div class="grid grid-cols-[minmax(0,1fr)] gap-4 text-sm">
				<section class="rounded-lg border bg-card p-3.5">
					<p class="mono-label">Library document</p>
					<dl class="mt-2 grid grid-cols-[4.5rem_1fr] gap-x-3 gap-y-1.5 text-xs">
						<dt class="text-muted-foreground">Folder</dt>
						<dd>
							<a href={folderQuery} class="inline-flex items-center gap-1 hover:underline"
								><Folder class="size-3.5" aria-hidden="true" />{shelfName(d.shelf)}/{d.folder}</a
							>
						</dd>
						<dt class="text-muted-foreground">Tags</dt>
						<dd class="flex flex-wrap gap-1.5">
							{#each d.tags as t (t)}<a
									href="/documents?tab=library&q={encodeURIComponent(`#${t}`)}"
									class="font-mono text-gold hover:underline">#{t}</a
								>{:else}<span class="text-muted-foreground">none</span>{/each}
						</dd>
						<dt class="text-muted-foreground">Status</dt>
						<dd><span class="status-chip" data-status={d.status}>{d.status}</span></dd>
						<dt class="text-muted-foreground">File</dt>
						<dd class="font-mono break-all">{d.key}.md</dd>
					</dl>
					{#if lib.record}
						<p class="mono-label mt-4">Promoted from</p>
						<div class="mt-1.5">
							<DocChip doc={{ kind: 'record', record: lib.record }} size="sm" />
						</div>
					{/if}
					{#each lib.prototypes as p (p.id)}
						<div class="mt-1.5">
							<DocChip doc={{ kind: 'prototype', prototype: p }} size="sm" label="Prototype" />
						</div>
					{/each}
					<p class="mt-3 text-xs text-muted-foreground">
						To move it, change its tags or mark it superseded, ask Firstmate; it commits the change.
					</p>
				</section>
				<section class="rounded-lg border bg-card p-3.5">
					<p class="mono-label">History</p>
					<ol class="mt-2 grid gap-2" data-history>
						{#each lib.history as h (h.sha)}
							<li
								class="grid grid-cols-[1rem_1fr] gap-2 rounded-md p-1 text-xs {fresh === h.sha
									? 'bg-gold/10 ring-1 ring-gold/40'
									: ''}"
								data-commit={h.sha}
							>
								<GitCommitHorizontal
									class="mt-0.5 size-3.5 text-muted-foreground"
									aria-hidden="true"
								/>
								<span class="min-w-0"
									><span class="font-mono text-gold">{h.sha}</span>
									<span class="text-muted-foreground">{docDate(h.at)}</span><span
										class="block break-words">{h.subject}</span
									></span
								>
							</li>
						{/each}
					</ol>
					<p class="mt-2 text-xs text-muted-foreground">
						Every change is a git commit in the library, naming what was asked.
					</p>
				</section>
			</div>
		{/snippet}
	</DocSheet>
</main>

{#if editing}
	<aside
		class="fixed top-15 right-0 bottom-0 z-30 flex w-full max-w-[24rem] flex-col border-l bg-panel shadow-xl"
		aria-label="Ask Firstmate to edit"
		data-edit-panel
	>
		<header class="flex items-center gap-2 border-b border-hair px-4 py-3">
			<MessagesSquare class="size-4 text-muted-foreground" aria-hidden="true" />
			<b class="flex-1">Firstmate</b>
			<span class="max-w-[12rem] truncate rounded border border-gold/40 px-1.5 text-xs text-gold"
				>about: {d.title}</span
			>
			<button
				type="button"
				class="grid size-7 cursor-pointer place-items-center rounded hover:bg-accent"
				aria-label="Close"
				onclick={() => (editing = false)}><X class="size-4" /></button
			>
		</header>
		<div class="flex-1 space-y-3 overflow-y-auto p-4 text-sm">
			<div class="rounded-lg border bg-card p-3">
				What should change in <b>{d.title}</b>? Firstmate edits
				<span class="font-mono text-xs">{d.slug}.md</span> and commits it with your words in the message.
			</div>
			{#each sent as s, i (i)}
				<div
					class="ml-8 rounded-lg border border-bubble-captain-border bg-[var(--bubble-captain)] p-3"
				>
					{s.text}
				</div>
				{#if s.ok}
					<p class="text-xs text-muted-foreground">
						{#if fresh}<Check class="inline size-3.5 text-success" aria-hidden="true" /> Committed
							<span class="font-mono text-gold">{fresh}</span>; it is at the top of the history.{:else if waiting}<LoaderCircle
								class="inline size-3.5 animate-spin"
								aria-hidden="true"
							/> Sent to Firstmate. Waiting for its commit…{:else}Sent to Firstmate.{/if}
						Its reply is in the <a href="/" class="text-sea hover:underline">chat</a>.
					</p>
				{:else}
					<p class="text-xs text-danger">{s.error ?? 'It could not be sent.'}</p>
				{/if}
			{/each}
		</div>
		<form
			class="border-t border-hair p-3"
			onsubmit={(e) => {
				e.preventDefault();
				void send();
			}}
		>
			<div class="flex items-end gap-2 rounded-lg border border-input bg-card p-1.5">
				<textarea
					bind:value={request}
					rows="3"
					class="min-w-0 flex-1 resize-none bg-transparent px-1.5 py-1 text-sm outline-none"
					placeholder="e.g. add a rule about chart colours"
					aria-label="What should change"
					onkeydown={(e) => {
						if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
							e.preventDefault();
							void send();
						}
					}}></textarea>
				<button
					type="submit"
					class="grid size-8 cursor-pointer place-items-center rounded-md bg-primary text-primary-foreground disabled:opacity-40"
					aria-label="Send to Firstmate"
					disabled={busy || !request.trim()}><Send class="size-4" /></button
				>
			</div>
			<p class="mt-1.5 px-1 text-xs text-muted-foreground">
				The same Firstmate conversation as the chat, shown beside the document.
			</p>
		</form>
	</aside>
{/if}

<LiveDocPicker bind:open={picking} preselect="lib:{d.key}" />
