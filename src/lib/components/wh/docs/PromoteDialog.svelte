<script lang="ts">
	/**
	 * Promote a record into the library: Wheelhouse suggests the title, shelf
	 * (the record's project), folder and name, the captain adjusts them and the
	 * tags, and the commit message is shown before it is made. The record itself
	 * never changes; its report and the files it links are copied.
	 */
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { BookPlus, GitCommitHorizontal, LoaderCircle } from '@lucide/svelte';
	import * as Dialog from '$lib/components/ui/dialog';
	import { Button } from '$lib/components/ui/button';
	import { SESSION_HEADER } from '$lib/client/messages';
	import { documents } from '$lib/client/documents.svelte';
	import { libraryHref, shelfName, slugify, tagOf, type DocRecord } from '$lib/documents';

	let {
		open = $bindable(false),
		record,
		shelves,
		folders
	}: {
		open?: boolean;
		record: DocRecord;
		shelves: string[];
		folders: Record<string, string[]>;
	} = $props();

	const NEW = '__new';
	let title = $state('');
	let shelf = $state('');
	let folder = $state('');
	let newFolder = $state('');
	let slug = $state('');
	let tags = $state('');
	let busy = $state(false);
	let error = $state<string | null>(null);

	const shelfFolders = $derived(folders[shelf] ?? []);
	const folderName = $derived(folder === NEW ? slugify(newFolder || 'reports', 'reports') : folder);
	const commit = $derived(
		`promote: ${shelf}/${folderName}/${slugify(slug || record.slug, record.slug)} from records/${record.key}`
	);

	// Suggestions each time it opens.
	$effect(() => {
		if (!open) return;
		title = record.title;
		shelf = record.project;
		slug = record.slug;
		tags = record.tags.join(', ');
		error = null;
	});
	// A shelf with folders suggests one; a new shelf starts a folder.
	$effect(() => {
		const fs = folders[shelf] ?? [];
		folder = fs.includes('reports') ? 'reports' : (fs[0] ?? NEW);
		newFolder = fs.length ? '' : 'reports';
	});

	async function promote() {
		busy = true;
		error = null;
		const r = await fetch('/api/library/promote', {
			method: 'POST',
			headers: {
				'content-type': 'application/json',
				[SESSION_HEADER]: page.data.sessionToken as string
			},
			body: JSON.stringify({
				record: record.key,
				title,
				shelf,
				folder: folderName,
				slug,
				tags: tags.split(',').map(tagOf).filter(Boolean)
			})
		}).catch(() => null);
		const body = (await r?.json().catch(() => null)) as { key?: string; message?: string } | null;
		busy = false;
		if (!r?.ok || !body?.key) {
			error = body?.message ?? 'Wheelhouse did not answer. Try again.';
			return;
		}
		open = false;
		documents.stale();
		await goto(`${libraryHref(body.key)}?promoted=1`);
	}

	const field = 'grid gap-1 text-sm font-medium';
	const control =
		'h-9 rounded-md border border-input bg-background px-2.5 text-sm font-normal outline-none focus:ring-3 focus:ring-ring/40';
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-lg">
		<Dialog.Header>
			<Dialog.Title class="flex items-center gap-2 font-display text-lg"
				><BookPlus class="size-5 text-gold" aria-hidden="true" />Promote to the library</Dialog.Title
			>
			<Dialog.Description>
				The report and the files it links are copied into the library and committed. This record
				stays exactly as it is.
			</Dialog.Description>
		</Dialog.Header>
		<form
			class="grid gap-3"
			onsubmit={(e) => {
				e.preventDefault();
				void promote();
			}}
		>
			<label class={field}>Title<input class={control} bind:value={title} required /></label>
			<div class="grid grid-cols-2 gap-3">
				<label class={field}
					>Shelf<select class={control} bind:value={shelf}
						>{#each shelves as s (s)}<option value={s}>{shelfName(s)}</option>{/each}</select
					></label
				>
				<label class={field}
					>Folder<select class={control} bind:value={folder}
						>{#each shelfFolders as f (f)}<option value={f}>{f}</option>{/each}<option value={NEW}
							>New folder…</option
						></select
					></label
				>
			</div>
			{#if folder === NEW}
				<label class={field}
					>New folder<input
						class="{control} font-mono"
						bind:value={newFolder}
						placeholder="e.g. research"
					/></label
				>
			{/if}
			<div class="grid grid-cols-2 gap-3">
				<label class={field}>Name<input class="{control} font-mono" bind:value={slug} /></label>
				<label class={field}
					>Tags<input class={control} bind:value={tags} placeholder="comma, separated" /></label
				>
			</div>
			{#if record.prototypes.length}
				<p class="text-xs text-muted-foreground">
					Its prototype is not copied; the library document links to it instead.
				</p>
			{/if}
			<p
				class="flex items-start gap-2 rounded-md border border-hair bg-muted px-2.5 py-2 font-mono text-xs break-all"
				data-commit-preview
			>
				<GitCommitHorizontal class="size-3.5 shrink-0" aria-hidden="true" />{commit}
			</p>
			{#if error}<p class="text-sm text-danger" role="alert">{error}</p>{/if}
			<Dialog.Footer>
				<Dialog.Close>
					{#snippet child({ props })}<Button {...props} variant="ghost" type="button">Cancel</Button
						>{/snippet}
				</Dialog.Close>
				<Button type="submit" disabled={busy || !title.trim()}
					>{#if busy}<LoaderCircle class="size-4 animate-spin" />{/if}Promote</Button
				>
			</Dialog.Footer>
		</form>
	</Dialog.Content>
</Dialog.Root>
