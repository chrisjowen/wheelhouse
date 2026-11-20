<script lang="ts">
	/**
	 * Bring documents into a Live discussion: pick records, library documents
	 * and prototypes by title, each either attached in full (its text goes into
	 * the crew's briefing, up to a size limit) or listed by title (the crew
	 * opens it if the discussion needs it). A prototype always goes in as its
	 * title, state and link, never its files.
	 */
	import { FileText, BookOpen, List, MonitorPlay, Paperclip, Search } from '@lucide/svelte';
	import * as Dialog from '$lib/components/ui/dialog';
	import { Button } from '$lib/components/ui/button';
	import { documents } from '$lib/client/documents.svelte';
	import { liveCall } from '$lib/client/livecall.svelte';
	import { shelfName, STATE_WORDS } from '$lib/documents';

	let { open = $bindable(false), preselect = null }: { open?: boolean; preselect?: string | null } =
		$props();

	/** About how much text the crew is given in full, in all. */
	const LIMIT = 64 * 1024;
	type Mode = 'full' | 'titles';
	let mode = $state<Mode>('full');
	let query = $state('');
	let full = $state<string[]>([]);
	let titles = $state<string[]>([]);
	let error = $state<string | null>(null);
	let busy = $state(false);

	$effect(() => {
		if (!open) return;
		documents.want();
		full = preselect ? [preselect] : [];
		titles = [];
		error = null;
	});

	interface Pick {
		ref: string;
		title: string;
		sub: string;
		bytes: number | null;
		kind: 'record' | 'library' | 'prototype';
	}
	const items = $derived.by<Pick[]>(() => {
		const i = documents.value;
		if (!i) return [];
		return [
			...i.records.map((r) => ({
				ref: r.key,
				title: r.title,
				sub: `${r.kind === 'ship' ? 'ship summary' : 'report'} · ${shelfName(r.project)}${r.mate ? ` · @${r.mate}` : ''}`,
				bytes: r.bytes,
				kind: 'record' as const
			})),
			...i.library.map((d) => ({
				ref: `lib:${d.key}`,
				title: d.title,
				sub: `library · ${shelfName(d.shelf)} / ${d.folder} · ${d.status}`,
				bytes: null,
				kind: 'library' as const
			})),
			...i.prototypes.map((p) => ({
				ref: `proto:${p.id}`,
				title: p.title,
				sub: `prototype · ${STATE_WORDS[p.state]}`,
				bytes: 0,
				kind: 'prototype' as const
			}))
		];
	});
	const shown = $derived(
		items
			.filter((i) => !query || `${i.title} ${i.sub}`.toLowerCase().includes(query.toLowerCase()))
			.slice(0, 120)
	);
	const used = $derived(
		items.filter((i) => full.includes(i.ref)).reduce((n, i) => n + (i.bytes ?? 4096), 0)
	);

	function toggle(ref: string, on: boolean) {
		const other = mode === 'full' ? 'titles' : 'full';
		if (mode === 'full') full = on ? [...full, ref] : full.filter((r) => r !== ref);
		else titles = on ? [...titles, ref] : titles.filter((r) => r !== ref);
		if (on) {
			if (other === 'titles') titles = titles.filter((r) => r !== ref);
			else full = full.filter((r) => r !== ref);
		}
	}

	async function add() {
		if (!liveCall.on) return;
		busy = true;
		// Prototypes go in as their title and state, never their files.
		const protos = full.filter((r) => r.startsWith('proto:'));
		error = await liveCall.addDocuments(
			full.filter((r) => !r.startsWith('proto:')),
			[...titles, ...protos]
		);
		busy = false;
		if (!error) open = false;
	}

	const seg = (on: boolean) =>
		`inline-flex cursor-pointer items-center gap-1.5 rounded-sm px-2.5 py-1 ${on ? 'bg-primary font-medium text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}`;
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-xl">
		<Dialog.Header>
			<Dialog.Title class="font-display text-lg"
				>Bring into <em class="text-gold">Live</em></Dialog.Title
			>
			<Dialog.Description>
				{mode === 'full'
					? 'The whole document goes into the discussion crew’s briefing.'
					: 'Only the title and where it is; the crew opens it if it needs to.'}
			</Dialog.Description>
		</Dialog.Header>
		{#if !liveCall.on}
			<p class="rounded-md border border-hair bg-muted p-3 text-sm" data-live-off>
				No Live discussion is open. Start one from the Firstmate chat, then add documents from its
				composer or from here.
			</p>
		{/if}
		<div class="flex flex-wrap items-center gap-2">
			<div class="flex rounded-md border bg-card p-0.5 text-sm" role="group" aria-label="How">
				<button
					type="button"
					class={seg(mode === 'full')}
					aria-pressed={mode === 'full'}
					onclick={() => (mode = 'full')}
					><Paperclip class="size-3.5" aria-hidden="true" />Attach in full</button
				>
				<button
					type="button"
					class={seg(mode === 'titles')}
					aria-pressed={mode === 'titles'}
					onclick={() => (mode = 'titles')}
					><List class="size-3.5" aria-hidden="true" />List by title</button
				>
			</div>
			<label
				class="flex h-8 min-w-0 flex-1 items-center gap-2 rounded-md border border-input bg-background px-2.5"
			>
				<Search class="size-3.5 text-muted-foreground" aria-hidden="true" />
				<input
					class="min-w-0 flex-1 bg-transparent text-sm outline-none"
					placeholder="Search by title"
					bind:value={query}
				/>
			</label>
		</div>
		<ul class="max-h-80 divide-y divide-hair overflow-y-auto rounded-md border" data-live-picks>
			{#each shown as i (i.ref)}
				{@const mine = mode === 'full' ? full.includes(i.ref) : titles.includes(i.ref)}
				{@const there = mode === 'full' ? titles.includes(i.ref) : full.includes(i.ref)}
				<li>
					<label
						class="flex cursor-pointer items-center gap-2.5 px-3 py-2 text-sm hover:bg-accent/50"
					>
						<input
							type="checkbox"
							checked={mine}
							onchange={(e) => toggle(i.ref, e.currentTarget.checked)}
						/>
						{#if i.kind === 'record'}<FileText
								class="size-4 shrink-0 text-teal"
								aria-hidden="true"
							/>{:else if i.kind === 'library'}<BookOpen
								class="size-4 shrink-0 text-gold"
								aria-hidden="true"
							/>{:else}<MonitorPlay class="size-4 shrink-0 text-working" aria-hidden="true" />{/if}
						<span class="min-w-0 flex-1"
							><span class="block truncate">{i.title}</span><span
								class="block truncate text-xs text-muted-foreground"
								>{i.sub}{there
									? ` · already ${mode === 'full' ? 'listed by title' : 'attached in full'}`
									: ''}</span
							></span
						>
						{#if i.kind === 'prototype'}<span class="text-xs text-muted-foreground">link only</span
							>{:else if mode === 'full' && i.bytes}<span
								class="tabular text-xs text-muted-foreground">{(i.bytes / 1024).toFixed(1)} KB</span
							>{/if}
					</label>
				</li>
			{:else}
				<li class="px-3 py-4 text-sm text-muted-foreground">No documents match.</li>
			{/each}
		</ul>
		<div>
			<div class="h-1.5 overflow-hidden rounded-full bg-muted">
				<div
					class="h-full {used > LIMIT ? 'bg-danger' : 'bg-gold'}"
					style="width:{Math.min(100, (used / LIMIT) * 100)}%"
				></div>
			</div>
			<p class="mt-1 text-xs text-muted-foreground">
				Attached in full: {full.length} · {(used / 1024).toFixed(1)} of {LIMIT / 1024} KB · Listed by
				title: {titles.length}. What does not fit is listed by title instead.
			</p>
		</div>
		{#if error}<p class="text-sm text-danger" role="alert">{error}</p>{/if}
		<Dialog.Footer>
			<Dialog.Close>
				{#snippet child({ props })}<Button {...props} variant="ghost">Cancel</Button>{/snippet}
			</Dialog.Close>
			<Button onclick={add} disabled={!liveCall.on || busy || (!full.length && !titles.length)}
				>Add to the discussion</Button
			>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
