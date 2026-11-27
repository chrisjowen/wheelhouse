<script lang="ts">
	import { ExternalLink, Search } from '@lucide/svelte';
	import { portalHref, type PortalAnswer, type PortalResult } from '$lib/portal';
	import { Button } from '$lib/components/ui/button';
	import Ticked from './Ticked.svelte';

	/**
	 * Ask the dev portal: the question goes to the team's Docket through
	 * Fleetyard, and the answer is what the record holds for what its search
	 * found, or that it holds nothing. No model writes it. The question is the
	 * page's `?q=`, so an answer has an address and works without scripts.
	 */
	let {
		team,
		q,
		answer,
		placeholder = 'Ask the dev portal'
	}: {
		team: string;
		q: string;
		answer: PortalResult<PortalAnswer> | null;
		placeholder?: string;
	} = $props();
</script>

<section
	class="rounded-lg border bg-card px-4 py-4"
	aria-labelledby="portal-ask"
	data-testid="portal-ask"
>
	<h2 id="portal-ask" class="mono-label">Ask the dev portal</h2>
	<form method="GET" class="mt-3 flex gap-2" data-sveltekit-keepfocus data-sveltekit-noscroll>
		<label class="relative min-w-0 flex-1">
			<span class="sr-only">Your question</span>
			<Search
				class="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
				aria-hidden="true"
			/>
			<input
				name="q"
				value={q}
				maxlength="300"
				{placeholder}
				class="h-9 w-full rounded-md border border-input bg-background pr-2 pl-8 text-sm"
			/>
		</label>
		<Button type="submit" variant="outline" size="sm" class="h-9">Ask</Button>
	</form>
	{#if answer && !answer.ok}
		<p class="mt-3 text-sm text-danger" role="alert">{answer.message}</p>
	{:else if answer?.ok}
		{@const a = answer.value}
		<div class="mt-3 text-sm" data-testid="portal-answer">
			{#if a.notRecorded}
				<p>
					<b>Not recorded in the dev portal</b>: nothing the crews filed matches “{a.q}”.
				</p>
			{:else}
				<p class="text-muted-foreground">
					What the dev portal holds for “{a.q}”, straight from the crews’ facts:
				</p>
				<ul class="mt-2 divide-y divide-hair">
					{#each a.matches as m (m.id)}
						<li class="py-2">
							<a
								class="font-medium underline-offset-2 hover:underline"
								href={portalHref(team, m.id)}>{m.title}</a
							>
							<span class="ml-1 text-xs text-muted-foreground"
								>{m.typeName}{m.owners.length ? ` · owned by ${m.owners.join(', ')}` : ''}</span
							>
							{#if m.summary}<p class="mt-0.5 line-clamp-3 text-muted-foreground">
									<Ticked text={m.summary} />
								</p>{/if}
							{#if m.notKnown.length}
								<p class="mt-0.5 text-xs text-muted-foreground">
									Not known yet: {m.notKnown.join('; ')}.
								</p>
							{/if}
						</li>
					{/each}
				</ul>
			{/if}
			{#if a.fullPortal}
				<a
					class="mt-2 inline-flex items-center gap-1 text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
					href={a.fullPortal}
					target="_blank"
					rel="noreferrer"
					>Ask it with sources in the full portal<ExternalLink
						class="size-3"
						aria-hidden="true"
					/></a
				>
			{/if}
		</div>
	{:else}
		<p class="mt-2 text-xs text-muted-foreground">
			Answers come only from what the crews filed; nothing is made up.
		</p>
	{/if}
</section>
