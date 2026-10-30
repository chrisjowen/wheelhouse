<script lang="ts">
	import { page } from '$app/state';
	import { ChevronRight, Eye, EyeOff, KeyRound, Lock } from '@lucide/svelte';
	import { SESSION_HEADER } from '$lib/client/messages';
	import type { SlotEntry } from '$lib/plugins/types';
	import type { Project } from '$lib/types';
	import { andList, SECRET_NAME, type VaultChange, type VaultSecret } from '$lib/vault';
	import { Button } from '$lib/components/ui/button';

	/**
	 * The Vault page (the Vault plugin's `vault/overview` panel): every secret
	 * by name, which projects may use each, and recent use. From here the captain
	 * adds a secret, replaces its value, changes who can use it and removes it.
	 * Changes go to Wheelhouse (POST /api/vault), which runs the bundled
	 * wh-vault; the plugin itself stays read-only. A value is typed here once,
	 * sent once and never shown again: no answer carries it, and the page
	 * forgets it as soon as it is sent.
	 */

	interface Use {
		at: string;
		task: string | null;
		taskKnown: boolean;
		project: string | null;
		names: string[];
		program: string | null;
		result: string;
	}
	interface Overview {
		secrets: VaultSecret[];
		used: Use[];
		problem: string | null;
	}

	let { data, entry }: { data: unknown; entry: SlotEntry } = $props();
	const given = $derived(data as Overview);

	// What the last change answered, until the plugin's own read is newer.
	let fresh = $state<{ secrets: VaultSecret[]; at: number } | null>(null);
	const secrets = $derived.by(() => {
		const read = entry.content.available ? Date.parse(entry.content.observedAt ?? '') : NaN;
		return fresh && !(read > fresh.at) ? fresh.secrets : given.secrets;
	});

	// Every project Wheelhouse knows, then any other a secret is granted to.
	const projects = $derived.by(() => {
		const known = ((page.data.fleet?.projects ?? []) as Project[]).map((p) => p.id);
		const granted = secrets.flatMap((s) => s.projects).filter((p) => !known.includes(p));
		return [...known, ...[...new Set(granted)].sort()];
	});

	let open = $state<string | null>(null);
	let adding = $state(false);
	let replacing = $state<string | null>(null);
	let confirming = $state<string | null>(null);
	let busy = $state(false);
	let notice = $state<string | null>(null);
	let error = $state<string | null>(null);

	// The add form. `value` is the only place a value lives, and only until it is sent.
	let name = $state('');
	let value = $state('');
	let grants = $state<string[]>([]);
	let reveal = $state(false);
	let nameError = $state('');
	let replaceValue = $state('');

	/** A time as the captain reads it, in this computer's time zone, to the minute. */
	function stamp(iso: string | null): string {
		if (!iso) return 'Never';
		const d = new Date(iso);
		if (Number.isNaN(d.getTime())) return iso;
		const p = (n: number) => String(n).padStart(2, '0');
		return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
	}

	function forgetValues() {
		value = '';
		replaceValue = '';
		reveal = false;
	}

	function startAdd() {
		name = '';
		grants = [];
		nameError = '';
		notice = null;
		error = null;
		forgetValues();
		adding = true;
	}

	function closeAdd() {
		adding = false;
		forgetValues();
	}

	/** Send one change; true when it was made. */
	async function send(change: VaultChange): Promise<boolean> {
		busy = true;
		error = null;
		notice = null;
		try {
			const r = await fetch('/api/vault', {
				method: 'POST',
				headers: {
					'content-type': 'application/json',
					[SESSION_HEADER]: page.data.sessionToken as string
				},
				body: JSON.stringify(change)
			});
			const body = (await r.json().catch(() => null)) as {
				message?: string;
				secrets?: VaultSecret[];
				observedAt?: string;
			} | null;
			if (!r.ok) {
				error = body?.message ?? `Wheelhouse could not do that (${r.status}).`;
				return false;
			}
			if (body?.secrets) {
				fresh = { secrets: body.secrets, at: Date.parse(body.observedAt ?? '') || Date.now() };
			}
			notice = body?.message ?? 'Done.';
			return true;
		} catch {
			error = 'Wheelhouse could not be reached. Try again.';
			return false;
		} finally {
			busy = false;
		}
	}

	async function store(e: SubmitEvent) {
		e.preventDefault();
		if (!SECRET_NAME.test(name)) {
			nameError =
				'Use letters, digits and underscores, not starting with a digit, like VERCEL_TOKEN.';
			return;
		}
		if (!value) return;
		const change: VaultChange = { action: 'set', name, value, projects: grants };
		// The value leaves the page with this request; the form forgets it whatever the answer.
		value = '';
		reveal = false;
		if (await send(change)) {
			adding = false;
			open = name;
		}
	}

	async function replace(e: SubmitEvent, s: VaultSecret) {
		e.preventDefault();
		if (!replaceValue) return;
		const change: VaultChange = { action: 'set', name: s.name, value: replaceValue, projects: [] };
		replaceValue = '';
		reveal = false;
		if (await send(change)) replacing = null;
	}

	async function toggle(s: VaultSecret, p: string, on: boolean, box: HTMLInputElement) {
		// A change that did not happen leaves the box as it was.
		if (!(await send({ action: on ? 'grant' : 'revoke', name: s.name, projects: [p] })))
			box.checked = !on;
	}

	async function remove(s: VaultSecret) {
		if (await send({ action: 'remove', name: s.name })) {
			confirming = null;
			open = null;
		}
	}

	function openRow(n: string) {
		open = open === n ? null : n;
		confirming = null;
		replacing = null;
		forgetValues();
	}
</script>

{#snippet valueField(id: string, get: () => string, set: (v: string) => void)}
	<div class="relative">
		<input
			{id}
			type={reveal ? 'text' : 'password'}
			autocomplete="off"
			autocapitalize="off"
			spellcheck="false"
			data-1p-ignore
			data-lpignore="true"
			value={get()}
			oninput={(e) => set((e.currentTarget as HTMLInputElement).value)}
			disabled={busy}
			class="h-10 w-full rounded-md border border-input bg-background px-3 pr-10 font-mono text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
		/>
		<button
			type="button"
			class="absolute inset-y-0 right-0 flex w-10 items-center justify-center rounded-r-md text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
			aria-label={reveal ? 'Hide what you typed' : 'Show what you typed'}
			aria-pressed={reveal}
			onclick={() => (reveal = !reveal)}
		>
			{#if reveal}<EyeOff class="size-4" />{:else}<Eye class="size-4" />{/if}
		</button>
	</div>
{/snippet}

{#snippet projectChecks(
	legend: string,
	selected: string[],
	onchange: (p: string, on: boolean, box: HTMLInputElement) => void
)}
	{#if projects.length}
		<div class="grid gap-x-6 gap-y-2 sm:grid-cols-2" role="group" aria-label={legend}>
			{#each projects as p (p)}
				<label class="flex min-w-0 items-center gap-2 text-sm">
					<input
						type="checkbox"
						class="size-4 shrink-0 accent-[var(--sea)]"
						checked={selected.includes(p)}
						disabled={busy}
						onchange={(e) => {
							const box = e.currentTarget as HTMLInputElement;
							onchange(p, box.checked, box);
						}}
					/>
					<span class="truncate">{p}</span>
				</label>
			{/each}
		</div>
	{:else}
		<p class="text-sm text-muted-foreground">Wheelhouse knows no projects yet.</p>
	{/if}
{/snippet}

<div class="flex flex-wrap items-start justify-between gap-4">
	<p class="max-w-prose text-sm text-muted-foreground">
		Secrets your projects can use by name. Values stay in your Mac’s login Keychain; Wheelhouse
		never shows one.
	</p>
	{#if secrets.length && !adding}
		<Button onclick={startAdd} disabled={busy}>Add a secret</Button>
	{/if}
</div>

{#if notice}
	<p
		class="mt-5 rounded-md border border-success/40 bg-success/5 px-4 py-2.5 text-sm"
		role="status"
	>
		{notice}
	</p>
{/if}
{#if error}
	<p class="mt-5 rounded-md border border-danger/40 bg-danger/5 px-4 py-2.5 text-sm" role="alert">
		{error}
	</p>
{/if}
{#if given.problem}
	<p class="mt-5 text-sm text-muted-foreground">{given.problem}</p>
{/if}

{#if adding}
	<section
		class="mt-6 rounded-lg border border-hair bg-background/60 px-5 py-5"
		aria-labelledby="vault-add"
	>
		<h2 id="vault-add" class="font-display text-lg">Add a secret</h2>
		<p class="mt-0.5 mb-5 text-xs text-muted-foreground">
			Storing a name that already exists replaces its value.
		</p>
		<form class="grid gap-5" onsubmit={store}>
			<div class="grid max-w-md gap-1.5">
				<label for="vault-name" class="text-sm font-medium">Name</label>
				<input
					id="vault-name"
					autocomplete="off"
					autocapitalize="characters"
					spellcheck="false"
					placeholder="VERCEL_TOKEN"
					bind:value={name}
					oninput={() => (nameError = '')}
					disabled={busy}
					aria-invalid={nameError ? 'true' : undefined}
					aria-describedby="vault-name-help"
					class="h-10 w-full rounded-md border border-input bg-background px-3 font-mono text-sm outline-none placeholder:text-muted-foreground/60 focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60 aria-invalid:border-danger"
				/>
				{#if nameError}
					<p id="vault-name-help" class="text-sm text-danger" role="alert">{nameError}</p>
				{:else}
					<p id="vault-name-help" class="text-xs text-muted-foreground">
						The environment variable a command receives it as: letters, digits and underscores.
					</p>
				{/if}
			</div>
			<div class="grid max-w-md gap-1.5">
				<label for="vault-value" class="text-sm font-medium">Value</label>
				{@render valueField(
					'vault-value',
					() => value,
					(v) => (value = v)
				)}
				<p class="flex items-start gap-1.5 text-xs text-muted-foreground">
					<Lock class="mt-px size-3.5 shrink-0" />
					Goes straight into your Mac’s login Keychain. Wheelhouse cannot show it again.
				</p>
			</div>
			<div class="grid gap-2">
				<p class="text-sm font-medium">Projects that may use it</p>
				<p class="-mt-1 mb-1 text-xs text-muted-foreground">
					Optional. You can change this any time.
				</p>
				{@render projectChecks('Projects that may use it', grants, (p, on) => {
					grants = on ? [...grants, p] : grants.filter((x) => x !== p);
				})}
			</div>
			<div class="flex flex-wrap gap-2">
				<Button type="submit" disabled={busy || !name || !value}>Store secret</Button>
				<Button type="button" variant="outline" disabled={busy} onclick={closeAdd}>Cancel</Button>
			</div>
		</form>
	</section>
{/if}

{#if !secrets.length && !adding}
	<div class="mt-6 rounded-lg border border-dashed px-6 py-10">
		<KeyRound class="size-6 text-brass" aria-hidden="true" />
		<p class="mt-3 font-display text-lg">The vault is empty</p>
		<p class="mt-1 max-w-prose text-sm text-muted-foreground">
			Add the tokens and keys your projects need. The crew uses them by name and never sees a value.
		</p>
		<Button class="mt-5" onclick={startAdd} disabled={busy}>Add a secret</Button>
	</div>
{:else if secrets.length}
	<ul class="mt-6 divide-y divide-hair border-y border-hair" aria-label="Secrets">
		{#each secrets as s (s.name)}
			<li>
				<button
					class="flex min-h-12 w-full items-center gap-4 px-1 py-3 text-left outline-none hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring"
					aria-expanded={open === s.name}
					aria-controls="vault-{s.name}"
					onclick={() => openRow(s.name)}
				>
					<KeyRound class="size-4 shrink-0 text-brass" aria-hidden="true" />
					<span class="min-w-0 flex-1 truncate font-mono text-sm font-medium">{s.name}</span>
					<span class="hidden min-w-0 flex-wrap justify-end gap-1.5 sm:flex">
						{#each s.projects as p (p)}
							<span class="rounded border border-hair px-1.5 py-0.5 text-xs">{p}</span>
						{:else}
							<span class="text-xs text-muted-foreground">No project yet</span>
						{/each}
					</span>
					<ChevronRight
						class="size-4 shrink-0 text-muted-foreground transition-transform {open === s.name
							? 'rotate-90'
							: ''}"
						aria-hidden="true"
					/>
				</button>
				{#if open === s.name}
					<div
						id="vault-{s.name}"
						class="grid gap-6 px-1 pt-1 pb-5 sm:grid-cols-[minmax(0,1fr)_minmax(0,18rem)] sm:pl-9"
					>
						<div>
							<p class="mb-2 text-sm font-medium">Projects that may use it</p>
							{@render projectChecks(`Projects that may use ${s.name}`, s.projects, (p, on, box) =>
								toggle(s, p, on, box)
							)}
							<p class="mt-3 text-xs text-muted-foreground">
								{s.projects.length
									? `A command ${andList(s.projects)} ${s.projects.length === 1 ? 'runs' : 'run'} through the vault gets it in its environment, that command only.`
									: 'No project can use it until you tick one.'}
							</p>
						</div>
						<div class="grid content-start gap-3 text-sm">
							<p class="tabular text-xs text-muted-foreground">
								Value set {stamp(s.updatedAt)}<br />Last used {stamp(s.lastUsedAt)}
							</p>
							{#if replacing === s.name}
								<form class="grid gap-2" onsubmit={(e) => replace(e, s)}>
									<label for="vault-replace" class="text-xs font-medium">New value</label>
									{@render valueField(
										'vault-replace',
										() => replaceValue,
										(v) => (replaceValue = v)
									)}
									<div class="flex flex-wrap gap-2">
										<Button type="submit" size="sm" disabled={busy || !replaceValue}>Replace</Button
										>
										<Button
											type="button"
											size="sm"
											variant="outline"
											disabled={busy}
											onclick={() => {
												replacing = null;
												forgetValues();
											}}>Cancel</Button
										>
									</div>
								</form>
							{:else if confirming === s.name}
								<p>
									Remove <span class="font-mono">{s.name}</span>? Its value is deleted from the
									Keychain and every project loses it. This cannot be undone.
								</p>
								<div class="flex flex-wrap gap-2">
									<Button size="sm" variant="destructive" disabled={busy} onclick={() => remove(s)}
										>Remove</Button
									>
									<Button
										size="sm"
										variant="outline"
										disabled={busy}
										onclick={() => (confirming = null)}>Keep it</Button
									>
								</div>
							{:else}
								<div class="flex flex-wrap gap-2">
									<Button
										size="sm"
										variant="outline"
										disabled={busy}
										onclick={() => {
											replacing = s.name;
											notice = null;
										}}>Replace value</Button
									>
									<Button
										size="sm"
										variant="ghost"
										class="text-danger hover:text-danger"
										disabled={busy}
										onclick={() => (confirming = s.name)}>Remove…</Button
									>
								</div>
							{/if}
						</div>
					</div>
				{/if}
			</li>
		{/each}
	</ul>
{/if}

{#if given.used.length}
	<h2 class="section-label mt-10">Recent use</h2>
	<div class="mt-3 no-scrollbar overflow-x-auto">
		<table class="w-full text-sm">
			<thead class="text-left text-xs text-muted-foreground">
				<tr class="border-b border-hair">
					<th class="py-2 pr-4 font-medium">When</th>
					<th class="py-2 pr-4 font-medium">Task</th>
					<th class="py-2 pr-4 font-medium">Project</th>
					<th class="py-2 pr-4 font-medium">Secrets</th>
					<th class="py-2 pr-4 font-medium">Command</th>
					<th class="py-2 font-medium">Result</th>
				</tr>
			</thead>
			<tbody class="divide-y divide-hair">
				{#each given.used as u, i (i)}
					<tr>
						<td class="tabular py-2 pr-4 whitespace-nowrap">{stamp(u.at)}</td>
						<td class="py-2 pr-4">
							{#if u.task && u.taskKnown}
								<a class="text-sea hover:underline" href="/tasks/{encodeURIComponent(u.task)}"
									>{u.task}</a
								>
							{:else}
								{u.task ?? '—'}
							{/if}
						</td>
						<td class="py-2 pr-4">{u.project ?? '—'}</td>
						<td class="py-2 pr-4 font-mono text-xs">{u.names.join(', ') || '—'}</td>
						<td class="py-2 pr-4">{u.program ?? '—'}</td>
						<td class="py-2">{u.result}</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
{/if}
