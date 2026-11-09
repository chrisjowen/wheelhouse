<script lang="ts">
	import { untrack } from 'svelte';
	import { KeyRound, Lock, X } from '@lucide/svelte';
	import { SESSION_HEADER } from '$lib/client/messages';
	import type { VaultRequest } from '$lib/chat/vaultrequest';
	import { SECRET_NAME, type VaultSecret, type VaultStatus } from '$lib/vault';
	import { Button } from '$lib/components/ui/button';

	/**
	 * The chat's Add a secret popup: a name, a hidden value and, optionally, the
	 * projects that may use it, stored in the vault through Wheelhouse (POST
	 * /api/vault, which runs the bundled `wh-vault set`), as the Vault page
	 * does. It opens only when the captain asks: the chat's key button, or a
	 * card under a reply where Firstmate asked for a secret (`ask`), which fills
	 * in the name, why and the projects Firstmate suggested. It never sends by
	 * itself.
	 *
	 * The value lives only in the field, and only until the request that sends
	 * it is answered or the popup closes: the field is then emptied, and the
	 * popup's form leaves the page as it closes. It is never shown (the field
	 * stays hidden), sent anywhere else or handed to the chat. A name already in
	 * the vault is refused first (`replace: false`) and stored only once the
	 * captain says to replace it; until then the typed value waits in the field.
	 * `onstored` hears only the name and the projects that can use it.
	 */
	let {
		open = $bindable(false),
		ask = null,
		projects,
		token,
		onstored
	}: {
		open?: boolean;
		/** What Firstmate asked for, to fill in; null for a blank popup. */
		ask?: VaultRequest | null;
		/** The projects Wheelhouse knows, offered as tick boxes. */
		projects: string[];
		token: string;
		/** A secret was stored: its name and every project that can use it. */
		onstored?: (name: string, projects: string[]) => void;
	} = $props();

	let dialog = $state<HTMLDialogElement | null>(null);
	let name = $state('');
	let value = $state('');
	let grants = $state<string[]>([]);
	let busy = $state(false);
	let error = $state<string | null>(null);
	let nameError = $state('');
	/** The name is already in the vault: storing replaces its value, once the captain says so. */
	let exists = $state(false);
	/** Whether a value can be stored here at all, once known. */
	let status = $state<VaultStatus | null>(null);

	const purpose = $derived(ask?.purpose ?? '');
	const unknown = $derived(ask ? ask.projects.filter((p) => !projects.includes(p)) : []);

	// Each opening starts afresh from what Firstmate asked, if anything; a project
	// list that changes while it is open leaves what the captain typed alone.
	$effect(() => {
		if (!open) return;
		untrack(() => {
			name = ask?.name ?? '';
			grants = ask ? ask.projects.filter((p) => projects.includes(p)) : [];
		});
		value = '';
		error = null;
		nameError = '';
		exists = false;
		busy = false;
		status = null;
		let stale = false;
		fetch('/api/vault')
			.then((r) => (r.ok ? (r.json() as Promise<VaultStatus>) : null))
			.then((s) => {
				if (!stale && s) status = s;
			})
			.catch(() => {});
		return () => (stale = true);
	});

	$effect(() => {
		if (!dialog) return;
		if (open && !dialog.open) dialog.showModal();
		else if (!open && dialog.open) dialog.close();
	});

	/** Close, forgetting the value. */
	function close() {
		value = '';
		exists = false;
		open = false;
	}

	async function submit(e: SubmitEvent) {
		e.preventDefault();
		if (busy) return;
		if (!SECRET_NAME.test(name)) {
			nameError =
				'Use letters, digits and underscores, not starting with a digit, like VERCEL_TOKEN.';
			return;
		}
		if (!value) return;
		busy = true;
		error = null;
		let keep = false;
		try {
			const r = await fetch('/api/vault', {
				method: 'POST',
				headers: { 'content-type': 'application/json', [SESSION_HEADER]: token },
				body: JSON.stringify({
					action: 'set',
					name,
					value,
					projects: grants,
					replace: exists
				})
			});
			const body = (await r.json().catch(() => null)) as {
				message?: string;
				secrets?: VaultSecret[];
			} | null;
			if (r.ok) {
				const stored = body?.secrets?.find((s) => s.name === name);
				const who = stored?.projects ?? grants;
				const was = name;
				close();
				onstored?.(was, who);
				return;
			}
			if (r.status === 409) {
				// Not stored: the value waits, hidden, for the captain to say replace or cancel.
				exists = true;
				keep = true;
				error = body?.message ?? `The vault already has ${name}.`;
				return;
			}
			if (r.status === 503) status = { canStore: false, reason: body?.message ?? null };
			error = body?.message ?? `Wheelhouse could not store it (${r.status}).`;
		} catch {
			error = 'Wheelhouse could not be reached. Try again.';
		} finally {
			busy = false;
			// Whatever the answer, the value is gone unless the captain is being asked to replace.
			if (!keep) value = '';
		}
	}
</script>

<dialog
	bind:this={dialog}
	class="m-auto w-[min(94vw,32rem)] max-w-none rounded-xl border bg-background p-0 text-foreground shadow-xl backdrop:bg-black/50"
	aria-labelledby="vault-add-title"
	onclose={close}
	onclick={(e) => e.target === dialog && !busy && close()}
	data-vault-add
>
	{#if open}
		<form class="grid gap-5 px-5 pt-4 pb-5" onsubmit={submit}>
			<div class="flex items-start gap-3">
				<KeyRound class="mt-1 size-5 shrink-0 text-brass" aria-hidden="true" />
				<div class="min-w-0 flex-1">
					<h2 id="vault-add-title" class="font-display text-lg">
						{ask ? 'Firstmate asks for a secret' : 'Add a secret'}
					</h2>
					{#if purpose}
						<p class="mt-0.5 text-sm text-muted-foreground" data-vault-purpose>{purpose}</p>
					{/if}
				</div>
				<button
					type="button"
					class="-mt-1 -mr-2 rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
					aria-label="Cancel"
					disabled={busy}
					onclick={close}><X class="size-4" /></button
				>
			</div>

			{#if status && !status.canStore}
				<p
					class="rounded-md border border-warning/40 bg-warning/5 px-3 py-2 text-sm"
					role="alert"
					data-vault-unavailable
				>
					{status.reason ?? 'The vault cannot store a secret on this computer.'}
				</p>
			{/if}

			<div class="grid gap-1.5">
				<label for="vault-add-name" class="text-sm font-medium">Name</label>
				<input
					id="vault-add-name"
					autocomplete="off"
					autocapitalize="characters"
					spellcheck="false"
					placeholder="VERCEL_TOKEN"
					bind:value={name}
					oninput={() => {
						nameError = '';
						exists = false;
						error = null;
					}}
					disabled={busy}
					aria-invalid={nameError ? 'true' : undefined}
					aria-describedby="vault-add-name-help"
					class="h-10 w-full rounded-md border border-input bg-background px-3 font-mono text-sm outline-none placeholder:text-muted-foreground/60 focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60 aria-invalid:border-danger"
				/>
				{#if nameError}
					<p id="vault-add-name-help" class="text-sm text-danger" role="alert">{nameError}</p>
				{:else}
					<p id="vault-add-name-help" class="text-xs text-muted-foreground">
						The environment variable a command receives it as.
					</p>
				{/if}
			</div>

			<div class="grid gap-1.5">
				<label for="vault-add-value" class="text-sm font-medium">Value</label>
				<input
					id="vault-add-value"
					type="password"
					autocomplete="off"
					autocapitalize="off"
					spellcheck="false"
					data-1p-ignore
					data-lpignore="true"
					bind:value
					disabled={busy || status?.canStore === false}
					class="h-10 w-full rounded-md border border-input bg-background px-3 font-mono text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
				/>
				<p class="flex items-start gap-1.5 text-xs text-muted-foreground">
					<Lock class="mt-px size-3.5 shrink-0" />
					Goes straight into your Mac’s login Keychain. It never appears in the chat, and Wheelhouse cannot
					show it again.
				</p>
			</div>

			<div class="grid gap-2">
				<p class="text-sm font-medium">Projects that may use it</p>
				{#if projects.length}
					<div class="grid gap-x-6 gap-y-2 sm:grid-cols-2" role="group" aria-label="Projects">
						{#each projects as p (p)}
							<label class="flex min-w-0 items-center gap-2 text-sm">
								<input
									type="checkbox"
									class="size-4 shrink-0 accent-[var(--sea)]"
									checked={grants.includes(p)}
									disabled={busy}
									onchange={(e) => {
										const on = (e.currentTarget as HTMLInputElement).checked;
										grants = on ? [...grants, p] : grants.filter((x) => x !== p);
									}}
								/>
								<span class="truncate">{p}</span>
							</label>
						{/each}
					</div>
				{:else}
					<p class="text-sm text-muted-foreground">Wheelhouse knows no projects yet.</p>
				{/if}
				<p class="text-xs text-muted-foreground">
					Optional. You can change this any time on the Vault page.
					{#if unknown.length}Firstmate also named {unknown.join(', ')}, which Wheelhouse does not
						know.{/if}
				</p>
			</div>

			{#if error}
				<p
					class="rounded-md border px-3 py-2 text-sm {exists
						? 'border-warning/40 bg-warning/5'
						: 'border-danger/40 bg-danger/5'}"
					role="alert"
				>
					{error}
				</p>
			{/if}

			<div class="flex flex-wrap justify-end gap-2">
				<Button type="button" variant="outline" disabled={busy} onclick={close}>Cancel</Button>
				<Button type="submit" disabled={busy || !name || !value || status?.canStore === false}
					>{exists ? 'Replace its value' : 'Store secret'}</Button
				>
			</div>
		</form>
	{/if}
</dialog>
