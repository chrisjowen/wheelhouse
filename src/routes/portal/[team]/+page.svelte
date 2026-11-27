<script lang="ts">
	import {
		relWords,
		portalHref,
		type PortalAnswer,
		type PortalOverview,
		type PortalResult
	} from '$lib/portal';
	import AskPortal from '$lib/components/wh/portal/AskPortal.svelte';
	import FullPortalLink from '$lib/components/wh/portal/FullPortalLink.svelte';
	import PortalAbout from '$lib/components/wh/portal/PortalAbout.svelte';
	import Receipt from '$lib/components/wh/portal/Receipt.svelte';
	import Ticked from '$lib/components/wh/portal/Ticked.svelte';

	/**
	 * A team's dev portal, from the captain's side: what they own (each opening
	 * its basics here), what crews filed lately, a question for the portal, and
	 * the full portal on Fleetyard.
	 */
	let { data } = $props();
	const team = $derived(data.team as string);
	const result = $derived(data.overview as PortalResult<PortalOverview>);
	const answer = $derived(data.answer as PortalResult<PortalAnswer> | null);
	const o = $derived(result.ok ? result.value : null);
	const now = Date.now();
</script>

<svelte:head
	><title>{o ? `${o.team.name} · Dev portal` : 'Dev portal'} · Wheelhouse</title></svelte:head
>

<main class="px-4 py-6 sm:px-6 lg:px-10">
	<div class="surface px-5 py-6 sm:px-8 sm:py-8">
		<p class="mono-label">Dev portal{o ? ` · ${o.team.name}` : ''}</p>
		<h1 class="mt-1 text-2xl">{o ? `${o.team.name}’s dev portal` : 'Dev portal'}</h1>
		{#if !o}
			<p class="mt-2 max-w-prose text-sm" role="alert" data-testid="portal-error">
				{!result.ok ? result.message : ''}
			</p>
		{:else}
			<div class="mt-4"><PortalAbout what="each one" /></div>

			<div class="mt-5 grid gap-5 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)] lg:items-start">
				<div class="grid min-w-0 gap-5">
					<section
						class="rounded-lg border bg-card"
						aria-labelledby="portal-owns"
						data-testid="portal-owns"
					>
						<h2 id="portal-owns" class="mono-label border-b border-hair px-4 py-3">What you own</h2>
						{#if !o.you.person}
							<p class="px-4 py-3 text-sm text-muted-foreground">
								The dev portal doesn’t know which person you are yet: no one has filed a person with
								your GitHub login.
							</p>
						{:else if o.you.owns.length}
							<ul class="divide-y divide-hair">
								{#each o.you.owns as it (it.id)}
									<li class="px-4 py-3 text-sm">
										<a
											class="font-medium underline-offset-2 hover:underline"
											href={portalHref(team, it.id)}>{it.title}</a
										>
										<span class="ml-1 text-xs text-muted-foreground">{it.type}</span>
										{#if it.notKnown.length}
											<p class="mt-0.5 text-xs text-muted-foreground">
												Not known yet: {it.notKnown.join('; ')}.
											</p>
										{/if}
									</li>
								{/each}
							</ul>
						{:else}
							<p class="px-4 py-3 text-sm text-muted-foreground">Nothing filed as yours yet.</p>
						{/if}
					</section>

					<section
						class="rounded-lg border bg-card"
						aria-labelledby="portal-latest"
						data-testid="portal-latest"
					>
						<div class="flex flex-wrap items-baseline gap-x-3 border-b border-hair px-4 py-3">
							<h2 id="portal-latest" class="mono-label">Learned lately</h2>
							<span class="text-xs text-muted-foreground"
								>what crews filed as they worked, newest first</span
							>
						</div>
						{#if o.latest.length}
							<ul class="divide-y divide-hair">
								{#each o.latest as f, i (i)}
									<li class="px-4 py-3 text-sm">
										<p>
											<a
												class="font-medium underline-offset-2 hover:underline"
												href={portalHref(team, f.id)}>{f.title}</a
											>{#if f.rel && f.target}
												{relWords(f.rel)}
												<a
													class="underline-offset-2 hover:underline"
													href={portalHref(team, f.target)}>{f.targetTitle ?? f.target}</a
												>{/if}{#if f.evidence?.note}<span class="text-muted-foreground"
													>: <Ticked text={f.evidence.note} /></span
												>{/if}
										</p>
										{#if f.evidence}<div class="mt-1">
												<Receipt evidence={f.evidence} {now} />
											</div>{/if}
									</li>
								{/each}
							</ul>
						{:else}
							<p class="px-4 py-3 text-sm text-muted-foreground">Nothing filed yet.</p>
						{/if}
					</section>
				</div>

				<div class="grid min-w-0 gap-5">
					<AskPortal {team} q={data.q as string} {answer} />
					{#if o.team.portal}
						<FullPortalLink
							href={o.team.portal}
							title="Full dev portal on Fleetyard"
							detail="Every service, API, repository and flow, with every fact and its receipt. Anyone at the company can read it."
						/>
					{/if}
				</div>
			</div>
		{/if}
	</div>
</main>
