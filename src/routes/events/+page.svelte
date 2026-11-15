<script lang="ts">
	import { onMount, untrack } from 'svelte';
	import { invalidateAll } from '$app/navigation';
	import { page } from '$app/state';
	import type { EventRule, EventsView, EventLevel } from '$lib/events';
	let { data } = $props();
	let view = $state<EventsView | null>(untrack(() => data.events));
	let tab = $state<'Feed' | 'Rules' | 'Sources'>('Feed');
	let error = $state('');
	let busy = $state(false);
	let text = $state('');
	let rule = $state('');
	let zone = $state('UTC');
	let missed = $state('once');
	let trust = $state(false);
	let artifacts = $state(false);
	let rules = $state<EventRule[]>([]);
	let quietStart = $state('22:00');
	let quietEnd = $state('08:00');
	let quietEnabled = $state(false);
	$effect(() => {
		view = data.events;
		if (data.events) {
			rules = structuredClone(data.events.settings.rules);
			zone = data.events.settings.timeZone;
			quietStart = data.events.settings.quiet.start;
			quietEnd = data.events.settings.quiet.end;
			quietEnabled = data.events.settings.quiet.enabled;
		}
	});
	onMount(() => {
		if (!rule) rule = `once ${new Date(Date.now() + 120000).toISOString()}`;
		const timer = setInterval(() => {
			if (busy) return;
			void fetch('/api/wh-events')
				.then((r) => (r.ok ? r.json() : null))
				.then((v) => {
					if (v) view = v;
				})
				.catch(() => {});
		}, 15000);
		return () => clearInterval(timer);
	});
	async function change(body: Record<string, unknown>) {
		if (busy) return false;
		busy = true;
		error = '';
		try {
			const response = await fetch('/api/wh-events', {
				method: 'POST',
				headers: {
					'content-type': 'application/json',
					'x-wheelhouse-session': page.data.sessionToken
				},
				body: JSON.stringify(body)
			});
			const result = await response.json();
			if (!response.ok) throw new Error(result.message);
			view = result;
			await invalidateAll();
			return true;
		} catch (e) {
			error = (e as Error).message;
			return false;
		} finally {
			busy = false;
		}
	}
	async function addReminder(e: SubmitEvent) {
		e.preventDefault();
		if (await change({ action: 'add-reminder', text, rule, timeZone: zone, missed })) text = '';
	}
	function addRule() {
		rules = [
			...rules,
			{
				id: `rule-${rules.length + 1}`,
				source: 'schedule',
				kind: 'schedule.reminder',
				level: 'notify-only',
				batchMinutes: 2,
				digest: 'batch',
				at: '08:00'
			}
		];
	}
	const levels: { value: EventLevel; label: string }[] = [
		{ value: 'notify-only', label: 'Notify only' },
		{ value: 'wheelhouse-only', label: 'Wheelhouse only' },
		{ value: 'off', label: 'Off' }
	];
</script>

<svelte:head><title>Events · Wheelhouse</title></svelte:head>
<div class="mx-auto max-w-5xl space-y-6 px-5 py-8 md:px-10">
	<header class="flex flex-wrap items-start justify-between gap-4">
		<div>
			<p class="mono-label mb-2">On this machine</p>
			<h1 class="text-3xl font-semibold tracking-tight">Events</h1>
			<p class="mt-2 text-sm text-muted-foreground">
				Reminders and information for Firstmate, under your rules.
			</p>
		</div>
		{#if view}<button
				class="rounded-lg border px-4 py-2 text-sm"
				disabled={busy || !!view.problem}
				onclick={() => change({ action: 'pause', paused: !view?.settings.paused })}
				>{view.settings.paused ? 'Resume events' : 'Pause events'}</button
			>{/if}
	</header>
	{#if error}<p role="alert" class="rounded-lg border border-red-400 p-4 text-sm">{error}</p>{/if}
	{#if !view}<p>Firstmate is not configured.</p>{:else if view.problem}<p role="alert">
			{view.problem}
		</p>{:else}
		{#if view.settings.paused}<p
				role="status"
				class="rounded-xl border border-amber-400 bg-amber-100 p-4 text-sm text-amber-950"
			>
				Events paused. Everything is held, including reminders. Resume to release one digest.
			</p>{/if}
		<nav aria-label="Events pages" class="flex gap-6 border-b">
			{#each ['Feed', 'Rules', 'Sources'] as name (name)}<button
					class="border-b-2 px-1 pb-3 text-sm"
					class:border-transparent={tab !== name}
					class:border-current={tab === name}
					aria-current={tab === name ? 'page' : undefined}
					onclick={() => (tab = name as typeof tab)}>{name}</button
				>{/each}
		</nav>
		{#if tab === 'Feed'}
			<section class="rounded-xl border bg-card p-5">
				<h2 class="text-lg font-medium">Set a reminder</h2>
				<p class="mt-1 text-sm text-muted-foreground">
					Your own words, quoted and labelled as a reminder. Quiet hours do not hold reminders.
				</p>
				<form onsubmit={addReminder} class="mt-4 grid gap-4 sm:grid-cols-2">
					<label class="grid gap-1 text-sm sm:col-span-2"
						>Reminder<input
							class="rounded-md border bg-background p-2"
							bind:value={text}
							maxlength="500"
							required
							placeholder="Check overnight CI"
						/></label
					>
					<label class="grid gap-1 text-sm"
						>When<input
							class="rounded-md border bg-background p-2 font-mono text-xs"
							bind:value={rule}
							required
						/></label
					>
					<label class="grid gap-1 text-sm"
						>Time zone<input
							class="rounded-md border bg-background p-2"
							bind:value={zone}
							required
							placeholder="Europe/London"
						/></label
					>
					<p class="text-xs text-muted-foreground sm:col-span-2">
						once 2026-11-20T09:00 · daily 08:30 · weekdays 08:30 · weekly mon,thu 17:00 · monthly 1
						09:00 · every 2h (minimum 15m)
					</p>
					<label class="grid gap-1 text-sm"
						>If the machine was off<select
							class="rounded-md border bg-background p-2"
							bind:value={missed}
							><option value="once">One reminder with missed count</option><option value="all"
								>Every missed occurrence</option
							><option value="skip">Skip missed occurrences</option></select
						></label
					>
					<button
						class="self-end rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground"
						disabled={busy}>Set reminder</button
					>
				</form>
			</section>
			<section>
				<h2 class="mb-3 text-lg font-medium">Reminders</h2>
				<div class="divide-y rounded-xl border">
					{#each view.reminders.filter((r) => r.state !== 'done') as reminder (reminder.id)}<div
							class="flex flex-wrap items-center justify-between gap-3 p-4"
						>
							<div>
								<p>{reminder.text}</p>
								<p class="mt-1 text-xs text-muted-foreground">
									{reminder.rule} · {reminder.timeZone} · {reminder.state} · next {reminder.nextAt ??
										'none'}
								</p>
							</div>
							<div class="flex gap-3 text-sm">
								<button
									disabled={busy}
									onclick={() =>
										change({
											action: 'reminder',
											id: reminder.id,
											state: reminder.state === 'active' ? 'paused' : 'active'
										})}>{reminder.state === 'active' ? 'Pause' : 'Resume'}</button
								><button
									disabled={busy}
									onclick={() => change({ action: 'reminder', id: reminder.id, state: 'done' })}
									>Cancel</button
								>
							</div>
						</div>{:else}<p class="p-4 text-sm text-muted-foreground">
							No upcoming reminders.
						</p>{/each}
				</div>
			</section>
			<section>
				<h2 class="mb-3 text-lg font-medium">Feed</h2>
				<div class="divide-y rounded-xl border">
					{#each [...view.events].reverse() as event (event.id)}{@const batch = view.batches.find(
							(b) => b.id === event.batchId
						)}
						<article class="space-y-1 p-4">
							<p>{event.text}</p>
							<p class="font-mono text-xs text-muted-foreground">
								{event.kind} · verified={event.verified} · {event.receivedAt}
							</p>
							<p class="text-xs text-muted-foreground">
								Rule: {event.ruleId} · {event.level} · {batch?.capturedAt
									? view.pending === 0
										? 'Handled by Firstmate (inferred from its pending list)'
										: 'Captured by Firstmate'
									: event.batchId
										? 'Waiting for Firstmate'
										: event.status}
							</p>
							{#if event.batchId}<p class="font-mono text-xs text-muted-foreground">
									{event.batchId}
								</p>{/if}
						</article>{:else}<p class="p-6 text-sm text-muted-foreground">
							Events will appear here when a reminder is due.
						</p>{/each}
				</div>
			</section>
		{:else if tab === 'Rules'}
			<section class="space-y-4">
				<h2 class="text-lg font-medium">First match wins</h2>
				<p class="text-sm text-muted-foreground">
					Rules stay on this machine. The source default applies last. Every new source starts at
					notify only. Reminders bypass quiet hours.
				</p>
				{#each rules as item, i (i)}<fieldset
						class="grid gap-3 rounded-xl border p-4 sm:grid-cols-3"
					>
						<legend class="px-2 text-sm">Reminder rule {i + 1}</legend><label
							class="grid gap-1 text-sm"
							>Rule id<input class="rounded border bg-background p-2" bind:value={item.id} /></label
						><label class="grid gap-1 text-sm"
							>Delivery<select class="rounded border bg-background p-2" bind:value={item.level}
								>{#each levels as level (level.value)}<option value={level.value}
										>{level.label}</option
									>{/each}</select
							></label
						><label class="grid gap-1 text-sm"
							>Batch window (minutes)<input
								class="rounded border bg-background p-2"
								type="number"
								min="0"
								max="30"
								bind:value={item.batchMinutes}
							/></label
						><label class="grid gap-1 text-sm"
							>Cadence<select class="rounded border bg-background p-2" bind:value={item.digest}
								><option value="batch">Batch</option><option value="hourly">Hourly digest</option
								><option value="daily">Daily digest</option></select
							></label
						><label class="grid gap-1 text-sm"
							>Daily digest time<input
								class="rounded border bg-background p-2"
								type="time"
								bind:value={item.at}
							/></label
						>
						<div class="flex items-end gap-3 text-sm">
							<button
								disabled={i === 0}
								onclick={() => {
									[rules[i - 1], rules[i]] = [rules[i], rules[i - 1]];
								}}>Move up</button
							><button onclick={() => (rules = rules.filter((_, n) => n !== i))}>Remove</button>
						</div>
					</fieldset>{/each}
				<div class="flex gap-4 text-sm">
					<button onclick={addRule}>Add rule</button><button
						class="rounded border px-3 py-2"
						disabled={busy}
						onclick={() => change({ action: 'rules', rules })}>Save rules</button
					>
				</div>
			</section>
			<section class="space-y-4 rounded-xl border p-5">
				<h2 class="text-lg font-medium">Quiet hours</h2>
				<label class="flex gap-2 text-sm"
					><input type="checkbox" bind:checked={quietEnabled} />Hold events during quiet hours</label
				>
				<div class="flex flex-wrap gap-4">
					<label class="grid gap-1 text-sm"
						>From<input
							type="time"
							class="rounded border bg-background p-2"
							bind:value={quietStart}
						/></label
					><label class="grid gap-1 text-sm"
						>Until<input
							type="time"
							class="rounded border bg-background p-2"
							bind:value={quietEnd}
						/></label
					><label class="grid gap-1 text-sm"
						>Time zone<input class="rounded border bg-background p-2" bind:value={zone} /></label
					>
				</div>
				<button
					class="rounded border px-3 py-2 text-sm"
					disabled={busy}
					onclick={() =>
						change({
							action: 'quiet',
							quiet: { enabled: quietEnabled, start: quietStart, end: quietEnd },
							timeZone: zone
						})}>Save quiet hours</button
				>
			</section>
			<p class="text-sm text-muted-foreground">
				Limits: 30 events per source per hour, 12 batches per hour, 20 lines per batch. A source
				exceeding its limit in three consecutive hourly windows pauses automatically.
			</p>
		{:else}
			<section class="space-y-4 rounded-xl border p-5">
				<h2 class="text-lg font-medium">Firstmate connection</h2>
				<p class="text-sm">
					{view.connected
						? 'Connected through wheelhouse-events.'
						: 'Events are kept here until you connect Firstmate.'}
				</p>
				{#if view.connectionProblem}<p role="alert" class="text-sm">
						{view.connectionProblem}
					</p>{/if}
				{#if view.bound}<button
						class="rounded border px-3 py-2 text-sm"
						disabled={busy}
						onclick={() => change({ action: 'disconnect' })}
						>Disconnect events and retire binding</button
					>{:else}<p class="text-sm text-muted-foreground">
						Connect installs a digest-pinned Wheelhouse package using Firstmate’s existing extension
						binding. This package runs as your user and reads event artifacts. Upgrades require an
						explicit rebind.
					</p>
					<label class="flex gap-2 text-sm"
						><input type="checkbox" bind:checked={trust} />I trust Wheelhouse as same-user code.</label
					><label class="flex gap-2 text-sm"
						><input type="checkbox" bind:checked={artifacts} />Allow artifact references to
						Wheelhouse’s event outbox.</label
					><button
						class="rounded bg-primary px-4 py-2 text-sm text-primary-foreground"
						disabled={busy || !trust || !artifacts}
						onclick={() =>
							change({
								action: 'connect',
								trustSameUserCode: trust,
								artifactReferences: artifacts
							})}>{busy ? 'Connecting…' : 'Connect events to Firstmate'}</button
					>{/if}
			</section>
			<section class="space-y-4 rounded-xl border p-5">
				<h2 class="text-lg font-medium">Scheduler</h2>
				<p class="text-sm text-muted-foreground">
					Local captain-authored reminders. No provider or gateway source is connected in this
					release.
				</p>
				{#if view.settings.source.reason}<p role="status" class="text-sm">
						{view.settings.source.reason}
					</p>{/if}<label class="grid max-w-xs gap-1 text-sm"
					>Default delivery<select
						class="rounded border bg-background p-2"
						value={view.settings.source.level}
						onchange={(e) =>
							change({
								action: 'source',
								level: e.currentTarget.value,
								paused: view!.settings.source.paused
							})}
						>{#each levels as level (level.value)}<option value={level.value}>{level.label}</option
							>{/each}</select
					></label
				><button
					class="rounded border px-3 py-2 text-sm"
					disabled={busy}
					onclick={() =>
						change({
							action: 'source',
							level: view!.settings.source.level,
							paused: !view!.settings.source.paused
						})}>{view.settings.source.paused ? 'Resume source' : 'Pause source'}</button
				>
			</section>
		{/if}
	{/if}
</div>
