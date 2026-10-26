<script lang="ts">
	import { onMount, untrack } from 'svelte';
	import { beforeNavigate, goto } from '$app/navigation';
	import {
		ArrowLeft,
		ArrowRight,
		Check,
		FilePlus2,
		LoaderCircle,
		Send,
		Trash2
	} from '@lucide/svelte';
	import { Button } from '$lib/components/ui/button';
	import { currentFleet } from '$lib/client/live.svelte';
	import { SESSION_HEADER } from '$lib/client/messages';
	import { composerBus } from '$lib/components/firstmate/bus.svelte';
	import SectionFields from '$lib/components/wh/spec/SectionFields.svelte';
	import SpecPreview from '$lib/components/wh/spec/SpecPreview.svelte';
	import { ago } from '$lib/format';
	import {
		SPEC_SECTIONS,
		sectionFilled,
		specMarkdown,
		specMessage,
		specTitle,
		summarize,
		type SpecDraft,
		type SpecImage,
		type SpecSummary
	} from '$lib/spec';

	/**
	 * The Spec tab: a guided spec built one section at a time, previewed as it
	 * grows, saved as the captain types, and sent to Firstmate as one message
	 * through the chat's own composer.
	 */
	let { data } = $props();

	/** Firstmate takes at most 64 KiB in one message. */
	const MAX_MESSAGE_BYTES = 64 * 1024;

	const clone = (d: SpecDraft | null) => (d ? (JSON.parse(JSON.stringify(d)) as SpecDraft) : null);
	// svelte-ignore state_referenced_locally
	const initial = clone(data.draft);
	let draft = $state<SpecDraft | null>(initial);
	// svelte-ignore state_referenced_locally
	let specs = $state<SpecSummary[]>(data.specs);
	let step = $state(0);
	let savedJson = JSON.stringify(initial);
	let saveState = $state<'saved' | 'unsaved' | 'saving' | 'error'>('saved');
	let saveError = $state<string | null>(null);
	let uploading = $state(false);
	let uploadError = $state<string | null>(null);
	let confirmDelete = $state(false);
	let busy = $state(false);
	let now = $state(Date.now());

	// A different draft (or a fresh load): start from what the server has.
	let loadedId = initial?.id ?? null;
	$effect(() => {
		const next = data.draft;
		const list = data.specs;
		untrack(() => {
			specs = list;
			if ((next?.id ?? null) === loadedId && draft) return;
			loadedId = next?.id ?? null;
			draft = clone(next);
			savedJson = JSON.stringify(draft);
			saveState = 'saved';
			step = 0;
			confirmDelete = false;
		});
	});

	const fleet = $derived(currentFleet());
	const projects = $derived((fleet?.projects ?? []).map((p) => p.name).filter(Boolean));
	const section = $derived(SPEC_SECTIONS[step]);
	const imageUrl = (img: SpecImage) =>
		`/api/specs/${encodeURIComponent(draft?.id ?? '')}/images/${encodeURIComponent(img.name)}`;
	const preview = $derived(draft ? specMarkdown(draft, imageUrl) : '');
	const message = $derived(
		draft && data.imageDir ? specMessage(draft, (img) => `${data.imageDir}/${img.name}`) : ''
	);
	const tooLong = $derived(new TextEncoder().encode(message).byteLength > MAX_MESSAGE_BYTES);
	const filled = $derived(draft ? SPEC_SECTIONS.filter((s) => sectionFilled(draft!, s.id)) : []);

	const headers = (extra: Record<string, string> = {}) => ({
		[SESSION_HEADER]: data.sessionToken,
		...extra
	});

	async function problem(res: Response): Promise<string> {
		const body = (await res.json().catch(() => null)) as { message?: string } | null;
		return body?.message ?? `Wheelhouse answered ${res.status}.`;
	}

	// Save shortly after the captain stops typing.
	let timer: ReturnType<typeof setTimeout> | undefined;
	$effect(() => {
		if (!draft) return;
		const json = JSON.stringify(draft);
		if (json === savedJson) return;
		untrack(() => {
			saveState = 'unsaved';
			clearTimeout(timer);
			timer = setTimeout(() => void save(), 600);
		});
	});

	async function save(keepalive = false): Promise<boolean> {
		clearTimeout(timer);
		if (!draft) return true;
		const snapshot = $state.snapshot(draft) as SpecDraft;
		const json = JSON.stringify(snapshot);
		if (json === savedJson) return true;
		saveState = 'saving';
		try {
			const res = await fetch(`/api/specs/${encodeURIComponent(snapshot.id)}`, {
				method: 'PUT',
				headers: headers({ 'content-type': 'application/json' }),
				body: json,
				keepalive
			});
			if (!res.ok) {
				saveError = await problem(res);
				saveState = 'error';
				return false;
			}
			const stored = ((await res.json()) as { draft: SpecDraft }).draft;
			savedJson = json;
			saveError = null;
			specs = specs.map((s) => (s.id === stored.id ? summarize(stored) : s));
			saveState = draft && JSON.stringify(draft) !== json ? 'unsaved' : 'saved';
			return true;
		} catch {
			saveError = 'Could not reach the Wheelhouse server.';
			saveState = 'error';
			return false;
		}
	}

	beforeNavigate(() => {
		if (saveState !== 'saved') void save(true);
	});

	onMount(() => {
		const tick = setInterval(() => (now = Date.now()), 30_000);
		const flush = () => {
			if (saveState !== 'saved') void save(true);
		};
		window.addEventListener('pagehide', flush);
		return () => {
			clearInterval(tick);
			window.removeEventListener('pagehide', flush);
		};
	});

	async function newSpec() {
		busy = true;
		if (!(await save())) {
			busy = false;
			return;
		}
		try {
			const res = await fetch('/api/specs', { method: 'POST', headers: headers() });
			if (!res.ok) {
				saveError = await problem(res);
				saveState = 'error';
				return;
			}
			const { draft: d } = (await res.json()) as { draft: SpecDraft };
			await goto(`/spec?id=${encodeURIComponent(d.id)}`, { invalidateAll: true });
		} finally {
			busy = false;
		}
	}

	async function remove() {
		if (!draft) return;
		busy = true;
		clearTimeout(timer);
		const res = await fetch(`/api/specs/${encodeURIComponent(draft.id)}`, {
			method: 'DELETE',
			headers: headers()
		}).catch(() => null);
		busy = false;
		confirmDelete = false;
		if (!res?.ok && res?.status !== 404) {
			saveError = res ? await problem(res) : 'Could not reach the Wheelhouse server.';
			saveState = 'error';
			return;
		}
		savedJson = 'null';
		draft = null;
		loadedId = null;
		await goto('/spec', { invalidateAll: true, replaceState: true });
	}

	async function upload(files: File[]) {
		if (!draft) return;
		uploading = true;
		uploadError = null;
		for (const f of files) {
			try {
				const res = await fetch(`/api/specs/${encodeURIComponent(draft.id)}/images`, {
					method: 'POST',
					headers: headers({
						'content-type': f.type,
						'x-caption': encodeURIComponent(f.name.replace(/\.[^.]+$/, ''))
					}),
					body: f
				});
				if (!res.ok) {
					uploadError = await problem(res);
					continue;
				}
				const stored = ((await res.json()) as { draft: SpecDraft }).draft;
				const captions = new Map(draft.images.map((i) => [i.name, i.caption]));
				draft.images = stored.images.map((i) => ({
					...i,
					caption: captions.get(i.name) ?? i.caption
				}));
			} catch {
				uploadError = 'Could not reach the Wheelhouse server.';
			}
		}
		uploading = false;
	}

	async function removeImage(img: SpecImage) {
		if (!draft) return;
		const res = await fetch(
			`/api/specs/${encodeURIComponent(draft.id)}/images/${encodeURIComponent(img.name)}`,
			{ method: 'DELETE', headers: headers() }
		).catch(() => null);
		if (res?.ok || res?.status === 404) {
			draft.images = draft.images.filter((i) => i.name !== img.name);
		} else {
			uploadError = res ? await problem(res) : 'Could not reach the Wheelhouse server.';
		}
	}

	/** Hand the spec to the chat's composer, which sends it, and go there to watch it arrive. */
	async function send() {
		if (!draft || !message || tooLong) return;
		busy = true;
		const saved = await save();
		busy = false;
		if (!saved) return;
		const snapshot = $state.snapshot(draft) as SpecDraft;
		const token = data.sessionToken;
		composerBus.outgoing = {
			text: message,
			onSent: () => {
				void fetch(`/api/specs/${encodeURIComponent(snapshot.id)}`, {
					method: 'PUT',
					headers: { 'content-type': 'application/json', [SESSION_HEADER]: token },
					body: JSON.stringify({ ...snapshot, sentAt: new Date().toISOString() })
				});
			}
		};
		await goto('/');
	}

	const saveLabel = $derived(
		saveState === 'saving'
			? 'Saving…'
			: saveState === 'unsaved'
				? 'Unsaved changes'
				: saveState === 'error'
					? 'Not saved'
					: 'Saved'
	);
</script>

<svelte:head><title>Spec · Wheelhouse</title></svelte:head>

<main class="px-4 py-8 sm:px-6 lg:px-10">
	<h1 class="text-2xl">Write a spec</h1>
	<p class="mt-1 max-w-prose text-sm text-muted-foreground">
		Build a spec one section at a time, then send it to Firstmate as a single message. Every section
		is optional; the preview shows exactly what Firstmate will read.
	</p>

	{#if data.problem}
		<p class="mt-8 rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
			{data.problem}
		</p>
	{:else}
		<div
			class="mt-8 grid items-start gap-8 lg:grid-cols-[15rem_minmax(0,1fr)] xl:grid-cols-[15rem_minmax(0,1fr)_minmax(0,1fr)]"
		>
			<!-- Drafts and the outline -->
			<aside class="min-w-0 space-y-8 lg:sticky lg:top-20">
				<section aria-labelledby="specs-heading">
					<h2 id="specs-heading" class="section-label">Your specs</h2>
					<Button
						variant="outline"
						size="sm"
						class="mt-3 w-full justify-start"
						onclick={newSpec}
						disabled={busy}
					>
						<FilePlus2 aria-hidden="true" />New spec
					</Button>
					{#if specs.length}
						<ul class="mt-3 space-y-0.5">
							{#each specs as s (s.id)}
								<li>
									<a
										href="/spec?id={encodeURIComponent(s.id)}"
										aria-current={draft?.id === s.id ? 'page' : undefined}
										class="block rounded-md border-l-2 px-3 py-2 hover:bg-muted {draft?.id === s.id
											? 'border-brass bg-accent'
											: 'border-transparent'}"
									>
										<span class="block truncate text-sm font-medium"
											>{draft?.id === s.id ? specTitle(draft) : s.title}</span
										>
										<span class="block truncate text-xs text-muted-foreground">
											{[
												(draft?.id === s.id ? draft.project.trim() : s.project) || null,
												s.sentAt ? 'Sent' : null,
												`edited ${ago(s.updatedAt, now)}`
											]
												.filter(Boolean)
												.join(' · ')}
										</span>
									</a>
								</li>
							{/each}
						</ul>
					{/if}
				</section>

				{#if draft}
					<nav aria-labelledby="outline-heading">
						<h2 id="outline-heading" class="section-label">Sections</h2>
						<ol class="mt-3 space-y-0.5">
							{#each SPEC_SECTIONS as s, i (s.id)}
								{@const done = sectionFilled(draft, s.id)}
								<li>
									<button
										onclick={() => (step = i)}
										aria-current={step === i ? 'step' : undefined}
										class="flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted {step ===
										i
											? 'bg-accent font-medium'
											: 'text-muted-foreground'}"
									>
										<span
											class="tabular flex size-5 shrink-0 items-center justify-center rounded-full border text-[0.7rem] {done
												? 'border-sea bg-sea text-white dark:text-slate-950'
												: 'border-hair'}"
										>
											{#if done}<Check class="size-3" aria-label="Written" />{:else}{i + 1}{/if}
										</span>
										<span class="truncate {step === i ? 'text-foreground' : ''}">{s.title}</span>
									</button>
								</li>
							{/each}
						</ol>
						<p class="mt-3 px-2 text-xs text-muted-foreground">
							{filled.length} of {SPEC_SECTIONS.length} sections written
						</p>
					</nav>
				{/if}
			</aside>

			{#if !draft}
				<section
					class="rounded-lg border border-dashed p-8 lg:col-span-1 xl:col-span-2"
					aria-label="No spec open"
				>
					<h2 class="font-display text-xl font-medium">Start a spec for Firstmate</h2>
					<p class="mt-2 max-w-prose text-sm text-muted-foreground">
						You will be guided through nine short sections: the project, the problem, who it is for,
						how they use it, what is in and out, how you will know it is done, how it should look,
						what to watch out for, and what is still open. Your work is saved as you go.
					</p>
					<Button class="mt-5" onclick={newSpec} disabled={busy}>
						<FilePlus2 aria-hidden="true" />Start a spec
					</Button>
				</section>
			{:else}
				<!-- The current section -->
				<section class="min-w-0" aria-labelledby="section-heading">
					<div class="flex items-baseline gap-3">
						<p class="text-xs tracking-wide text-muted-foreground">
							Step {step + 1} of {SPEC_SECTIONS.length}
						</p>
						<p
							class="ml-auto text-xs {saveState === 'error'
								? 'text-danger'
								: 'text-muted-foreground'}"
							aria-live="polite"
						>
							{saveLabel}
						</p>
					</div>
					<h2 id="section-heading" class="mt-1 font-display text-2xl font-medium">
						{section.title}
					</h2>
					<p class="mt-1 max-w-prose text-sm text-muted-foreground">{section.prompt}</p>
					<p
						class="mt-3 max-w-prose border-l-2 border-hair pl-3 text-sm text-muted-foreground italic"
					>
						<span class="not-italic">For example:</span>
						{section.example}
					</p>
					{#if saveState === 'error' && saveError}
						<p class="mt-3 text-sm text-danger" role="alert">{saveError}</p>
					{/if}

					<div class="mt-6">
						<SectionFields
							{draft}
							section={section.id}
							{projects}
							{imageUrl}
							onUpload={upload}
							onRemoveImage={removeImage}
							{uploading}
							{uploadError}
						/>
					</div>

					<div class="mt-8 flex items-center gap-3 border-t border-hair pt-5">
						<Button variant="ghost" onclick={() => (step -= 1)} disabled={step === 0}>
							<ArrowLeft aria-hidden="true" />Back
						</Button>
						{#if step < SPEC_SECTIONS.length - 1}
							<Button variant="outline" onclick={() => (step += 1)}>
								Next: {SPEC_SECTIONS[step + 1].title}<ArrowRight aria-hidden="true" />
							</Button>
						{:else}
							<p class="text-sm text-muted-foreground">
								That is every section. Read the preview, then send it.
							</p>
						{/if}
						<div class="ml-auto">
							{#if confirmDelete}
								<span class="mr-2 text-sm text-muted-foreground">Delete this spec for good?</span>
								<Button variant="destructive" size="sm" onclick={remove} disabled={busy}
									>Delete</Button
								>
								<Button variant="ghost" size="sm" onclick={() => (confirmDelete = false)}
									>Keep it</Button
								>
							{:else}
								<Button
									variant="ghost"
									size="sm"
									class="text-muted-foreground"
									onclick={() => (confirmDelete = true)}
								>
									<Trash2 aria-hidden="true" />Delete
								</Button>
							{/if}
						</div>
					</div>
				</section>

				<!-- The assembled spec -->
				<section
					class="min-w-0 lg:col-start-2 xl:sticky xl:top-20 xl:col-start-3 xl:row-start-1"
					aria-labelledby="preview-heading"
				>
					<div class="flex flex-wrap items-center gap-3">
						<h2 id="preview-heading" class="section-label flex-1">Preview</h2>
						<Button onclick={send} disabled={busy || tooLong || !message}>
							{#if busy}<LoaderCircle class="animate-spin" aria-hidden="true" />{:else}<Send
									aria-hidden="true"
								/>{/if}
							{draft.sentAt ? 'Send again' : 'Send to Firstmate'}
						</Button>
					</div>
					<p class="mt-2 text-xs text-muted-foreground">
						{#if tooLong}
							<span class="text-danger"
								>This spec is too long for one message. Shorten a section to send it.</span
							>
						{:else if draft.sentAt}
							Sent to Firstmate {ago(draft.sentAt, now)}.
						{:else}
							Opens the Firstmate chat and sends the spec there as one message.
						{/if}
					</p>
					<div class="mt-4 xl:max-h-[calc(100dvh-12rem)] xl:overflow-y-auto">
						<SpecPreview text={preview} />
					</div>
				</section>
			{/if}
		</div>
	{/if}
</main>
