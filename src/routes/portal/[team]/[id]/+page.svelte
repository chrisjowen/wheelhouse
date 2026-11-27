<script lang="ts">
	import { ArrowLeft, ExternalLink } from '@lucide/svelte';
	import { ago } from '$lib/format';
	import {
		factsOf,
		newest,
		portalHref,
		recordName,
		type PortalAnswer,
		type PortalRecordAnswer,
		type PortalResult
	} from '$lib/portal';
	import AskPortal from '$lib/components/wh/portal/AskPortal.svelte';
	import FullPortalLink from '$lib/components/wh/portal/FullPortalLink.svelte';
	import PortalAbout from '$lib/components/wh/portal/PortalAbout.svelte';
	import Receipt from '$lib/components/wh/portal/Receipt.svelte';
	import Ticked from '$lib/components/wh/portal/Ticked.svelte';

	/**
	 * A service's or an API's basics from the team's dev portal: what it is, how
	 * it touches the captain (owner, status, whether they call it, whether they
	 * are ready for its latest change, the flag it is behind), the latest facts
	 * that touch them, its key details, a question for the portal, and the way
	 * to its full page on Fleetyard.
	 */
	let { data } = $props();
	const team = $derived(data.team as string);
	const result = $derived(data.record as PortalResult<PortalRecordAnswer>);
	const answer = $derived(data.answer as PortalResult<PortalAnswer> | null);
	const now = Date.now();

	const r = $derived(result.ok ? result.value.record : null);
	const teamName = $derived(result.ok ? result.value.team.name : team);
	const name = $derived(r ? recordName(r) : '');
	const kind = $derived(r?.type === 'api' ? 'API' : r?.type === 'service' ? 'service' : 'record');
	const facts = $derived(r ? factsOf(r) : []);
	const shown = $derived(facts.slice(0, 5));
	const touchingYou = $derived(facts.some((f) => f.yours));
	/** The service an API is part of. */
	const partOf = $derived(
		r?.links.find((l) => l.rel === 'exposes' && l.direction === 'in') ?? null
	);
	const flags = $derived(
		r?.links.filter((l) => l.rel === 'gated_by' && l.direction === 'out') ?? []
	);
	/** What crews last noted of the record itself: a change in flight, as they filed it. */
	const change = $derived(r ? newest(r.evidence.filter((e) => e.note)) : null);
	const titleOf = (id: string) => r?.links.find((l) => l.id === id)?.title ?? id;
	const attr = $derived(new Map((r?.attributes ?? []).map((a) => [a.key, a.value])));
	const LIFECYCLE: Record<string, string> = {
		experimental: 'Experimental',
		active: 'Active',
		deprecated: 'Deprecated: plan to move off it',
		retired: 'Retired: no longer runs'
	};
	/** Key details, by the words people use, in this order; the rest after them as they come. */
	const LABELS: [string, string][] = [
		['kind', 'Kind'],
		['method', 'Method'],
		['path', 'Path'],
		['auth', 'How callers sign in'],
		['language', 'Language'],
		['tier', 'Tier'],
		['url', 'Address'],
		['engine', 'Engine'],
		['package', 'Package']
	];
	const details = $derived.by(() => {
		const known = LABELS.flatMap(([k, label]) =>
			attr.has(k) ? [{ label, value: attr.get(k)! }] : []
		);
		const rest = (r?.attributes ?? [])
			.filter((a) => a.key !== 'lifecycle' && !LABELS.some(([k]) => k === a.key))
			.map((a) => ({
				label: a.key.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_.]/g, ' '),
				value: a.value
			}));
		return [...known, ...rest];
	});
</script>

<svelte:head><title>{r ? name : 'Dev portal'} · Wheelhouse</title></svelte:head>

<main class="px-4 py-6 sm:px-6 lg:px-10">
	<div class="surface px-5 py-6 sm:px-8 sm:py-8">
		<a
			href={portalHref(team)}
			class="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
			><ArrowLeft class="size-3.5" aria-hidden="true" />{teamName}’s dev portal</a
		>
		{#if !r}
			<h1 class="mt-4 text-2xl">Dev portal</h1>
			<p class="mt-2 max-w-prose text-sm" role="alert" data-testid="portal-error">
				{!result.ok ? result.message : ''}
			</p>
		{:else}
			<header class="mt-4">
				<p class="mono-label">Dev portal · {teamName} · {kind}</p>
				<h1 class="mt-1 text-2xl break-words" data-testid="portal-title">{name}</h1>
				{#if r.summary}<p class="mt-1 max-w-prose text-sm text-muted-foreground">
						<Ticked text={r.summary} />
					</p>{/if}
				{#if partOf}
					<p class="mt-1 text-sm text-muted-foreground" data-testid="portal-part-of">
						Part of <a
							class="text-foreground underline-offset-2 hover:underline"
							href={portalHref(team, partOf.id)}>{partOf.title}</a
						>.
					</p>
				{/if}
				{#if r.fullPage}
					<a
						class="mt-2 inline-flex items-center gap-1 text-sm text-sea underline-offset-2 hover:underline"
						href={r.fullPage}
						target="_blank"
						rel="noreferrer"
						>Full page on Fleetyard<ExternalLink class="size-3.5" aria-hidden="true" /></a
					>
				{/if}
			</header>

			<div class="mt-5"><PortalAbout what={`this ${kind}`} /></div>

			<div class="mt-5 grid gap-5 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)] lg:items-start">
				<div class="grid min-w-0 gap-5">
					<section
						class="rounded-lg border bg-card"
						aria-labelledby="portal-you"
						data-testid="portal-you"
					>
						<h2 id="portal-you" class="mono-label border-b border-hair px-4 py-3">
							You and {name}
						</h2>
						<dl class="grid gap-x-6 gap-y-3 px-4 py-4 text-sm sm:grid-cols-[10rem_minmax(0,1fr)]">
							<dt class="text-muted-foreground">Owner</dt>
							<dd data-testid="portal-owner">
								{#if r.touchesYou.youOwn}<b>You own it</b>{#if r.owners.length}<span
											class="text-muted-foreground"
										>
											({r.owners.map((o) => o.title).join(', ')})</span
										>{/if}
								{:else if r.owners.length}
									{r.owners.map((o) => o.title).join(', ')}
									{#if r.owners[0].via}<span class="text-muted-foreground"
											>(through the service that exposes it)</span
										>{/if}
								{:else}
									<span class="text-muted-foreground">Not recorded yet</span>
								{/if}
							</dd>

							<dt class="text-muted-foreground">Status</dt>
							<dd>
								{#if attr.get('lifecycle')}{LIFECYCLE[attr.get('lifecycle')!] ??
										attr.get('lifecycle')}{#if r.confirmed.of}<span class="text-muted-foreground"
											>. {r.confirmed.facts} of {r.confirmed.of} facts confirmed in the code</span
										>{/if}
								{:else if r.confirmed.of}
									{r.confirmed.facts} of {r.confirmed.of} facts confirmed in the code
								{:else}
									<span class="text-muted-foreground">Not recorded</span>
								{/if}
							</dd>

							<dt class="text-muted-foreground">You call it</dt>
							<dd data-testid="portal-calls">
								{#if r.touchesYou.yoursCallIt.length}
									<ul class="grid gap-2">
										{#each r.touchesYou.yoursCallIt as t (t.id + (t.via ?? ''))}
											<li>
												Yes: your
												<a
													class="font-medium underline-offset-2 hover:underline"
													href={portalHref(team, t.id)}>{t.title}</a
												>
												calls {#if t.via}<a
														class="underline-offset-2 hover:underline"
														href={portalHref(team, t.via)}>{titleOf(t.via)}</a
													>{:else}it{/if}.
												<!-- With a note, its receipt is under Are you ready? instead. -->
												{#if newest(t.evidence) && !t.evidence.some((e) => e.note)}<Receipt
														evidence={newest(t.evidence)!}
														{now}
													/>{/if}
											</li>
										{/each}
									</ul>
								{:else if r.touchesYou.youOwn}
									You own it.
								{:else if !r.touchesYou.known}
									<span class="text-muted-foreground"
										>The dev portal doesn’t know which person you are yet: no one has filed a person
										with your GitHub login.</span
									>
								{:else}
									No: nothing you own calls it, as far as the dev portal knows.
								{/if}
							</dd>

							{#if r.touchesYou.itCallsYours.length}
								<dt class="text-muted-foreground">It calls yours</dt>
								<dd>
									{#each r.touchesYou.itCallsYours as t, i (t.id)}{i ? ', ' : ''}<a
											class="underline-offset-2 hover:underline"
											href={portalHref(team, t.id)}>{t.title}</a
										>{/each}
								</dd>
							{/if}

							<dt class="text-muted-foreground">Latest change</dt>
							<dd data-testid="portal-change">
								{#if change}
									<Ticked text={change.note ?? ''} />
									<Receipt evidence={change} {now} />
								{:else}
									<span class="text-muted-foreground">None filed</span>
								{/if}
							</dd>

							{#if r.touchesYou.yoursCallIt.length}
								<dt class="text-muted-foreground">Are you ready?</dt>
								<dd data-testid="portal-ready">
									<ul class="grid gap-2">
										{#each r.touchesYou.yoursCallIt as t (t.id + (t.via ?? ''))}
											{@const said = newest(t.evidence.filter((e) => e.note))}
											<li>
												{#if said}
													{t.title}{#if t.via}, for {titleOf(t.via)}{/if}: <Ticked
														text={said.note ?? ''}
													/>
													<Receipt evidence={said} {now} />
												{:else}
													<span class="text-muted-foreground"
														>No crew has noted whether {t.title} is ready{t.via
															? ` for ${titleOf(t.via)}`
															: ''}.</span
													>
												{/if}
											</li>
										{/each}
									</ul>
								</dd>
							{/if}

							<dt class="text-muted-foreground">Safe rollout</dt>
							<dd data-testid="portal-flag">
								{#if flags.length}
									Behind the flag {#each flags as f, i (f.id)}{i ? ', ' : ''}<code
											class="font-mono text-[0.85em]">{f.title}</code
										>{/each}
								{:else}
									<span class="text-muted-foreground">No flag recorded for it</span>
								{/if}
							</dd>
						</dl>
					</section>

					<section
						class="rounded-lg border bg-card"
						aria-labelledby="portal-facts"
						data-testid="portal-facts"
					>
						<div class="flex flex-wrap items-baseline gap-x-3 border-b border-hair px-4 py-3">
							<h2 id="portal-facts" class="mono-label">
								{touchingYou ? 'Latest facts that touch you' : 'Latest facts'}
							</h2>
							{#if !touchingYou && facts.length}<span class="text-xs text-muted-foreground"
									>none name anything of yours</span
								>{/if}
						</div>
						{#if shown.length}
							<ul class="divide-y divide-hair">
								{#each shown as f, i (i)}
									<li class="px-4 py-3 text-sm">
										<p>
											<Ticked text={f.text[0]} />{#if f.other}<a
													class="font-medium underline-offset-2 hover:underline"
													href={portalHref(team, f.other.id)}>{f.other.title}</a
												>{/if}{f.text[1]}{#if f.yours}<span
													class="ml-2 rounded-full border border-sea/40 px-1.5 py-px text-[0.7rem] text-sea"
													>yours</span
												>{/if}
										</p>
										<div class="mt-1"><Receipt evidence={f.evidence} {now} /></div>
									</li>
								{/each}
							</ul>
							{#if facts.length > shown.length}
								<p class="border-t border-hair px-4 py-2 text-xs text-muted-foreground">
									{facts.length - shown.length} more on its full page.
								</p>
							{/if}
						{:else}
							<p class="px-4 py-3 text-sm text-muted-foreground">No facts filed about it yet.</p>
						{/if}
					</section>
				</div>

				<div class="grid min-w-0 gap-5">
					{#if r.fullPage}
						<FullPortalLink
							href={r.fullPage}
							detail={r.type === 'service'
								? 'Overview, architecture, builds, deployments, APIs, observability, flows, team and links, and every fact with its receipt.'
								: 'Its API docs, every caller, its history, the flows it is part of, and every fact with its receipt.'}
						/>
					{/if}
					<section
						class="rounded-lg border bg-card"
						aria-labelledby="portal-details"
						data-testid="portal-details"
					>
						<h2 id="portal-details" class="mono-label border-b border-hair px-4 py-3">
							Key details
						</h2>
						<dl class="grid gap-x-4 gap-y-2 px-4 py-4 text-sm sm:grid-cols-[8rem_minmax(0,1fr)]">
							{#each details as d (d.label)}
								<dt class="text-muted-foreground">{d.label}</dt>
								<dd class="break-words">{d.value}</dd>
							{/each}
							{#each r.environments as e (e.title)}
								<dt class="text-muted-foreground">{e.title}</dt>
								<dd class="flex flex-wrap gap-x-3">
									{#each e.links as l (l.url)}<a
											class="underline underline-offset-2"
											href={l.url}
											target="_blank"
											rel="noreferrer">{l.label}</a
										>{:else}<span class="text-muted-foreground">Runs here</span>{/each}
								</dd>
							{/each}
							{#if r.updatedAt}
								<dt class="text-muted-foreground">Last filed</dt>
								<dd>{ago(r.updatedAt, now)}</dd>
							{/if}
						</dl>
						{#if r.hidden}
							<p class="border-t border-hair px-4 py-2 text-xs text-muted-foreground">
								{r.hidden} value{r.hidden === 1 ? '' : 's'} left out: the portal shows names of secrets
								and variables, never what they hold.
							</p>
						{/if}
						{#if r.notKnown.length}
							<div class="border-t border-hair px-4 py-3 text-sm" data-testid="portal-not-known">
								<p class="mono-label">Not known yet</p>
								<ul class="mt-1.5 list-disc pl-5 text-muted-foreground">
									{#each r.notKnown as n (n)}<li>{n}</li>{/each}
								</ul>
							</div>
						{/if}
					</section>

					<AskPortal {team} q={data.q as string} {answer} placeholder={`Ask about ${name}`} />
				</div>
			</div>
		{/if}
	</div>
</main>
