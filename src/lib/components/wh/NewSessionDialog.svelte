<script lang="ts">
	import { untrack } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { currentFleet } from '$lib/client/live.svelte';
	import { newSession } from '$lib/client/new-session.svelte';
	import { launchSession } from '$lib/client/sessions';
	import * as Dialog from '$lib/components/ui/dialog';
	import { Button } from '$lib/components/ui/button';
	import { Textarea } from '$lib/components/ui/textarea';
	import { LoaderCircle, SquareTerminal } from '@lucide/svelte';

	const BLANK = '';
	const projects = $derived((currentFleet()?.projects ?? []).filter((p) => p.id !== 'unassigned'));

	let choice = $state(BLANK);
	let prompt = $state('');
	let busy = $state(false);
	let error = $state<string | null>(null);

	// Each time the dialog opens it starts from the project it was opened for
	// (and only then: a fleet refresh must not reset what the captain typed).
	$effect(() => {
		if (!newSession.open) return;
		const id = newSession.projectId;
		choice = id && untrack(() => projects).some((p) => p.id === id) ? id : BLANK;
		prompt = '';
		error = null;
	});

	const chosen = $derived(projects.find((p) => p.id === choice) ?? null);

	async function launch(e: SubmitEvent) {
		e.preventDefault();
		if (busy) return;
		busy = true;
		error = null;
		const r = await launchSession(
			{ projectId: choice || null, prompt },
			page.data.sessionToken as string
		);
		busy = false;
		if (!r.ok) {
			error = r.error;
			return;
		}
		newSession.last = { session: r.session, terminalError: r.terminalError };
		newSession.open = false;
		await goto('/sessions');
	}
</script>

<Dialog.Root bind:open={newSession.open}>
	<Dialog.Content class="sm:max-w-lg">
		<Dialog.Header>
			<Dialog.Title>New session</Dialog.Title>
			<Dialog.Description>
				Opens a fresh Claude Code session in your terminal, to brainstorm or think something
				through. It is yours, not Firstmate’s crew; when it has something, hand it to Firstmate.
			</Dialog.Description>
		</Dialog.Header>

		<form class="grid gap-5" onsubmit={launch}>
			<div class="grid gap-2">
				<label for="session-project" class="text-sm font-medium">About</label>
				<select
					id="session-project"
					bind:value={choice}
					class="h-9 rounded-md border border-input bg-transparent px-2.5 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
				>
					<option value={BLANK}>Blank idea</option>
					{#each projects as p (p.id)}<option value={p.id}>{p.name}</option>{/each}
				</select>
				<p class="text-xs text-muted-foreground">
					{#if !chosen}
						A clean slate, in its own scratch directory.
					{:else if chosen.path}
						The session can read <span class="font-mono break-all">{chosen.path}</span> and is told it
						is for reading and brainstorming, not editing. It works in its own scratch directory.
					{:else}
						Wheelhouse does not know where {chosen.name} is checked out, so the session cannot read it.
					{/if}
				</p>
			</div>

			<div class="grid gap-2">
				<label for="session-prompt" class="text-sm font-medium"
					>Opening prompt <span class="font-normal text-muted-foreground">(optional)</span></label
				>
				<Textarea
					id="session-prompt"
					bind:value={prompt}
					rows={4}
					placeholder="What do you want to think through?"
					class="max-h-60"
				/>
			</div>

			{#if error}<p class="text-sm text-danger" role="alert">{error}</p>{/if}

			<Dialog.Footer>
				<Button variant="outline" type="button" onclick={() => (newSession.open = false)}
					>Cancel</Button
				>
				<Button type="submit" disabled={busy}>
					{#if busy}<LoaderCircle class="animate-spin" />{:else}<SquareTerminal />{/if}
					Open in terminal
				</Button>
			</Dialog.Footer>
		</form>
	</Dialog.Content>
</Dialog.Root>
