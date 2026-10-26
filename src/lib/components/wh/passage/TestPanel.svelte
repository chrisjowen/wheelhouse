<script lang="ts">
	import { page } from '$app/state';
	import { Button } from '$lib/components/ui/button';
	import { SESSION_HEADER } from '$lib/client/messages';
	import type { PassageCommand, PassageTestResult, PassageTestTask, Track } from '$lib/types';
	import { Check, CircleAlert, CircleDashed, CircleDot, Minus, Play, X } from '@lucide/svelte';

	/** Try the edited passage on one task: each check runs once now; nothing is saved. */
	let {
		projectId,
		target,
		text,
		track,
		tasks,
		commands,
		blocked,
		onclose
	}: {
		projectId: string;
		target: 'project' | 'captain';
		text: string;
		track: Track;
		tasks: PassageTestTask[];
		commands: PassageCommand[];
		blocked: boolean;
		onclose: () => void;
	} = $props();

	const fits = $derived(tasks.filter((t) => t.track === track));
	let taskId = $state('');
	let runCommands = $state(false);
	let busy = $state(false);
	let result = $state<PassageTestResult | null>(null);
	let error = $state<string | null>(null);
	$effect(() => {
		if (!fits.some((t) => t.id === taskId)) taskId = fits[0]?.id ?? '';
	});

	async function run() {
		busy = true;
		error = null;
		result = null;
		try {
			const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/passage/test`, {
				method: 'POST',
				headers: {
					'content-type': 'application/json',
					[SESSION_HEADER]: page.data.sessionToken as string
				},
				body: JSON.stringify({
					target,
					text,
					taskId,
					runCommands: runCommands && commands.length > 0
				})
			});
			const body = await res.json().catch(() => null);
			if (body && typeof body.ok === 'boolean') result = body;
			else
				error =
					typeof body?.message === 'string' ? body.message : `Wheelhouse answered ${res.status}.`;
		} catch {
			error = 'Could not reach the Wheelhouse server.';
		} finally {
			busy = false;
		}
	}
	const longest = $derived(commands.map((c) => c.timeout).join(', '));
</script>

<section class="rounded-xl border bg-card p-5" aria-labelledby="test-title" data-test-panel>
	<div class="flex items-start gap-3">
		<div class="min-w-0 flex-1">
			<h2 id="test-title" class="text-lg">Test this passage</h2>
			<p class="mt-1 text-sm text-muted-foreground">
				See where a task would be with your edits. Each check runs once now; nothing is saved or
				recorded.
			</p>
		</div>
		<button
			type="button"
			class="inline-flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
			aria-label="Close the test"
			onclick={onclose}><X class="size-4" aria-hidden="true" /></button
		>
	</div>

	{#if !fits.length}
		<p class="mt-4 text-sm text-muted-foreground">
			{tasks.length
				? `None of this project’s recent tasks follow the ${track === 'ship' ? 'ship' : 'scout'} passage.`
				: 'Wheelhouse has not seen any of this project’s tasks recently.'}
		</p>
	{:else}
		<div class="mt-4 flex flex-wrap items-end gap-3">
			<label class="min-w-0 flex-1 text-sm font-medium" for="test-task"
				>Task
				<select
					id="test-task"
					class="mt-1 block w-full max-w-xl rounded-md border border-input bg-card px-3 py-1.5 text-sm font-normal"
					bind:value={taskId}
				>
					{#each fits as t (t.id)}
						<option value={t.id}>{t.title}{t.step ? ` (now at ${t.step})` : ''}</option>
					{/each}
				</select>
			</label>
			<Button disabled={busy || blocked || !taskId} onclick={run}
				><Play aria-hidden="true" />{busy ? 'Testing…' : 'Run the test'}</Button
			>
		</div>
		{#if blocked}<p class="mt-2 text-sm text-danger">Fix the file’s problems to test it.</p>{/if}
		{#if commands.length}
			<div class="mt-4 rounded-lg border bg-panel p-3 text-sm">
				<label class="flex items-start gap-2">
					<input
						type="checkbox"
						class="mt-0.5 size-4 accent-[var(--sea)]"
						bind:checked={runCommands}
					/>
					<span
						>Also run {commands.length === 1 ? 'this command' : `these ${commands.length} commands`} on
						this machine now. Otherwise they are left out of the test.</span
					>
				</label>
				<ul class="mt-2 space-y-1 pl-6">
					{#each commands as c (c.id)}
						<li>
							<span class="font-medium">{c.label}:</span>
							<code class="font-mono text-xs">{c.line}</code>
							<span class="text-xs text-muted-foreground"
								>in {c.cwd === '.' ? 'the project folder' : c.cwd}, up to {c.timeout}</span
							>
						</li>
					{/each}
				</ul>
				{#if runCommands}<p class="mt-2 pl-6 text-xs text-muted-foreground">
						The test waits for them, which can take up to {longest}.
					</p>{/if}
			</div>
		{/if}
	{/if}

	{#if error}<p class="mt-3 text-sm text-danger" role="alert">{error}</p>{/if}
	{#if result && !result.ok}
		<div class="mt-4 text-sm text-danger" role="alert">
			<p>{result.message}</p>
			{#if result.errors.length}
				<ul class="mt-1 list-disc pl-5 font-mono text-xs">
					{#each result.errors as e, i (i)}<li>{e}</li>{/each}
				</ul>
			{/if}
		</div>
	{:else if result?.ok}
		{@const p = result.passage}
		{@const cur = p.steps[p.current]}
		<div class="mt-5 grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]" aria-live="polite">
			<div>
				<h3 class="text-sm font-medium">
					It would be at <span class={cur.failed ? 'text-danger' : 'text-sea'}
						>{cur.label}{cur.failed ? ', failed' : ''}</span
					>
				</h3>
				<p class="mt-1 text-xs text-muted-foreground">{p.basis}</p>
				<ol class="mt-3 space-y-1.5 text-sm">
					{#each p.steps as s (s.key)}
						<li class="flex items-start gap-2" data-state={s.state}>
							{#if s.failed}<CircleAlert
									class="mt-0.5 size-4 shrink-0 text-danger"
									aria-hidden="true"
								/>
							{:else if s.state === 'done'}<Check
									class="mt-0.5 size-4 shrink-0 text-success"
									aria-hidden="true"
								/>
							{:else if s.state === 'current'}<CircleDot
									class="mt-0.5 size-4 shrink-0 text-sea"
									aria-hidden="true"
								/>
							{:else if s.state === 'skipped'}<Minus
									class="mt-0.5 size-4 shrink-0 text-muted-foreground"
									aria-hidden="true"
								/>
							{:else}<CircleDashed
									class="mt-0.5 size-4 shrink-0 text-muted-foreground"
									aria-hidden="true"
								/>{/if}
							<span class="min-w-0">
								<span class={s.state === 'upcoming' ? 'text-muted-foreground' : ''}>{s.label}</span>
								<span class="sr-only">({s.failed ? 'failed' : s.state})</span>
								{#if s.note}<span class="block text-xs text-muted-foreground">{s.note}</span>{/if}
							</span>
						</li>
					{/each}
				</ol>
			</div>
			<div>
				<h3 class="text-sm font-medium">What each check found</h3>
				{#if !p.checks.length}
					<p class="mt-1 text-sm text-muted-foreground">This passage has no checks.</p>
				{:else}
					<ul class="mt-3 space-y-2">
						{#each p.checks as c (c.id)}
							<li class="rounded-lg border px-3 py-2 text-sm">
								<p>
									<span class="font-medium">{c.label}</span>
									<span class="text-muted-foreground">{c.summary}</span>
								</p>
								{#if c.command}<p class="mt-0.5 font-mono text-xs text-muted-foreground">
										{c.command}
									</p>{/if}
								{#if c.output}
									<details class="mt-1">
										<summary class="cursor-pointer text-xs text-sea">Output</summary>
										<pre
											class="mt-1 max-h-72 overflow-auto rounded-md bg-terminal px-3 py-2 font-mono text-xs text-terminal-foreground">{c.output}</pre>
									</details>
								{/if}
							</li>
						{/each}
					</ul>
				{/if}
			</div>
		</div>
	{/if}
</section>
