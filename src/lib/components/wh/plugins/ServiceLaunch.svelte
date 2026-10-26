<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { ArrowUpRight, Check, Copy, LoaderCircle, Play } from '@lucide/svelte';
	import { launchAndOpen, serviceStatus } from '$lib/client/services';
	import type { ServiceView } from '$lib/plugins/types';

	/**
	 * A plugin's companion service, in one line: a link while it runs; a Launch
	 * button while it does not and Wheelhouse can start it (only ever on this
	 * click, never on load), which opens it once it answers; else why not, with
	 * the command to start it by hand.
	 */
	let {
		plugin,
		service,
		project = null,
		open = null,
		label = null
	}: {
		plugin: string;
		service: string;
		project?: string | null;
		/** Where to go once it runs, if not its own front page (say, one proposal). */
		open?: string | null;
		/** What to call it, if not the plugin's own title. */
		label?: string | null;
	} = $props();

	let view = $state<ServiceView | null>(null);
	let starting = $state(false);
	let copied = $state(false);
	const name = $derived(label ?? view?.title ?? 'it');
	const href = $derived(open ?? view?.url ?? null);
	const notRunning = $derived(`${name} is not running.${view?.reason ? ` ${view.reason}` : ''}`);

	onMount(() => {
		serviceStatus({ plugin, service, project }).then((v) => (view = v));
	});

	async function launch() {
		starting = true;
		const v = await launchAndOpen(
			{ plugin, service, project },
			page.data.sessionToken as string,
			open
		);
		view = v ?? view;
		starting = false;
	}

	async function copy(text: string) {
		try {
			await navigator.clipboard.writeText(text);
			copied = true;
			setTimeout(() => (copied = false), 1500);
		} catch {
			// clipboard unavailable: the command stays selectable
		}
	}
</script>

{#if view}
	<div class="flex flex-col gap-1.5 text-xs" data-service="{plugin}/{service}">
		{#if starting || view.state === 'starting'}
			<span class="flex items-center gap-1.5 text-muted-foreground" role="status">
				<LoaderCircle class="size-3.5 animate-spin" aria-hidden="true" />Starting {name}; the first
				start can take a minute.
			</span>
		{:else if view.state === 'running' && href}
			<a
				{href}
				target="_blank"
				rel="noreferrer"
				class="inline-flex w-fit items-center gap-1 rounded-full border border-sea/40 px-2.5 py-1 font-medium text-sea hover:bg-sea/10"
				>Open {name}<ArrowUpRight class="size-3.5" aria-hidden="true" /></a
			>
		{:else if view.launchable}
			<span class="flex flex-wrap items-center gap-2">
				<button
					class="inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-sea bg-sea px-3 py-1 font-semibold text-white transition-colors duration-200 hover:bg-sea/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring dark:text-slate-950"
					onclick={launch}><Play class="size-3.5" aria-hidden="true" />Launch {name}</button
				>
				<span class="text-muted-foreground"
					>{name} is not running; Launch starts it on this computer.</span
				>
			</span>
			{#if view.state === 'failed'}
				<p class="text-warning">{view.reason}</p>
				{#if view.log}
					<details>
						<summary class="cursor-pointer text-muted-foreground">What it printed</summary>
						<pre
							class="mt-1 max-h-48 overflow-auto rounded border bg-muted/60 p-2 font-mono text-[0.7rem] whitespace-pre-wrap">{view.log}</pre>
					</details>
				{/if}
			{/if}
		{:else}
			<p class="text-muted-foreground">
				{notRunning}
			</p>
			{#if view.hint}
				<span class="flex items-start gap-2 rounded-md border bg-muted/60 px-2.5 py-1.5">
					<code class="min-w-0 flex-1 font-mono break-all text-foreground select-all"
						>{view.hint}</code
					>
					<button
						class="flex shrink-0 cursor-pointer items-center gap-1 hover:text-foreground"
						onclick={() => copy(view!.hint!)}
						>{#if copied}<Check class="size-3.5" />Copied{:else}<Copy
								class="size-3.5"
							/>Copy{/if}</button
					>
				</span>
			{/if}
			{#if href && view.state !== 'occupied'}
				<a
					{href}
					target="_blank"
					rel="noreferrer"
					class="inline-flex w-fit items-center gap-1 text-sea hover:underline"
					>Open {name} once it runs<ArrowUpRight class="size-3.5" aria-hidden="true" /></a
				>
			{/if}
		{/if}
	</div>
{/if}
