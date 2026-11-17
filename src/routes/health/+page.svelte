<script lang="ts">
	import { untrack } from 'svelte';
	import { page } from '$app/state';
	import { BellOff, Bell, RotateCw, ScrollText } from '@lucide/svelte';
	import { Button } from '$lib/components/ui/button';
	import InsightsNav from '$lib/components/wh/insights/InsightsNav.svelte';
	import { sendToInbox } from '$lib/client/chat.svelte';
	import { SESSION_HEADER } from '$lib/client/messages';
	import { digest } from '$lib/bell';
	import { ago, clock } from '$lib/format';
	import {
		bytes,
		DEFAULT_SOUNDINGS_SETTINGS,
		severityLabel,
		span,
		type Finding,
		type Severity,
		type SoundingsSettings,
		type SoundingsView
	} from '$lib/soundings';

	let { data } = $props();
	let view = $state<SoundingsView>(untrack(() => data.view));
	let now = $state(Date.now());
	let busy = $state<'scan' | 'report' | 'settings' | null>(null);
	let problem = $state('');
	let saved = $state('');
	/** Requests to Firstmate sent from this page, by finding id: sending, sent, or why it failed. */
	let asked = $state<Record<string, { state: 'sending' | 'sent' | 'failed'; text?: string }>>({});

	const token = () => page.data.sessionToken as string;
	const open = $derived(view.findings.filter((f) => !view.muted.includes(f.id)));
	const muted = $derived(view.findings.filter((f) => view.muted.includes(f.id)));
	const latest = $derived(view.reports[0] ?? null);
	const older = $derived(view.reports.slice(1, 12));
	const m = $derived(view.machine);
	const v = $derived(view.vitals);
	const wantsLook = $derived(open.filter((f) => f.severity !== 'info').length);

	// The page keeps itself current: the server scans and judges on its own.
	$effect(() => {
		const t = setInterval(() => {
			now = Date.now();
			if (document.visibilityState === 'visible') void refresh();
		}, 20_000);
		return () => clearInterval(t);
	});

	async function refresh() {
		try {
			const r = await fetch('/api/soundings');
			if (r.ok) view = (await r.json()) as SoundingsView;
		} catch {
			// the next round tries again
		}
	}

	async function post(body: object, kind: 'scan' | 'report' | null = null) {
		busy = kind;
		problem = '';
		try {
			const r = await fetch('/api/soundings', {
				method: 'POST',
				headers: { 'content-type': 'application/json', [SESSION_HEADER]: token() },
				body: JSON.stringify(body)
			});
			const out = (await r.json()) as SoundingsView & { message?: string };
			if (!r.ok) throw new Error(out.message ?? `Wheelhouse answered ${r.status}.`);
			view = out;
			now = Date.now();
		} catch (e) {
			problem = (e as Error).message;
		} finally {
			busy = null;
		}
	}

	async function ask(f: Finding) {
		if (!f.proposal) return;
		asked[f.id] = { state: 'sending' };
		const r = await sendToInbox(
			f.proposal.note,
			token(),
			null,
			`wh-soundings-${digest(`${f.id}:${f.firstSeen}`)}`
		);
		asked[f.id] = r.ok ? { state: 'sent' } : { state: 'failed', text: r.error };
	}

	/* ------------------------------------------------------------ settings */

	let form = $state<SoundingsSettings>(untrack(() => ({ ...data.view.settings })));
	let logDirs = $state(untrack(() => data.view.settings.logDirs.join('\n')));
	const FIELDS: { key: keyof SoundingsSettings; label: string; unit: string; step?: number }[] = [
		{ key: 'scanMinutes', label: 'Scan every', unit: 'minutes' },
		{ key: 'reportMinutes', label: 'Report every', unit: 'minutes' },
		{ key: 'restartsPerHour', label: 'Crash loop above', unit: 'restarts an hour' },
		{ key: 'cpuPercent', label: 'CPU hog above', unit: '% of a core' },
		{ key: 'cpuMinutes', label: '… for', unit: 'minutes' },
		{ key: 'processMemoryGb', label: 'Memory hog above', unit: 'GB', step: 0.5 },
		{ key: 'diskFreePercent', label: 'Disk nearly full below', unit: '% free' },
		{ key: 'logGb', label: 'Log file larger than', unit: 'GB', step: 0.1 },
		{ key: 'devServerDays', label: 'Dev server running over', unit: 'days', step: 0.5 },
		{ key: 'wheelhouseMemoryMb', label: 'Wheelhouse memory above', unit: 'MB' },
		{ key: 'eventLoopMs', label: 'Wheelhouse slow above', unit: 'ms delay' },
		{ key: 'eventLoopMinutes', label: '… for', unit: 'minutes' },
		{ key: 'snapshotSeconds', label: 'Fleet reads slower than', unit: 'seconds' },
		{ key: 'snapshotMinutes', label: '… for', unit: 'minutes' }
	];

	async function saveSettings(e: SubmitEvent) {
		e.preventDefault();
		busy = 'settings';
		problem = '';
		saved = '';
		try {
			const body = {
				...form,
				logDirs: logDirs
					.split('\n')
					.map((l) => l.trim())
					.filter(Boolean)
			};
			const r = await fetch('/api/soundings/settings', {
				method: 'POST',
				headers: { 'content-type': 'application/json', [SESSION_HEADER]: token() },
				body: JSON.stringify(body)
			});
			const out = (await r.json()) as { settings?: SoundingsSettings; message?: string };
			if (!r.ok || !out.settings) throw new Error(out.message ?? 'Could not save the settings.');
			form = { ...out.settings };
			logDirs = out.settings.logDirs.join('\n');
			view = { ...view, settings: out.settings };
			saved = 'Saved. The next scan uses them.';
		} catch (err) {
			problem = (err as Error).message;
		} finally {
			busy = null;
		}
	}

	const dot: Record<Severity, string> = {
		serious: 'bg-danger',
		warning: 'bg-warning',
		info: 'bg-muted-foreground/60'
	};
	const chip: Record<Severity, string> = {
		serious: 'border-danger/40 bg-danger/5 text-danger',
		warning: 'border-warning/40 bg-warning/5 text-warning',
		info: 'text-muted-foreground'
	};
	const pressure = { normal: 'Normal', warn: 'Under pressure', critical: 'Critical' } as const;
	const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0);
</script>

<svelte:head><title>Health · Wheelhouse</title></svelte:head>

{#snippet findingRow(f: Finding, isMuted: boolean)}
	<li class="py-4 first:pt-0 last:pb-0">
		<div class="flex items-start gap-3">
			<span class="mt-2 size-2 shrink-0 rounded-full {dot[f.severity]}" aria-hidden="true"></span>
			<div class="min-w-0 flex-1">
				<div class="flex flex-wrap items-baseline gap-x-3 gap-y-1">
					<h3 class="font-medium">{f.title}</h3>
					<span class="rounded-full border px-2 py-0.5 text-xs {chip[f.severity]}"
						>{severityLabel(f.severity)}</span
					>
				</div>
				<p class="mt-1 text-sm break-words text-muted-foreground">{f.detail}</p>
				<p class="mt-1 text-xs text-muted-foreground">
					Since {ago(f.firstSeen, now)} · last seen {ago(f.lastSeen, now)}
				</p>
				<div class="mt-2 flex flex-wrap items-center gap-2">
					{#if f.proposal}
						{@const a = asked[f.id]}
						{#if a?.state === 'sent'}
							<span class="text-xs text-success">{f.proposal.sent}</span>
						{:else}
							<Button
								size="sm"
								variant="outline"
								disabled={a?.state === 'sending'}
								onclick={() => ask(f)}>{f.proposal.label}</Button
							>
						{/if}
						{#if a?.state === 'failed'}<span class="text-xs text-danger">{a.text}</span>{/if}
					{/if}
					<Button
						size="sm"
						variant="ghost"
						class="text-muted-foreground"
						onclick={() => post({ action: isMuted ? 'unmute' : 'mute', id: f.id })}
					>
						{#if isMuted}<Bell />Unmute{:else}<BellOff />Mute{/if}
					</Button>
				</div>
			</div>
		</div>
	</li>
{/snippet}

<main class="px-4 py-6 sm:px-6 lg:px-10">
	<!-- The page reads on one solid sheet; the graph paper shows only in the gutter. -->
	<div class="surface px-5 py-6 sm:px-8 sm:py-8">
		<InsightsNav />
		<div class="mt-6 flex flex-wrap items-end justify-between gap-4">
			<div>
				<h1 class="text-2xl">Health</h1>
				<p class="mt-1 max-w-prose text-sm text-muted-foreground">
					Soundings watches this computer and Wheelhouse itself. It only reports: anything it
					suggests is a request to Firstmate that you send.
				</p>
			</div>
			<div class="flex flex-wrap items-center gap-2">
				<Button
					size="sm"
					variant="outline"
					disabled={busy !== null || view.scanning}
					onclick={() => post({ action: 'scan' }, 'scan')}
				>
					<RotateCw class={busy === 'scan' || view.scanning ? 'motion-safe:animate-spin' : ''} />
					{busy === 'scan' || view.scanning ? 'Sounding…' : 'Sound now'}
				</Button>
				<Button
					size="sm"
					variant="outline"
					disabled={busy !== null || view.writing || !m}
					onclick={() => post({ action: 'report' }, 'report')}
				>
					<ScrollText />{busy === 'report' || view.writing ? 'Writing…' : 'Write a report'}
				</Button>
			</div>
		</div>

		<p class="mt-4 text-sm" role="status">
			{#if !m}
				<span class="text-muted-foreground"
					>No scan yet. The first runs within a minute of Soundings being turned on.</span
				>
			{:else if wantsLook}
				<span class="font-medium text-warning"
					>{wantsLook}
					{wantsLook === 1 ? 'thing wants' : 'things want'} a look.</span
				>
			{:else}
				<span class="font-medium text-success">All quiet.</span>
			{/if}
			{#if m}
				<span class="text-muted-foreground">
					Last sounding {ago(m.at, now)}{#if view.nextScanAt}, next at {clock(
							view.nextScanAt
						)}{/if}.</span
				>
			{/if}
		</p>
		{#if view.problem}<p class="mt-2 text-sm text-danger" role="alert">{view.problem}</p>{/if}
		{#if problem}<p class="mt-2 text-sm text-danger" role="alert">{problem}</p>{/if}

		<!-- The latest report -->
		<section class="mt-8" aria-labelledby="report-title">
			<h2 id="report-title" class="section-label">Latest report</h2>
			{#if latest}
				<article class="mt-3 rounded-xl border bg-card p-5">
					<p class="text-xs text-muted-foreground">
						{ago(latest.at, now)} · {latest.trigger === 'finding'
							? 'after a new finding'
							: latest.trigger === 'manual'
								? 'asked for'
								: 'regular'}
					</p>
					<h3 class="mt-1 font-title text-xl leading-snug">{latest.headline}</h3>
					{#if latest.summary}<p class="mt-2 max-w-prose text-sm">{latest.summary}</p>{/if}
					{#if latest.items.length}
						<ol class="mt-4 space-y-3">
							{#each latest.items as item, i (i)}
								<li class="border-l-2 border-hair pl-3 text-sm">
									<p class="font-medium">{item.title}</p>
									{#if item.cause}<p class="mt-0.5 text-muted-foreground">{item.cause}</p>{/if}
									{#if item.fix}<p class="mt-0.5">
											<span class="text-muted-foreground">Suggested:</span>
											{item.fix}
										</p>{/if}
								</li>
							{/each}
						</ol>
					{/if}
				</article>
			{:else}
				<p class="mt-3 rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
					No report yet. One is written about every {view.settings.reportMinutes} minutes, or soon after
					something new is found.
				</p>
			{/if}
		</section>

		<!-- Open findings -->
		<section class="mt-8" aria-labelledby="findings-title">
			<h2 id="findings-title" class="section-label">Open findings</h2>
			{#if open.length}
				<ul class="mt-3 divide-y">
					{#each open as f (f.id)}{@render findingRow(f, false)}{/each}
				</ul>
			{:else}
				<p class="mt-3 text-sm text-muted-foreground">Nothing open.</p>
			{/if}
			{#if muted.length}
				<details class="mt-4">
					<summary class="cursor-pointer text-sm text-muted-foreground"
						>Muted ({muted.length})</summary
					>
					<ul class="mt-3 divide-y">
						{#each muted as f (f.id)}{@render findingRow(f, true)}{/each}
					</ul>
				</details>
			{/if}
		</section>

		<div class="mt-8 grid gap-8 lg:grid-cols-2">
			<!-- This computer -->
			<section aria-labelledby="machine-title">
				<h2 id="machine-title" class="section-label">This computer</h2>
				{#if m}
					<dl class="mt-3 space-y-2 text-sm">
						<div class="flex justify-between gap-3">
							<dt class="text-muted-foreground">Load (1, 5, 15 min)</dt>
							<dd class="tabular-nums">
								{m.load.map((n) => n.toFixed(1)).join(' · ')}
								<span class="text-muted-foreground">on {m.cpus} cores</span>
							</dd>
						</div>
						<div class="flex justify-between gap-3">
							<dt class="text-muted-foreground">Memory</dt>
							<dd class="text-right tabular-nums">
								{m.memory.pressure ? pressure[m.memory.pressure] : '—'}
								{#if m.memory.availableBytes !== null}<span class="text-muted-foreground">
										· {bytes(m.memory.availableBytes)} of {bytes(m.memory.totalBytes)} free</span
									>{/if}
							</dd>
						</div>
						{#if m.memory.swapUsedBytes}
							<div class="flex justify-between gap-3">
								<dt class="text-muted-foreground">Swap in use</dt>
								<dd class="tabular-nums">{bytes(m.memory.swapUsedBytes)}</dd>
							</div>
						{/if}
						{#each m.disks as d (d.mount)}
							{@const free = pct(d.availBytes, d.sizeBytes)}
							<div>
								<div class="flex justify-between gap-3">
									<dt class="text-muted-foreground">Disk {d.mount}</dt>
									<dd
										class="tabular-nums {free < view.settings.diskFreePercent
											? 'text-warning'
											: ''}"
									>
										{bytes(d.availBytes)} free of {bytes(d.sizeBytes)}
									</dd>
								</div>
								<div class="mt-1 h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden="true">
									<div
										class="h-full {free < view.settings.diskFreePercent
											? 'bg-warning'
											: 'bg-sea/70'}"
										style="width: {100 - free}%"
									></div>
								</div>
							</div>
						{/each}
					</dl>

					<h3 class="mono-label mt-6">Busiest now</h3>
					<ul class="mt-2 space-y-1 text-sm">
						{#each [...m.processes].sort((a, b) => b.pcpu - a.pcpu).slice(0, 6) as p (p.pid)}
							<li class="flex justify-between gap-3">
								<span class="min-w-0 truncate" title={p.command}>{p.name}</span>
								<span class="shrink-0 text-muted-foreground tabular-nums"
									>{Math.round(p.pcpu)}% · {bytes(p.rssBytes)}</span
								>
							</li>
						{/each}
					</ul>

					{#if m.services.length}
						{@const failing = m.services.filter((s) => s.lastExit !== null && s.lastExit !== 0)}
						<p class="mt-4 text-sm text-muted-foreground">
							{m.services.length} background services watched{#if failing.length}, {failing.length}
								last exited with an error{/if}.
						</p>
					{/if}
					{#if m.listeners.some((l) => l.dev)}
						<h3 class="mono-label mt-6">Dev servers listening</h3>
						<ul class="mt-2 space-y-1 text-sm">
							{#each m.listeners.filter((l) => l.dev).slice(0, 8) as l (`${l.pid}:${l.port}`)}
								<li class="flex justify-between gap-3">
									<span>{l.name} <span class="text-muted-foreground">:{l.port}</span></span>
									<span class="text-muted-foreground"
										>{l.ageSeconds !== null ? `up ${span(l.ageSeconds)}` : ''}</span
									>
								</li>
							{/each}
						</ul>
					{/if}
					{#if m.logs.length}
						<h3 class="mono-label mt-6">Largest logs</h3>
						<ul class="mt-2 space-y-1 text-sm">
							{#each m.logs.slice(0, 5) as l (l.path)}
								<li class="flex justify-between gap-3">
									<span class="min-w-0 truncate font-mono text-xs" title={l.path}>{l.path}</span>
									<span class="shrink-0 text-muted-foreground tabular-nums">{bytes(l.bytes)}</span>
								</li>
							{/each}
						</ul>
					{/if}
					{#if m.gaps.length}
						<p class="mt-4 text-xs text-muted-foreground">Could not read {m.gaps.join(', ')}.</p>
					{/if}
				{:else}
					<p class="mt-3 text-sm text-muted-foreground">Not scanned yet.</p>
				{/if}
			</section>

			<!-- Wheelhouse itself -->
			<section aria-labelledby="self-title">
				<h2 id="self-title" class="section-label">Wheelhouse itself</h2>
				{#if v}
					<dl class="mt-3 space-y-2 text-sm">
						<div class="flex justify-between gap-3">
							<dt class="text-muted-foreground">Memory footprint</dt>
							<dd class="tabular-nums">
								{bytes(v.footprintBytes)}
								<span class="text-muted-foreground">· heap after GC {bytes(v.postGcHeapBytes)}</span
								>
							</dd>
						</div>
						<div class="flex justify-between gap-3">
							<dt class="text-muted-foreground">Responsiveness (event loop p99)</dt>
							<dd
								class="tabular-nums {v.eventLoopP99Ms > view.settings.eventLoopMs
									? 'text-warning'
									: ''}"
							>
								{v.eventLoopP99Ms} ms
							</dd>
						</div>
						<div class="flex justify-between gap-3">
							<dt class="text-muted-foreground">Last fleet read</dt>
							<dd class="tabular-nums">
								{v.lastSnapshotMs === null ? '—' : `${(v.lastSnapshotMs / 1000).toFixed(1)} s`}
							</dd>
						</div>
						<div class="flex justify-between gap-3">
							<dt class="text-muted-foreground">Open streams</dt>
							<dd class="tabular-nums">{v.streams}</dd>
						</div>
						<div class="flex justify-between gap-3">
							<dt class="text-muted-foreground">Chat followers</dt>
							<dd class="tabular-nums">
								{v.chatFeeds.count}
								<span class="text-muted-foreground"
									>· {v.chatFeeds.listening} in use{#if v.chatFeeds.orphans}, {v.chatFeeds.orphans}
										orphaned{/if}</span
								>
							</dd>
						</div>
						<div class="flex justify-between gap-3">
							<dt class="text-muted-foreground">Child processes</dt>
							<dd class="tabular-nums">{v.childrenPerMinute} in the last minute</dd>
						</div>
						<div class="flex justify-between gap-3">
							<dt class="text-muted-foreground">Running for</dt>
							<dd>{span(v.uptimeSeconds)}</dd>
						</div>
					</dl>
				{/if}

				<h3 class="mono-label mt-6">Page trouble</h3>
				{#if view.signals.length}
					<ul class="mt-2 space-y-2 text-sm">
						{#each view.signals.slice(0, 8) as s, i (i)}
							<li>
								<p class="break-words">
									{s.message}{#if s.count > 1}<span class="text-muted-foreground">
											×{s.count}</span
										>{/if}
								</p>
								<p class="text-xs text-muted-foreground">
									{s.kind} on {s.page} · {ago(s.at, now)}
								</p>
							</li>
						{/each}
					</ul>
				{:else}
					<p class="mt-2 text-sm text-muted-foreground">
						No errors reported by Wheelhouse’s pages.
					</p>
				{/if}
			</section>
		</div>

		<!-- History -->
		<section class="mt-8" aria-labelledby="history-title">
			<h2 id="history-title" class="section-label">History</h2>
			{#if older.length || view.cleared.length}
				<div class="mt-3 grid gap-8 lg:grid-cols-2">
					<div>
						<h3 class="mono-label">Earlier reports</h3>
						<ul class="mt-2 space-y-1">
							{#each older as r (r.id)}
								<li>
									<details>
										<summary class="cursor-pointer text-sm">
											<span class="text-muted-foreground tabular-nums">{ago(r.at, now)}</span>
											· {r.headline}
										</summary>
										<div class="mt-2 mb-3 border-l-2 border-hair pl-3 text-sm">
											{#if r.summary}<p>{r.summary}</p>{/if}
											{#each r.items as item, i (i)}
												<p class="mt-2 font-medium">{item.title}</p>
												<p class="text-muted-foreground">{item.cause} {item.fix}</p>
											{/each}
										</div>
									</details>
								</li>
							{:else}
								<li class="text-sm text-muted-foreground">None yet.</li>
							{/each}
						</ul>
					</div>
					<div>
						<h3 class="mono-label">Cleared findings</h3>
						<ul class="mt-2 space-y-1 text-sm">
							{#each view.cleared.slice(0, 12) as f (`${f.id}:${f.closedAt}`)}
								<li class="flex justify-between gap-3">
									<span class="min-w-0 truncate" title={f.detail}>{f.title}</span>
									<span class="shrink-0 text-muted-foreground">cleared {ago(f.closedAt, now)}</span>
								</li>
							{:else}
								<li class="text-muted-foreground">None yet.</li>
							{/each}
						</ul>
					</div>
				</div>
			{:else}
				<p class="mt-3 text-sm text-muted-foreground">Nothing yet.</p>
			{/if}
		</section>

		<!-- Settings -->
		<section class="mt-8" aria-labelledby="settings-title">
			<details>
				<summary class="cursor-pointer">
					<h2 id="settings-title" class="inline text-base font-semibold">Settings</h2>
					<span class="ml-2 text-sm text-muted-foreground"
						>How often, and what counts as a problem</span
					>
				</summary>
				<form class="mt-4 max-w-3xl" onsubmit={saveSettings}>
					<div class="grid gap-x-6 gap-y-3 sm:grid-cols-2">
						{#each FIELDS as field (field.key)}
							<label class="flex items-center justify-between gap-3 text-sm">
								<span class="text-muted-foreground">{field.label}</span>
								<span class="flex items-center gap-2">
									<input
										class="w-24 rounded-md border bg-background px-2 py-1 text-right tabular-nums"
										type="number"
										step={field.step ?? 1}
										bind:value={form[field.key] as number}
										placeholder={String(DEFAULT_SOUNDINGS_SETTINGS[field.key])}
									/>
									<span class="w-28 text-xs text-muted-foreground">{field.unit}</span>
								</span>
							</label>
						{/each}
						<label class="flex items-center justify-between gap-3 text-sm">
							<span class="text-muted-foreground">Report model</span>
							<input
								class="w-52 rounded-md border bg-background px-2 py-1"
								bind:value={form.model}
								placeholder={DEFAULT_SOUNDINGS_SETTINGS.model}
							/>
						</label>
					</div>
					<label class="mt-4 block text-sm">
						<span class="text-muted-foreground"
							>More log folders to watch, one per line (the usual ones are watched already)</span
						>
						<textarea
							class="mt-1 block w-full rounded-md border bg-background px-2 py-1 font-mono text-xs"
							rows="2"
							bind:value={logDirs}
							placeholder="~/my-service/logs"></textarea>
					</label>
					<div class="mt-4 flex items-center gap-3">
						<Button type="submit" size="sm" disabled={busy !== null}>Save settings</Button>
						{#if saved}<span class="text-sm text-success" role="status">{saved}</span>{/if}
					</div>
				</form>
			</details>
		</section>
	</div>
</main>
