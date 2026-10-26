<script lang="ts">
	import { page } from '$app/state';
	import { invalidateAll } from '$app/navigation';
	import { currentFleet, live } from '$lib/client/live.svelte';
	import { SESSION_HEADER } from '$lib/client/messages';
	import { ago } from '$lib/format';
	import { Button } from '$lib/components/ui/button';
	import { shipPassageDraft } from '$lib/passage-meta';
	import type { PassageOrigin, PassageSource, ProjectPassage } from '$lib/types';
	import {
		ArrowLeft,
		CircleAlert,
		FileCode2,
		PencilLine,
		ShieldCheck,
		SquareTerminal
	} from '@lucide/svelte';

	let { data } = $props();

	let updated = $state<ProjectPassage | null>(null);
	let busy = $state(false);
	let error = $state<string | null>(null);
	const id = $derived(page.params.id!);
	const view = $derived(updated?.projectId === id ? updated : data.view);
	const project = $derived(currentFleet()?.projects.find((p) => p.id === id));
	const name = $derived(project?.name ?? id);

	const ORIGIN: Record<PassageOrigin, string> = {
		builtin: 'Built-in',
		project: 'Project file',
		captain: 'Your config'
	};
	const STATE: Record<PassageSource['state'], string> = {
		absent: 'Not present',
		applied: 'In use',
		invalid: 'Left out: has errors',
		unreadable: 'Could not be read'
	};
	const TRACK = { ship: 'Ship work', scout: 'Scout work' };

	async function consent(digest: string | null, what: 'consent' | 'commands' = 'consent') {
		busy = true;
		error = null;
		try {
			const res = await fetch(`/api/projects/${encodeURIComponent(id)}/passage/${what}`, {
				method: 'POST',
				headers: {
					'content-type': 'application/json',
					[SESSION_HEADER]: page.data.sessionToken as string
				},
				body: JSON.stringify({ digest })
			});
			const body = await res.json().catch(() => null);
			if (res.ok && body?.schema === 'wheelhouse-passage.v1') updated = body;
			else {
				error =
					typeof body?.message === 'string' ? body.message : `Wheelhouse answered ${res.status}.`;
				if (res.status === 409) await invalidateAll();
			}
		} catch {
			error = 'Could not reach the Wheelhouse server.';
		} finally {
			busy = false;
		}
	}
</script>

<svelte:head><title>{name} passage · Wheelhouse</title></svelte:head>

<main class="px-4 pt-8 pb-24 sm:px-6 lg:px-10">
	<a
		href="/?project={encodeURIComponent(id)}"
		class="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
		><ArrowLeft class="size-4" aria-hidden="true" />{name}</a
	>

	{#if !view}
		<p class="mt-10 text-muted-foreground">{data.problem ?? 'Loading…'}</p>
	{:else}
		<div class="mt-6 max-w-3xl">
			<p class="text-sm text-muted-foreground">
				{name}{view.readAt ? `, files read ${ago(view.readAt, live.now)}` : ''}
			</p>
			<div class="mt-1 flex flex-wrap items-center gap-x-4 gap-y-2">
				<h1 class="text-2xl font-semibold tracking-tight">Passage</h1>
				{#if id !== 'unassigned'}
					<Button variant="outline" size="sm" href="/projects/{encodeURIComponent(id)}/passage/edit"
						><PencilLine aria-hidden="true" />Edit passage</Button
					>
				{/if}
			</div>
			<p class="mt-2 leading-relaxed text-muted-foreground">
				The steps this project’s tasks pass through, and the checks that observe them. Wheelhouse
				starts from its built-in passage, then layers the project’s <code class="font-mono text-sm"
					>.wheelhouse.yaml</code
				> from its default branch (never a task branch), then your own Wheelhouse config.
			</p>
		</div>

		<section class="mt-10 max-w-3xl" aria-labelledby="files">
			<h2 id="files" class="text-sm font-medium">Passage files</h2>
			<ul class="mt-3 space-y-3">
				{#each view.sources as s (s.kind)}
					<li class="rounded-xl border p-4" data-source={s.kind} data-state={s.state}>
						<div class="flex flex-wrap items-baseline gap-x-3 gap-y-1">
							<FileCode2 class="size-4 self-center text-muted-foreground" aria-hidden="true" />
							<span class="font-medium"
								>{s.kind === 'project' ? 'Project file' : 'Your config'}</span
							>
							<span
								class="text-sm {s.state === 'applied'
									? 'text-success'
									: s.state === 'absent'
										? 'text-muted-foreground'
										: 'text-danger'}">{STATE[s.state]}</span
							>
						</div>
						<p class="mt-1 font-mono text-xs break-all text-muted-foreground">{s.location}</p>
						{#if s.pending}
							<p class="mt-2 text-sm text-warning" data-pending>
								An edited version is saved in the project’s clone but is not on the default branch
								yet, so this one is still in use.
							</p>
							<div class="mt-2 flex flex-wrap gap-2">
								<Button
									variant="outline"
									size="sm"
									href="/?draft={encodeURIComponent(shipPassageDraft(name))}"
									>Ask Firstmate to ship it</Button
								>
								<Button
									variant="ghost"
									size="sm"
									href="/projects/{encodeURIComponent(id)}/passage/edit">Open the editor</Button
								>
							</div>
						{/if}
						{#if s.errors.length}
							<ul class="mt-3 space-y-1 text-sm text-danger">
								{#each s.errors as e, i (i)}
									<li class="flex gap-2">
										<CircleAlert class="mt-0.5 size-4 shrink-0" aria-hidden="true" /><span
											class="min-w-0 font-mono text-xs leading-5 break-words">{e}</span
										>
									</li>
								{/each}
							</ul>
							<p class="mt-2 text-xs text-muted-foreground">
								This file is left out until it is fixed; the passage uses the layers below it.
							</p>
						{/if}
					</li>
				{/each}
			</ul>
			{#if view.notes.length}
				<ul class="mt-3 space-y-1 text-sm text-muted-foreground">
					{#each view.notes as n (n)}<li>{n}</li>{/each}
				</ul>
			{/if}
		</section>

		{#if view.consent.needed}
			{@const network = view.passages.flatMap((p) =>
				p.checks.filter((c) => c.origin === 'project' && c.network)
			)}
			<section
				class="mt-8 max-w-3xl rounded-xl p-4 {view.consent.enabled ? 'border' : 'bg-sea/10'}"
				aria-labelledby="consent"
			>
				<h2
					id="consent"
					class="flex items-center gap-2 text-sm font-medium {view.consent.enabled
						? ''
						: 'text-sea'}"
				>
					<ShieldCheck class="size-4" aria-hidden="true" />
					{view.consent.enabled
						? 'The project file’s checks are on'
						: 'The project file’s network checks are off'}
				</h2>
				<p class="mt-2 text-sm leading-relaxed">
					The project file asks Wheelhouse to read {network.length === 1
						? 'this'
						: `these ${network.length}`} from the network, with your GitHub CLI login where it reads GitHub:
				</p>
				<ul class="mt-2 list-disc space-y-1 pl-5 text-sm">
					{#each network as c (c.id)}
						<li><span class="font-mono text-xs">{c.type}</span> {c.params}</li>
					{/each}
				</ul>
				<p class="mt-2 text-xs text-muted-foreground">
					These network checks only observe; they never deploy or change anything. This version of
					the file has sha256 <span class="font-mono">{view.consent.digest?.slice(0, 12)}</span>; a
					changed file is off again until you enable it.{view.consent.enabledAt
						? ` Enabled ${ago(view.consent.enabledAt, live.now)}.`
						: ''}
				</p>
				{#if view.consent.unavailable}
					<p class="mt-3 text-sm text-danger">{view.consent.unavailable}</p>
				{:else}
					<div class="mt-4 flex gap-2">
						{#if view.consent.enabled}
							<Button variant="outline" size="sm" disabled={busy} onclick={() => consent(null)}
								>Turn these checks off</Button
							>
						{:else}
							<Button size="sm" disabled={busy} onclick={() => consent(view.consent.digest)}
								>Enable these checks</Button
							>
						{/if}
					</div>
				{/if}
				{#if error}<p class="mt-2 text-sm text-danger" role="alert">{error}</p>{/if}
			</section>
		{/if}

		{#if view.commands.list.length}
			{@const c = view.commands}
			<section
				class="mt-8 max-w-3xl rounded-xl p-4 {c.enabled ? 'border' : 'bg-sea/10'}"
				aria-labelledby="commands"
				data-commands={c.enabled ? 'on' : 'off'}
			>
				<h2
					id="commands"
					class="flex items-center gap-2 text-sm font-medium {c.enabled ? '' : 'text-sea'}"
				>
					<SquareTerminal class="size-4" aria-hidden="true" />
					{c.enabled ? 'Command checks are allowed' : 'Command checks are off'}
				</h2>
				<p class="mt-2 text-sm leading-relaxed">
					The passage asks Wheelhouse to run {c.list.length === 1
						? 'this program'
						: `these ${c.list.length} programs`} on this machine, in the project’s folder. Exactly what
					runs:
				</p>
				<ul class="mt-3 space-y-3">
					{#each c.list as cmd (cmd.id)}
						<li class="rounded-lg border bg-card p-3 text-sm" data-command={cmd.id}>
							<p class="font-medium">
								{cmd.label}<span class="font-normal text-muted-foreground"
									>, from {ORIGIN[cmd.origin].toLowerCase()}</span
								>
							</p>
							<pre
								class="mt-2 overflow-x-auto rounded-md bg-terminal px-3 py-2 font-mono text-xs text-terminal-foreground">{cmd.line}</pre>
							<p class="mt-2 text-xs text-muted-foreground">
								At {cmd.cwd === '.' ? 'the top of the project' : `${cmd.cwd}, inside the project`},
								for at most {cmd.timeout}, {cmd.when ? `only once ${cmd.when}, ` : ''}{cmd.ref ===
								'merge.commit'
									? 'once per merged commit'
									: cmd.ref === 'pr.head'
										? 'once per pull request commit'
										: 'as soon as a task can use it'}, retried every {cmd.interval} until it passes. It
								gets only {[...c.baseEnv, ...cmd.env].join(', ')} from Wheelhouse’s environment.
							</p>
						</li>
					{/each}
				</ul>
				<p class="mt-3 text-xs text-muted-foreground">
					Commands run directly, never through a shell, one at a time, and only for tasks that land
					after you allow them. Any change to a command turns them off again.{c.enabledAt
						? ` Allowed ${ago(c.enabledAt, live.now)}.`
						: ''}
				</p>
				{#if view.consent.unavailable}
					<p class="mt-3 text-sm text-danger">{view.consent.unavailable}</p>
				{:else}
					<div class="mt-4 flex gap-2">
						{#if c.enabled}
							<Button
								variant="outline"
								size="sm"
								disabled={busy}
								onclick={() => consent(null, 'commands')}>Turn command checks off</Button
							>
						{:else}
							<Button size="sm" disabled={busy} onclick={() => consent(c.digest, 'commands')}
								>Allow these commands to run</Button
							>
						{/if}
					</div>
				{/if}
				{#if error}<p class="mt-2 text-sm text-danger" role="alert">{error}</p>{/if}
			</section>
		{/if}

		{#each view.passages as p (p.track)}
			<section class="mt-12" aria-labelledby="track-{p.track}">
				<h2 id="track-{p.track}" class="text-sm font-medium">
					{TRACK[p.track]}<span class="font-normal text-muted-foreground"
						>{p.custom ? '' : ' (built-in passage)'}{p.live
							? `, counted as live from ${p.steps.find((s) => s.id === p.live)?.label ?? p.live}`
							: ''}</span
					>
				</h2>
				<ol class="mt-3 divide-y rounded-xl border">
					{#each p.steps as s, i (s.id)}
						<li
							class="grid gap-x-6 gap-y-1 px-4 py-3 text-sm md:grid-cols-[12rem_minmax(0,1fr)]"
							data-step={s.id}
						>
							<div class="min-w-0">
								<p class="font-medium">
									<span class="tabular mr-1 text-muted-foreground">{i + 1}.</span>{s.label}
								</p>
								<p class="text-xs text-muted-foreground">
									{ORIGIN[s.origin]}{s.changedBy.length
										? `, changed by ${s.changedBy.map((o) => ORIGIN[o].toLowerCase()).join(' and ')}`
										: ''}
								</p>
							</div>
							<dl class="min-w-0 space-y-0.5 text-xs">
								{#if s.reachedWhen}<div class="flex gap-2">
										<dt class="w-20 shrink-0 text-muted-foreground">Reached</dt>
										<dd class="min-w-0 break-words">{s.reachedWhen}</dd>
									</div>{/if}
								{#if s.failedWhen}<div class="flex gap-2">
										<dt class="w-20 shrink-0 text-muted-foreground">Failed</dt>
										<dd class="min-w-0 break-words">{s.failedWhen}</dd>
									</div>{/if}
								{#if s.skipWhen}<div class="flex gap-2">
										<dt class="w-20 shrink-0 text-muted-foreground">Skipped</dt>
										<dd class="min-w-0 break-words">{s.skipWhen}</dd>
									</div>{/if}
								{#if s.evidence.length}<div class="flex gap-2">
										<dt class="w-20 shrink-0 text-muted-foreground">Shows</dt>
										<dd class="min-w-0 break-words">{s.evidenceWords.join(', ')}</dd>
									</div>{/if}
								{#if s.primaryLink}<div class="flex gap-2">
										<dt class="w-20 shrink-0 text-muted-foreground">Link</dt>
										<dd class="min-w-0">
											{p.checks.find((c) => `${c.id}.url` === s.primaryLink)?.label ??
												s.primaryLink}
										</dd>
									</div>{/if}
								{#if s.giveUpAfter}<div class="flex gap-2">
										<dt class="w-20 shrink-0 text-muted-foreground">Gives up</dt>
										<dd>after {s.giveUpAfter}</dd>
									</div>{/if}
								{#if s.note}<p class="pt-1 text-muted-foreground">{s.note}</p>{/if}
								{#if s.rules.reached || s.rules.failed || s.rules.skipped}
									<details class="pt-1 text-muted-foreground">
										<summary class="cursor-pointer">Rule as written</summary>
										<p class="mt-1 font-mono break-words">
											{[
												s.rules.reached ? `reached_when: ${s.rules.reached}` : '',
												s.rules.failed ? `failed_when: ${s.rules.failed}` : '',
												s.rules.skipped ? `skip_when: ${s.rules.skipped}` : ''
											]
												.filter(Boolean)
												.join(' · ')}
										</p>
									</details>
								{/if}
							</dl>
						</li>
					{/each}
				</ol>

				{#if p.checks.length}
					<h3 class="mt-6 text-xs font-medium text-muted-foreground">Checks</h3>
					<ul class="mt-2 divide-y rounded-xl border">
						{#each p.checks as c (c.id)}
							<li
								class="grid gap-x-6 gap-y-1 px-4 py-3 text-sm md:grid-cols-[12rem_minmax(0,1fr)]"
								data-check={c.id}
							>
								<div class="min-w-0">
									<p class="font-medium">{c.label}</p>
									<p class="text-xs text-muted-foreground">
										{ORIGIN[c.origin]}{c.enabled
											? ''
											: c.command
												? ', off until allowed'
												: ', off until enabled'}
									</p>
								</div>
								<div class="min-w-0 text-xs">
									<p><span class="font-mono">{c.type}</span>: {c.params}</p>
									<p class="mt-0.5 text-muted-foreground">
										{c.interval === 'read with the fleet'
											? 'Read with the fleet'
											: `Every ${c.interval}`}{c.network
											? ', over the network'
											: c.command
												? ', on this machine'
												: ''}
									</p>
								</div>
							</li>
						{/each}
					</ul>
				{/if}
			</section>
		{/each}

		<p class="mt-10 max-w-3xl text-xs text-muted-foreground">
			See Wheelhouse’s
			<a
				class="underline underline-offset-2 hover:text-foreground"
				href="https://github.com/chrisjowen/wheelhouse/blob/main/docs/passages.md"
				target="_blank"
				rel="noreferrer">Passage files guide</a
			> for the format.
		</p>
	{/if}
</main>
