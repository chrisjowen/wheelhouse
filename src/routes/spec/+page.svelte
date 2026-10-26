<script lang="ts">
	import { onMount, untrack } from 'svelte';
	import { beforeNavigate, goto } from '$app/navigation';
	import { ChevronDown, FilePlus2, Hammer, LoaderCircle, Trash2 } from '@lucide/svelte';
	import { Button } from '$lib/components/ui/button';
	import { currentFleet } from '$lib/client/live.svelte';
	import { SESSION_HEADER } from '$lib/client/messages';
	import { composerBus } from '$lib/components/firstmate/bus.svelte';
	import Interview from '$lib/components/wh/spec/Interview.svelte';
	import QuickForm from '$lib/components/wh/spec/QuickForm.svelte';
	import SpecDocument from '$lib/components/wh/spec/SpecDocument.svelte';
	import { ago } from '$lib/format';
	import {
		specMarkdown,
		specMessage,
		specTitle,
		summarize,
		type SpecDraft,
		type SpecImage,
		type SpecMode,
		type SpecSectionId,
		type SpecSummary
	} from '$lib/spec';

	/**
	 * The Spec tab: an interviewer (the local claude CLI) grills the captain
	 * one question at a time and writes the spec alongside as they answer; the
	 * captain comments on the spec and the interviewer addresses each comment.
	 * The quick form writes the same spec by hand. Saved as it goes, and sent
	 * to Firstmate as one build request through the chat's own composer.
	 */
	let { data } = $props();

	const clone = (d: SpecDraft | null) => (d ? (JSON.parse(JSON.stringify(d)) as SpecDraft) : null);
	// svelte-ignore state_referenced_locally
	const initial = clone(data.draft);
	let draft = $state<SpecDraft | null>(initial);
	// svelte-ignore state_referenced_locally
	let specs = $state<SpecSummary[]>(data.specs);
	let savedJson = JSON.stringify(initial);
	let saveState = $state<'saved' | 'unsaved' | 'saving' | 'error'>('saved');
	let saveError = $state<string | null>(null);
	let uploading = $state(false);
	let uploadError = $state<string | null>(null);
	let confirmDelete = $state(false);
	let busy = $state(false);
	let now = $state(Date.now());

	// The interviewer's turn, while it runs.
	// svelte-ignore state_referenced_locally
	let working = $state(!!data.interviewer?.busy);
	let streaming = $state('');
	let activity = $state<string | null>(null);
	let turnError = $state<string | null>(null);
	let pendingAnswer = $state<string | null>(null);
	/** Comments arrived while the interviewer worked: it takes another turn after. */
	let commentsWaiting = false;
	/** Narrow screens show the interview or the spec, one at a time. */
	let pane = $state<'interview' | 'spec'>('interview');
	let specUnseen = $state(false);

	// A different draft (or a fresh load): start from what the server has.
	let loadedId = initial?.id ?? null;
	$effect(() => {
		const next = data.draft;
		const list = data.specs;
		const serverBusy = !!data.interviewer?.busy;
		untrack(() => {
			specs = list;
			if ((next?.id ?? null) === loadedId && draft) return;
			loadedId = next?.id ?? null;
			draft = clone(next);
			savedJson = JSON.stringify(draft);
			saveState = 'saved';
			confirmDelete = false;
			turnError = null;
			streaming = '';
			pendingAnswer = null;
			working = serverBusy;
			if (serverBusy) void waitForTurn();
		});
	});

	const fleet = $derived(currentFleet());
	const projects = $derived((fleet?.projects ?? []).map((p) => p.name).filter(Boolean));
	const imageUrl = (img: SpecImage) =>
		`/api/specs/${encodeURIComponent(draft?.id ?? '')}/images/${encodeURIComponent(img.name)}`;
	const preview = $derived(draft ? specMarkdown(draft, imageUrl) : '');
	// What "As sent" shows: the message, with each screenshot named rather than its file path.
	const asSent = $derived(
		draft
			? specMessage(draft, () => 'attached').replace(
					/!\[([^\]]*)\]\(<attached>\)/g,
					'[Screenshot: $1, sent as a file]'
				)
			: ''
	);
	const lastAgent = $derived(draft?.interview.turns.findLast((t) => t.role === 'agent') ?? null);
	const changed = $derived<SpecSectionId[]>(lastAgent?.changed ?? []);
	const openComments = $derived(draft?.comments.filter((c) => !c.resolvedAt).length ?? 0);
	// A build request says what it is and which project it is for.
	const hasWhat = $derived(!!draft && (!!draft.title.trim() || !!draft.summary.trim()));
	const hasProject = $derived(!!draft?.project.trim());
	const editedSinceSent = (s: { sentAt: string | null; updatedAt: string }) =>
		!!s.sentAt && Date.parse(s.updatedAt) - Date.parse(s.sentAt) > 5000;
	const canSend = $derived(hasWhat && hasProject && !busy && !working);

	const headers = (extra: Record<string, string> = {}) => ({
		[SESSION_HEADER]: data.sessionToken,
		...extra
	});

	async function problem(res: Response): Promise<string> {
		const body = (await res.json().catch(() => null)) as { message?: string } | null;
		return body?.message ?? `Wheelhouse answered ${res.status}.`;
	}

	/** Take the server's copy of the draft (after a turn or a comment). */
	function adopt(d: SpecDraft | null | undefined) {
		if (!d || d.id !== draft?.id) return;
		// Edits the captain has not saved yet win over the server's copy of those fields.
		const local = saveState === 'saved' ? null : { project: draft.project, mode: draft.mode };
		const next = clone(d)!;
		savedJson = JSON.stringify(next);
		if (local) Object.assign(next, local);
		draft = next;
		specs = specs.map((s) => (s.id === d.id ? summarize(d) : s));
		if (pendingAnswer && d.interview.turns.at(-1)?.role === 'captain') pendingAnswer = null;
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

	// One save at a time, in order, so an older edit never lands after a newer one.
	let saving: Promise<boolean> = Promise.resolve(true);
	function save(keepalive = false): Promise<boolean> {
		clearTimeout(timer);
		saving = saving.then(() => saveNow(keepalive));
		return saving;
	}

	async function saveNow(keepalive: boolean): Promise<boolean> {
		if (!draft) return true;
		const snapshot = $state.snapshot(draft) as SpecDraft;
		const json = JSON.stringify(snapshot);
		if (json === savedJson) {
			saveState = 'saved';
			return true;
		}
		saveState = 'saving';
		const base = JSON.parse(savedJson) as SpecDraft | null;
		const edited = (['project', 'title', 'mode'] as const).filter((f) => base?.[f] !== snapshot[f]);
		try {
			const res = await fetch(`/api/specs/${encodeURIComponent(snapshot.id)}`, {
				method: 'PUT',
				headers: headers({ 'content-type': 'application/json' }),
				body: JSON.stringify({ ...snapshot, edited }),
				keepalive
			});
			if (!res.ok) {
				saveError = await problem(res);
				saveState = 'error';
				return false;
			}
			const stored = ((await res.json()) as { draft: SpecDraft }).draft;
			saveError = null;
			specs = specs.map((s) => (s.id === stored.id ? summarize(stored) : s));
			if (draft?.id === stored.id) {
				// What the server kept is what the page shows, unless the captain typed on meanwhile.
				savedJson = JSON.stringify(stored);
				if (JSON.stringify($state.snapshot(draft)) === json) draft = clone(stored);
				if (pendingAnswer && stored.interview.turns.at(-1)?.role === 'captain')
					pendingAnswer = null;
			}
			saveState = draft && JSON.stringify(draft) !== savedJson ? 'unsaved' : 'saved';
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

	// Narrow screens fold the drafts list so the work comes first.
	let wide = $state(true);
	onMount(() => {
		wide = window.matchMedia('(min-width: 1024px)').matches;
		const clock = setInterval(() => (now = Date.now()), 30_000);
		const flush = () => {
			if (saveState !== 'saved') void save(true);
		};
		window.addEventListener('pagehide', flush);
		return () => {
			clearInterval(clock);
			window.removeEventListener('pagehide', flush);
		};
	});

	/** Server-sent events from a response body, as they arrive. */
	async function* events(res: Response): AsyncGenerator<{ event: string; data: unknown }> {
		const reader = res.body!.pipeThrough(new TextDecoderStream()).getReader();
		let buf = '';
		for (;;) {
			const { value, done } = await reader.read();
			if (done) return;
			buf += value;
			let end: number;
			while ((end = buf.indexOf('\n\n')) >= 0) {
				const chunk = buf.slice(0, end);
				buf = buf.slice(end + 2);
				const event = /^event: (.*)$/m.exec(chunk)?.[1];
				const body = /^data: (.*)$/m.exec(chunk)?.[1];
				if (event && body) yield { event, data: JSON.parse(body) };
			}
		}
	}

	/**
	 * One interviewer turn, streamed. Resolves true once the server has the
	 * captain's answer (even if the interviewer then fails; the answer stays
	 * in the interview with a way to ask again).
	 */
	async function runTurn(answer: string | null): Promise<boolean> {
		if (!draft || working) return false;
		const id = draft.id;
		if (!(await save())) return false;
		working = true;
		streaming = '';
		activity = null;
		turnError = null;
		pendingAnswer = answer;
		let accepted = false;
		try {
			const res = await fetch(`/api/specs/${encodeURIComponent(id)}/turn`, {
				method: 'POST',
				headers: headers({ 'content-type': 'application/json' }),
				body: JSON.stringify(answer ? { answer } : {})
			});
			if (!res.ok || !res.body) {
				turnError = await problem(res);
				if (res.status === 409) void waitForTurn();
				return false;
			}
			accepted = true;
			for await (const e of events(res)) {
				const d = e.data as {
					text?: string;
					name?: string;
					detail?: string;
					message?: string;
					draft?: SpecDraft | null;
				};
				if (e.event === 'text') {
					streaming += d.text ?? '';
					activity = null;
				} else if (e.event === 'reset') streaming = '';
				else if (e.event === 'tool') activity = `Reading ${d.detail || d.name}`;
				else if (e.event === 'done') {
					adopt(d.draft);
					if (pane === 'interview' && lastAgent?.changed.length) specUnseen = true;
				} else if (e.event === 'error') {
					turnError = d.message ?? 'The interviewer stopped.';
					adopt(d.draft);
				}
			}
			return true;
		} catch {
			turnError ??=
				'Lost touch with the Wheelhouse server. Reload to see where the interview got to.';
			return accepted;
		} finally {
			if (draft?.id === id) {
				working = false;
				streaming = '';
				activity = null;
				pendingAnswer = null;
				if (commentsWaiting) {
					commentsWaiting = false;
					void runTurn(null);
				}
			}
		}
	}

	/** The interviewer is busy with this draft elsewhere (a reload mid-turn): wait, then show its turn. */
	async function waitForTurn() {
		const id = draft?.id;
		if (!id) return;
		working = true;
		for (;;) {
			await new Promise((r) => setTimeout(r, 1500));
			if (draft?.id !== id) return;
			const res = await fetch(`/api/specs/${encodeURIComponent(id)}`).catch(() => null);
			if (!res?.ok) continue;
			const body = (await res.json()) as { draft: SpecDraft; busy: boolean };
			if (body.busy) continue;
			adopt(body.draft);
			working = false;
			if (turnError?.startsWith('The interviewer is already')) turnError = null;
			return;
		}
	}

	async function addComment(c: { section: SpecSectionId; quote: string; text: string }) {
		if (!draft) return false;
		const res = await fetch(`/api/specs/${encodeURIComponent(draft.id)}/comments`, {
			method: 'POST',
			headers: headers({ 'content-type': 'application/json' }),
			body: JSON.stringify(c)
		}).catch(() => null);
		if (!res?.ok) {
			turnError = res ? await problem(res) : 'Could not reach the Wheelhouse server.';
			return false;
		}
		adopt(((await res.json()) as { draft: SpecDraft }).draft);
		// The interviewer addresses it now, or straight after the turn it is on.
		if (working) commentsWaiting = true;
		else void runTurn(null);
		return true;
	}

	async function removeComment(commentId: string) {
		if (!draft) return;
		const res = await fetch(
			`/api/specs/${encodeURIComponent(draft.id)}/comments/${encodeURIComponent(commentId)}`,
			{ method: 'DELETE', headers: headers() }
		).catch(() => null);
		if (res?.ok) adopt(((await res.json()) as { draft: SpecDraft }).draft);
	}

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

	/**
	 * Hand the build request to the chat's composer, which sends it, and go
	 * there to watch it arrive. The server makes the message from the saved
	 * draft, attaching the spec as a file when it is too long for one message.
	 */
	async function send() {
		if (!draft || !canSend) return;
		busy = true;
		const id = draft.id;
		try {
			if (!(await save())) return;
			const res = await fetch(`/api/specs/${encodeURIComponent(id)}/build-request`, {
				method: 'POST',
				headers: headers()
			}).catch(() => null);
			if (!res?.ok) {
				saveError = res ? await problem(res) : 'Could not reach the Wheelhouse server.';
				saveState = 'error';
				return;
			}
			const { message } = (await res.json()) as { message: string };
			const token = data.sessionToken;
			composerBus.outgoing = {
				text: message,
				from: `/spec?id=${encodeURIComponent(id)}`,
				onSent: () => {
					void fetch(`/api/specs/${encodeURIComponent(id)}/sent`, {
						method: 'POST',
						headers: { [SESSION_HEADER]: token }
					});
				}
			};
			await goto('/');
		} finally {
			busy = false;
		}
	}

	function setMode(m: SpecMode) {
		if (draft) draft.mode = m;
	}

	function showPane(p: 'interview' | 'spec') {
		pane = p;
		if (p === 'spec') specUnseen = false;
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
	const sendHint = $derived.by(() => {
		if (!draft) return '';
		if (!hasWhat) return 'Send to build once the spec has a title or a summary.';
		if (!hasProject) return 'Choose the project it is for, then send it to build.';
		if (working) return 'Wait for the interviewer to finish its turn.';
		if (draft.sentAt) {
			return `Sent to build ${ago(draft.sentAt, now)}${editedSinceSent(draft) ? '; edited since' : ''}.`;
		}
		return `Sends the spec to Firstmate as one build request for ${draft.project.trim()}.`;
	});
</script>

<svelte:head><title>Spec · Wheelhouse</title></svelte:head>

<main class="px-4 py-6 sm:px-6 lg:px-10">
	<!-- The page reads on one solid sheet; the graph paper shows only in the gutter. -->
	<div class="surface px-4 py-6 sm:px-8 sm:py-8">
		<h1 class="text-2xl">Write a spec</h1>
		<p class="mt-1 max-w-prose text-sm text-muted-foreground">
			An interviewer asks you one question at a time and writes the spec as you answer. Comment on
			anything in the spec to have it changed, then send it to build.
		</p>

		{#if data.problem}
			<p class="mt-8 rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
				{data.problem}
			</p>
		{:else}
			<div class="mt-8 grid items-start gap-8 lg:grid-cols-[14rem_minmax(0,1fr)]">
				<!-- Drafts -->
				<aside class="min-w-0 lg:sticky lg:top-20">
					<details class="group" open={wide}>
						<summary
							class="section-label list-none lg:pointer-events-none [&::-webkit-details-marker]:hidden"
						>
							<span id="specs-heading">Your specs</span><span class="lg:hidden"
								>&nbsp;({specs.length})</span
							>
							<ChevronDown
								class="size-4 shrink-0 transition-transform group-open:rotate-180 lg:hidden"
								aria-hidden="true"
							/>
						</summary>
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
							<ul class="mt-3 space-y-0.5" aria-labelledby="specs-heading">
								{#each specs as s (s.id)}
									{@const open = draft?.id === s.id}
									<li>
										<a
											href="/spec?id={encodeURIComponent(s.id)}"
											aria-current={open ? 'page' : undefined}
											class="block rounded-md border-l-2 px-3 py-2 hover:bg-muted {open
												? 'border-brass bg-accent'
												: 'border-transparent'}"
										>
											<span class="block truncate text-sm font-medium"
												>{open && draft ? specTitle(draft) : s.title}</span
											>
											<span class="block truncate text-xs text-muted-foreground">
												{[
													(open && draft ? draft.project.trim() : s.project) || null,
													s.sentAt ? (editedSinceSent(s) ? 'Edited since sent' : 'Sent') : null,
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
					</details>
				</aside>

				{#if !draft}
					<section class="rounded-lg border border-dashed p-8" aria-label="No spec open">
						<h2 class="font-display text-xl font-medium">Start a spec for Firstmate</h2>
						<p class="mt-2 max-w-prose text-sm text-muted-foreground">
							Say what you want built. An interviewer grills you on it one question at a time,
							offering answers with the one it recommends, and writes the spec as you go: the
							problem, who it is for, how they use it, what is in and out, how you will know it is
							done, and what to watch out for. Your work is saved as you go.
						</p>
						<Button class="mt-5" onclick={newSpec} disabled={busy}>
							<FilePlus2 aria-hidden="true" />Start a spec
						</Button>
					</section>
				{:else}
					<div class="min-w-0">
						<!-- How it is being built, which project it is for, and sending it -->
						<div class="flex flex-wrap items-center gap-x-4 gap-y-3 border-b border-hair pb-4">
							<div
								class="flex rounded-md border border-hair p-0.5"
								role="radiogroup"
								aria-label="Build the spec with"
							>
								{#each [['interview', 'Interview'], ['form', 'Quick form']] as const as [m, label] (m)}
									<button
										role="radio"
										aria-checked={draft.mode === m}
										onclick={() => setMode(m)}
										class="rounded px-3 py-1 text-sm {draft.mode === m
											? 'bg-accent font-medium text-foreground'
											: 'text-muted-foreground hover:text-foreground'}">{label}</button
									>
								{/each}
							</div>
							<label class="flex min-w-0 items-center gap-2 text-sm">
								<span class="text-muted-foreground">Project</span>
								<input
									class="h-8 w-44 min-w-0 rounded-md border border-input bg-card px-2.5 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
									name="project"
									list="spec-projects"
									bind:value={draft.project}
									placeholder="Choose a project"
								/>
								<datalist id="spec-projects">
									{#each projects as p (p)}<option value={p}></option>{/each}
								</datalist>
							</label>
							<p
								class="text-xs {saveState === 'error' ? 'text-danger' : 'text-muted-foreground'}"
								aria-live="polite"
							>
								{saveLabel}
							</p>
							<div class="ml-auto flex items-center gap-2">
								{#if !confirmDelete}
									<Button
										variant="ghost"
										size="sm"
										class="text-muted-foreground"
										onclick={() => (confirmDelete = true)}
									>
										<Trash2 aria-hidden="true" />Delete
									</Button>
								{/if}
								<Button onclick={send} disabled={!canSend}>
									{#if busy}<LoaderCircle class="animate-spin" aria-hidden="true" />{:else}<Hammer
											aria-hidden="true"
										/>{/if}
									{draft.sentAt ? 'Send to build again' : 'Send to build'}
								</Button>
							</div>
						</div>
						<p class="mt-2 text-xs text-muted-foreground">{sendHint}</p>
						{#if saveState === 'error' && saveError}
							<p class="mt-2 text-sm text-danger" role="alert">{saveError}</p>
						{/if}
						{#if confirmDelete}
							<div
								class="mt-3 flex flex-wrap items-center gap-3 rounded-md border border-danger/30 bg-danger/5 px-4 py-3"
								role="group"
								aria-label="Delete this spec"
							>
								<p class="text-sm">
									Delete “{specTitle(draft)}”, its interview and its screenshots for good?
								</p>
								<div class="ml-auto flex gap-2">
									<Button variant="ghost" size="sm" onclick={() => (confirmDelete = false)}
										>Keep it</Button
									>
									<Button variant="destructive" size="sm" onclick={remove} disabled={busy}
										>Delete</Button
									>
								</div>
							</div>
						{/if}

						<div class="mt-6">
							{#if draft.mode === 'form'}
								<QuickForm
									{draft}
									{projects}
									{imageUrl}
									{preview}
									{asSent}
									onUpload={upload}
									onRemoveImage={removeImage}
									{uploading}
									{uploadError}
								/>
							{:else}
								<div
									class="mb-4 flex rounded-md border border-hair p-0.5 xl:hidden"
									role="tablist"
									aria-label="Show"
								>
									<button
										role="tab"
										aria-selected={pane === 'interview'}
										onclick={() => showPane('interview')}
										class="flex-1 rounded px-3 py-1.5 text-sm {pane === 'interview'
											? 'bg-accent font-medium'
											: 'text-muted-foreground'}">Interview</button
									>
									<button
										role="tab"
										aria-selected={pane === 'spec'}
										onclick={() => showPane('spec')}
										class="flex flex-1 items-center justify-center gap-1.5 rounded px-3 py-1.5 text-sm {pane ===
										'spec'
											? 'bg-accent font-medium'
											: 'text-muted-foreground'}"
									>
										Spec{#if openComments}<span class="text-xs text-brass">({openComments})</span
											>{/if}
										{#if specUnseen}<span
												class="size-1.5 rounded-full bg-brass"
												aria-label="Updated"
												role="img"
											></span>{/if}
									</button>
								</div>
								<div class="grid items-start gap-8 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
									<section
										class="min-w-0 {pane === 'interview' ? '' : 'hidden xl:block'}"
										aria-label="Interview"
									>
										<Interview
											{draft}
											busy={working}
											{streaming}
											{activity}
											error={turnError}
											pending={pendingAnswer}
											model={data.interviewer?.model ?? 'sonnet'}
											effort={data.interviewer?.effort ?? 'low'}
											onAnswer={(text) => runTurn(text)}
											onRetry={() => void runTurn(null)}
										/>
									</section>
									<section
										class="min-w-0 xl:sticky xl:top-20 xl:max-h-[calc(100dvh-7rem)] xl:overflow-y-auto {pane ===
										'spec'
											? ''
											: 'hidden xl:block'}"
										aria-label="The spec"
									>
										<SpecDocument
											{draft}
											{imageUrl}
											{changed}
											busy={working}
											onComment={addComment}
											onRemoveComment={removeComment}
										/>
									</section>
								</div>
							{/if}
						</div>
					</div>
				{/if}
			</div>
		{/if}
	</div>
</main>
