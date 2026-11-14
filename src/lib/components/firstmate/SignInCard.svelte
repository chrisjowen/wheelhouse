<script lang="ts">
	import {
		Check,
		Copy,
		ExternalLink,
		KeyRound,
		LoaderCircle,
		SquareTerminal
	} from '@lucide/svelte';
	import { act } from '$lib/client/chat.svelte';
	import type { SignIn } from '$lib/types';

	/**
	 * A harness's sign-in screen in the Firstmate session (Claude Code's sign-in
	 * link and "Paste code here", Codex's device code, Pi's login), as a card: the
	 * sign-in page opens in a new tab, and the code it gives back is typed into
	 * the session's sign-in field by the server, which checks the same sign-in is
	 * still on screen. The card goes once the harness moves on.
	 */
	let {
		signIn,
		token,
		onterminal,
		tool = 'Claude Code'
	}: { signIn: SignIn; token: string; onterminal: () => void; tool?: string } = $props();

	let code = $state('');
	let busy = $state(false);
	let sent = $state(false);
	let copied = $state(false);
	let error = $state<string | null>(null);

	async function submit(e: SubmitEvent) {
		e.preventDefault();
		if (!code.trim() || busy) return;
		busy = true;
		error = null;
		const r = await act('/api/firstmate/signin', token, {
			signature: signIn.signature,
			code: code.trim()
		});
		busy = false;
		if (!r.ok) {
			error = r.error;
			return;
		}
		code = '';
		sent = true;
	}

	async function copyCode() {
		if (!signIn.code) return;
		try {
			await navigator.clipboard.writeText(signIn.code);
			copied = true;
			setTimeout(() => (copied = false), 1500);
		} catch {
			// clipboard unavailable: the code stays selectable
		}
	}
</script>

<div
	class="max-w-[80ch] rounded-lg border border-t-2 border-t-warning bg-card p-4"
	role="group"
	aria-label="Sign in to {tool}"
	data-sign-in
>
	<p class="mb-1 flex items-center gap-2 font-display text-[1.15rem] font-medium">
		<KeyRound class="size-4 text-warning" aria-hidden="true" />Sign in to {tool}
	</p>
	<p class="mb-4 text-sm text-muted-foreground">
		Firstmate is waiting for you to sign {tool} in before it can carry on.
	</p>
	<ol class="flex flex-col gap-4 text-sm">
		<li class="flex flex-col gap-2">
			<span
				><span class="tabular text-muted-foreground">1.</span> Open the sign-in page and sign in.</span
			>
			<a
				class="flex w-fit items-center gap-1.5 rounded-lg bg-foreground px-3 py-1.5 font-medium text-background hover:opacity-90"
				href={signIn.url}
				target="_blank"
				rel="noopener noreferrer"
				><ExternalLink class="size-4" aria-hidden="true" />Open the sign-in page</a
			>
		</li>
		{#if signIn.code}
			<li class="flex flex-col gap-2">
				<span
					><span class="tabular text-muted-foreground">2.</span> Enter this code on that page.</span
				>
				<span class="flex items-center gap-2">
					<code
						class="rounded border bg-background px-2 py-1 font-mono text-base tracking-wider select-all"
						>{signIn.code}</code
					>
					<button
						class="flex cursor-pointer items-center gap-1 text-muted-foreground hover:text-foreground"
						onclick={copyCode}
						>{#if copied}<Check class="size-4 text-success" aria-hidden="true" />Copied{:else}<Copy
								class="size-4"
								aria-hidden="true"
							/>Copy code{/if}</button
					>
				</span>
			</li>
		{/if}
		{#if signIn.paste}
			<li class="flex flex-col gap-2">
				<label for="wh-sign-in-code"
					><span class="tabular text-muted-foreground">2.</span> Paste the code the page gives you.</label
				>
				<form class="flex flex-wrap items-center gap-2" onsubmit={submit}>
					<input
						id="wh-sign-in-code"
						class="min-w-0 flex-1 rounded-lg border bg-background px-3 py-1.5 font-mono text-sm"
						autocomplete="off"
						autocapitalize="off"
						spellcheck="false"
						placeholder="Sign-in code"
						bind:value={code}
						disabled={busy}
					/>
					<button
						type="submit"
						class="flex cursor-pointer items-center gap-1.5 rounded-lg bg-foreground px-3 py-1.5 font-medium text-background disabled:cursor-default disabled:opacity-40"
						disabled={busy || !code.trim()}
						>{#if busy}<LoaderCircle class="size-4 animate-spin" aria-hidden="true" />{/if}Sign in</button
					>
				</form>
				{#if sent && !error}<p class="text-muted-foreground" role="status">
						Code sent. Waiting for {tool} to finish signing in…
					</p>{/if}
			</li>
		{:else}
			<li class="text-muted-foreground">{tool} carries on by itself once you have signed in.</li>
		{/if}
	</ol>
	{#if signIn.note}<p class="mt-3 text-xs text-muted-foreground">{signIn.note}</p>{/if}
	<div class="mt-4 flex flex-wrap items-center gap-3 text-sm">
		<button
			class="flex cursor-pointer items-center gap-1.5 text-muted-foreground hover:text-foreground"
			onclick={onterminal}
			><SquareTerminal class="size-4" aria-hidden="true" />Sign in in the terminal instead</button
		>
		{#if error}<p class="w-full text-danger" role="alert">{error}</p>{/if}
	</div>
</div>
