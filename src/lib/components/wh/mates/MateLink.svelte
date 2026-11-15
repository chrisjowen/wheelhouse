<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import { page } from '$app/state';
	import {
		Check,
		CircleAlert,
		Cloud,
		ExternalLink,
		KeyRound,
		Laptop,
		LoaderCircle,
		Sailboat
	} from '@lucide/svelte';
	import { SESSION_HEADER } from '$lib/client/messages';
	import { ago } from '$lib/format';
	import type { LinkAction, LinkProblem, LinkTest, MateLinkView } from '$lib/matelink';
	import type { SecondMate } from '$lib/types';

	/**
	 * The link to a second mate on a Fleetyard machine, on its card: the path
	 * this computer → Fleetyard → the machine, why it does not work when it does
	 * not (in plain words, with the fix: Wake, Approve on Fleetyard, Update
	 * trusted passkeys or Connect), and Test connection, which checks each leg
	 * in turn and times the round trip. Fixes that need the captain's passkey
	 * finish on a Fleetyard page; this says which page and what it should show.
	 */
	let { mate, now }: { mate: SecondMate; now: number } = $props();

	let view = $state<MateLinkView | null>(null);
	let test = $state<LinkTest | null>(null);
	let testing = $state(false);
	let waking = $state(false);
	let failed = $state<string | null>(null);
	let timer: ReturnType<typeof setTimeout> | null = null;
	let wakeUntil = 0;

	const status = $derived(view?.status ?? mate.link?.status ?? null);
	const job = $derived(view?.job ?? null);
	const machine = $derived(status?.machine ?? mate.link?.machine ?? mate.host ?? 'its machine');
	const here = $derived(status?.here ?? 'this computer');
	const Here = $derived(here.charAt(0).toUpperCase() + here.slice(1));
	const problem = $derived(status?.problem ?? null);
	const working = $derived(mate.tone === 'working');

	const api = $derived(`/api/second-mates/${encodeURIComponent(mate.id)}/link`);

	async function call(init?: RequestInit, fresh = false): Promise<unknown> {
		failed = null;
		try {
			const r = await fetch(fresh ? `${api}?fresh=1` : api, {
				...init,
				headers: init?.body
					? {
							'content-type': 'application/json',
							[SESSION_HEADER]: (page.data.sessionToken as string | undefined) ?? ''
						}
					: undefined
			});
			if (!r.ok) {
				failed = `Wheelhouse answered ${r.status}.`;
				return null;
			}
			return await r.json();
		} catch {
			failed = 'Could not reach the Wheelhouse server.';
			return null;
		}
	}
	const post = (action: string) => call({ method: 'POST', body: JSON.stringify({ action }) });

	/** Asks again every few seconds while a fix is under way: a job on Fleetyard, or a machine waking. */
	function watch() {
		if (timer) clearTimeout(timer);
		const coming = status?.online === true || problem?.code === 'starting';
		const waiting = job?.state === 'running' || (waking && coming && Date.now() < wakeUntil);
		if (!waiting) {
			waking = false;
			return;
		}
		timer = setTimeout(async () => {
			const wasRunning = job?.state === 'running';
			const v = (await call(undefined, waking)) as MateLinkView | null;
			if (v) view = v;
			if (waking && v?.status?.online) {
				waking = false;
				return void runTest();
			}
			if (wasRunning && job?.state !== 'running') return void runTest();
			watch();
		}, 4_000);
	}

	async function runTest() {
		if (testing) return;
		testing = true;
		const t = (await post('test')) as LinkTest | null;
		testing = false;
		if (!t) return;
		test = t;
		view = { status: t.status, job: view?.job ?? null };
	}

	async function act(action: LinkAction) {
		if (action === 'update-passkeys') return;
		if (action === 'wake') {
			waking = true;
			wakeUntil = Date.now() + 5 * 60_000;
		}
		const v = (await post(action)) as MateLinkView | null;
		if (v) view = v;
		test = null;
		watch();
	}

	onMount(async () => {
		const v = (await call()) as MateLinkView | null;
		if (v) view = v;
		watch();
	});
	onDestroy(() => {
		if (timer) clearTimeout(timer);
	});

	const reached = $derived(
		mate.health.online === 'online' && mate.health.observedAt
			? `Reached ${ago(mate.health.observedAt, now)}`
			: mate.health.observedAt
				? `Last reached ${ago(mate.health.observedAt, now)}`
				: 'Never reached'
	);
	const macWire = $derived(
		status?.approved === true
			? working
				? { tone: 'work', say: 'In use' }
				: { tone: 'good', say: 'Linked' }
			: status?.problem?.code === 'not-connected'
				? { tone: 'warn', say: 'Not connected' }
				: status?.approved === false
					? { tone: 'warn', say: 'Not approved yet' }
					: { tone: 'off', say: status ? 'Not known' : 'Asking…' }
	);
	const machineWire = $derived(
		status?.online === true
			? { tone: 'good', say: 'Online' }
			: status?.online === false
				? {
						tone: 'off',
						say: waking
							? 'Waking…'
							: status.problem?.code === 'starting'
								? 'Starting'
								: status.problem?.code === 'stopped'
									? 'Stopped'
									: 'Offline'
					}
				: { tone: 'off', say: status ? 'Not known' : 'Asking…' }
	);
	const pending = $derived(problem?.code === 'not-approved' || problem?.code === 'not-connected');
</script>

{#snippet fix(p: LinkProblem)}
	{#if p.action === 'wake'}
		<button
			class="btn-primary"
			onclick={() => act('wake')}
			disabled={waking}
			data-link-action="wake"
		>
			{#if waking}<LoaderCircle class="size-3.5 animate-spin" aria-hidden="true" />Waking {machine}…{:else}Wake
				{machine}{/if}
		</button>
	{:else if p.action === 'approve'}
		<button
			class="btn-primary"
			onclick={() => act('approve')}
			disabled={job?.kind === 'approve' && job.state === 'running'}
			data-link-action="approve"
			><KeyRound class="size-3.5" aria-hidden="true" />Approve on Fleetyard</button
		>
	{:else if p.action === 'connect'}
		<button
			class="btn-primary"
			onclick={() => act('connect')}
			disabled={job?.kind === 'connect' && job.state === 'running'}
			data-link-action="connect">Connect</button
		>
	{:else if p.action === 'update-passkeys'}
		{#if status?.urls.machines}
			<a
				class="btn-primary"
				href={status.urls.machines}
				target="_blank"
				rel="noreferrer"
				data-link-action="update-passkeys"
				><KeyRound class="size-3.5" aria-hidden="true" />Update trusted passkeys</a
			>
		{:else}
			<span class="text-xs text-muted-foreground"
				>Update its trusted passkeys on Fleetyard’s Machines page.</span
			>
		{/if}
	{/if}
{/snippet}

<div class="linkbox mt-4 rounded-lg border bg-muted/30 p-4" data-mate-link={mate.id}>
	{#if problem}
		<div
			class="mb-4 rounded-lg border p-3 text-sm {pending
				? 'border-working/45 bg-working/5'
				: 'border-warning/50 bg-warning/8'}"
			data-link-problem={problem.code}
		>
			<p>
				<strong>{problem.text}</strong>
				{problem.code === 'stopped'
					? `So ${mate.id} can’t work. Firstmate won’t wake it by itself; its work for ${mate.id} waits.`
					: `Until then Firstmate can’t reach ${mate.id}.`}
			</p>
			{#if problem.action}
				<div class="mt-3 flex flex-wrap items-center gap-2">{@render fix(problem)}</div>
			{/if}
		</div>
	{/if}

	{#if job}
		<div
			class="mb-4 rounded-lg border border-working/45 bg-working/5 p-3 text-sm"
			data-link-job={job.kind}
		>
			{#if job.state === 'running'}
				{#if job.url}
					<p>
						{job.kind === 'connect'
							? `On Fleetyard, type this code to connect ${here}:`
							: `On Fleetyard, check that the code there matches ${here}’s, then approve it with your passkey:`}
					</p>
					{#if job.code}<p class="code-match mt-2" data-link-code>{job.code}</p>{/if}
					<div class="mt-3 flex flex-wrap items-center gap-2">
						<a class="btn-primary" href={job.url} target="_blank" rel="noreferrer"
							><ExternalLink class="size-3.5" aria-hidden="true" />Open Fleetyard</a
						>
						<span class="text-xs text-muted-foreground"
							>Wheelhouse carries on once you’re done there.</span
						>
					</div>
				{:else}
					<p class="flex items-center gap-2" aria-busy="true">
						<LoaderCircle class="size-3.5 animate-spin" aria-hidden="true" />Asking Fleetyard…
					</p>
				{/if}
			{:else}
				<p class={job.state === 'failed' ? 'text-warning' : 'text-success'}>{job.message}</p>
			{/if}
		</div>
	{/if}

	<div class="reach" aria-label="How {mate.id} is reached">
		<div class="node">
			<span class="box"><Laptop class="size-5" aria-hidden="true" /></span><strong>{Here}</strong
			><span class="sub">your Firstmate</span>
		</div>
		<div class="wire" data-tone={macWire.tone} data-wire="here">
			<span class="line"></span><span class="say"><b>{macWire.say}</b></span>
		</div>
		<div class="node hub">
			<span class="box"><Sailboat class="size-5" aria-hidden="true" /></span><strong
				>Fleetyard</strong
			><span class="sub">carries the link</span>
		</div>
		<div class="wire" data-tone={machineWire.tone} data-wire="machine">
			<span class="line"></span><span class="say"><b>{machineWire.say}</b></span>
		</div>
		<div class="node">
			<span class="box"><Cloud class="size-5" aria-hidden="true" /></span><strong>{machine}</strong
			><span class="sub">{mate.id}</span>
		</div>
	</div>

	<div class="mt-4 flex flex-wrap items-center gap-2">
		<button
			class="flex cursor-pointer items-center gap-1 rounded-md border bg-card px-2.5 py-1 text-sm hover:bg-muted disabled:opacity-60"
			onclick={runTest}
			disabled={testing}
			data-link-test
		>
			{#if testing}<LoaderCircle
					class="size-3.5 animate-spin"
					aria-hidden="true"
				/>Testing…{:else}{test ? 'Test again' : 'Test connection'}{/if}
		</button>
		<span class="text-xs text-muted-foreground">{reached}</span>
		{#if status?.urls.machines}
			<a
				class="ml-auto flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground hover:underline"
				href={status.urls.machines}
				target="_blank"
				rel="noreferrer"
				><ExternalLink class="size-3.5" aria-hidden="true" />{machine} on Fleetyard</a
			>
		{/if}
	</div>
	{#if failed}<p class="mt-2 text-xs text-warning">{failed}</p>{/if}

	{#if test}
		<ul class="checks mt-3" aria-label="Test connection">
			{#each test.steps as s (s.key)}
				<li class={s.state} data-step={s.key} data-state={s.state}>
					<span class="mk" aria-hidden="true"
						>{#if s.state === 'ok'}<Check class="size-3" />{:else if s.state === 'bad'}<CircleAlert
								class="size-3"
							/>{/if}</span
					>
					<span>{s.label}</span>
					<span class="ms">{s.ms !== null ? `${s.ms} ms` : ''}</span>
					{#if s.problem}
						<p class="why">{s.problem.text}</p>
						{#if s.problem.action}<div class="why flex flex-wrap gap-2">
								{@render fix(s.problem)}
							</div>{/if}
					{/if}
				</li>
			{/each}
		</ul>
		{#if test.roundTripMs !== null}
			<p class="mt-1 text-xs text-muted-foreground" data-round-trip>
				Round trip {test.roundTripMs} ms, {ago(test.at, now)}.
			</p>
		{/if}
	{/if}
</div>

<style>
	.btn-primary {
		display: inline-flex;
		cursor: pointer;
		align-items: center;
		gap: 0.35rem;
		border-radius: 0.375rem;
		background: var(--sea);
		padding: 0.25rem 0.65rem;
		font-size: 0.8125rem;
		font-weight: 500;
		color: var(--on-accent);
	}
	.btn-primary:hover {
		filter: brightness(1.08);
	}
	.btn-primary:disabled {
		cursor: default;
		opacity: 0.7;
	}
	.code-match {
		display: inline-flex;
		font-family: var(--font-mono);
		font-size: 1rem;
		letter-spacing: 0.08em;
		padding: 0.15rem 0.6rem;
		border-radius: 0.4rem;
		border: 1px dashed color-mix(in srgb, var(--gold) 60%, transparent);
		color: var(--gold);
		background: color-mix(in srgb, var(--gold) 6%, transparent);
		word-break: break-all;
	}

	/* The path: this computer → Fleetyard → the machine. */
	.reach {
		display: grid;
		grid-template-columns:
			minmax(0, 1fr) minmax(4rem, 1.1fr) minmax(0, 0.9fr) minmax(4rem, 1.1fr)
			minmax(0, 1fr);
		align-items: center;
	}
	.node {
		display: flex;
		min-width: 0;
		flex-direction: column;
		align-items: center;
		gap: 0.3rem;
		text-align: center;
	}
	.node .box {
		display: grid;
		width: 2.4rem;
		height: 2.4rem;
		place-items: center;
		border-radius: 0.7rem;
		border: 1px solid var(--border);
		background: var(--card);
		color: var(--muted-foreground);
	}
	.node.hub .box {
		border-radius: 9999px;
		color: var(--gold);
		border-color: color-mix(in srgb, var(--gold) 55%, transparent);
		background: color-mix(in srgb, var(--gold) 9%, var(--card));
	}
	.node strong {
		font-size: 0.92rem;
		line-height: 1.2;
		overflow-wrap: anywhere;
	}
	.node .sub {
		font-size: 0.75rem;
		line-height: 1.2;
		color: var(--muted-foreground);
		overflow-wrap: anywhere;
	}
	.wire {
		display: flex;
		min-width: 0;
		flex-direction: column;
		align-items: center;
		gap: 0.35rem;
		padding: 0 0.25rem;
	}
	.wire .line {
		position: relative;
		width: 100%;
		height: 2px;
		overflow: hidden;
		border-radius: 2px;
		background: var(--border);
	}
	.wire .line::after {
		content: '';
		position: absolute;
		inset: 0;
		background: var(--w, var(--muted-foreground));
		opacity: 0.85;
	}
	.wire[data-tone='good'] {
		--w: var(--success);
	}
	.wire[data-tone='work'] {
		--w: var(--working);
	}
	.wire[data-tone='warn'] {
		--w: var(--warning);
	}
	.wire[data-tone='off'] {
		--w: transparent;
	}
	.wire[data-tone='off'] .line {
		background: repeating-linear-gradient(90deg, var(--border) 0 6px, transparent 6px 11px);
	}
	.wire[data-tone='work'] .line::after {
		background: linear-gradient(
			90deg,
			transparent,
			var(--working) 40%,
			var(--working) 60%,
			transparent
		);
		animation: flow 1.4s linear infinite;
	}
	@keyframes flow {
		from {
			transform: translateX(-100%);
		}
		to {
			transform: translateX(100%);
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.wire[data-tone='work'] .line::after {
			animation: none;
			background: var(--working);
		}
	}
	.wire .say {
		font-size: 0.75rem;
		line-height: 1.2;
		text-align: center;
		color: var(--muted-foreground);
	}
	.wire .say b {
		font-weight: 600;
		color: var(--w, var(--foreground));
	}
	.wire[data-tone='off'] .say b {
		color: var(--muted-foreground);
	}
	@media (max-width: 40rem) {
		.reach {
			grid-template-columns: minmax(0, 1fr);
			gap: 0.4rem;
		}
		.wire .line {
			width: 2px;
			height: 1.4rem;
		}
	}

	/* Test connection: each check in turn. */
	.checks {
		display: grid;
		gap: 0.15rem;
	}
	.checks li {
		display: grid;
		grid-template-columns: 1.3rem minmax(0, 1fr) auto;
		align-items: center;
		gap: 0.5rem;
		padding: 0.2rem 0;
		font-size: 0.875rem;
	}
	.checks .mk {
		display: grid;
		width: 1.05rem;
		height: 1.05rem;
		place-items: center;
		border-radius: 9999px;
		border: 1.5px solid var(--border);
		color: #fff;
	}
	.checks li.ok .mk {
		border-color: var(--success);
		background: var(--success);
	}
	.checks li.bad .mk {
		border-color: var(--warning);
		background: var(--warning);
	}
	.checks li.skipped {
		opacity: 0.5;
	}
	.checks .ms {
		font-family: var(--font-mono);
		font-size: 0.72rem;
		color: var(--muted-foreground);
	}
	.checks .why {
		grid-column: 2 / -1;
		margin: -0.1rem 0 0.2rem;
		font-size: 0.8125rem;
		color: var(--muted-foreground);
	}
</style>
