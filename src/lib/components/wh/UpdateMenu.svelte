<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { Popover } from 'bits-ui';
	import {
		AlertTriangle,
		Check,
		CircleArrowUp,
		ExternalLink,
		LoaderCircle,
		RefreshCw
	} from '@lucide/svelte';
	import { Button } from '$lib/components/ui/button';
	import { live } from '$lib/client/live.svelte';
	import { wheelhouseUpdates as u } from '$lib/client/updates.svelte';
	import { ago, plural } from '$lib/format';
	import { UPGRADE_STEPS } from '$lib/updates';

	/**
	 * The header's Wheelhouse version and updates: a quiet icon while it is up to
	 * date, an outlined Update button when GitHub has a newer version. Its menu
	 * says what is new and upgrades on request: fast-forward the clone, reinstall,
	 * rebuild and restart, then this page reconnects by itself. A clone that
	 * cannot be upgraded as it is says why, and is left alone.
	 */

	let open = $state(false);
	const v = $derived(u.view);
	const check = $derived(v?.check ?? null);
	const job = $derived(v?.job ?? null);
	const working = $derived(u.upgrading || job?.state === 'running' || job?.state === 'restarting');
	const ready = $derived(check?.state === 'available' && !job);
	const trouble = $derived(
		job?.state === 'failed' || check?.state === 'refused' || check?.state === 'error'
	);
	const stepAt = $derived(
		u.upgrading && !job
			? UPGRADE_STEPS.length - 1
			: UPGRADE_STEPS.findIndex((s) => s.step === job?.step)
	);
	const short = (c: string | null | undefined) => (c ? c.slice(0, 7) : '');
	const version = (x: { version: string | null; commit: string | null } | null | undefined) =>
		x ? [x.version, short(x.commit)].filter(Boolean).join(' · ') : '';
	const token = () => page.data.sessionToken as string;

	onMount(() => u.start());
</script>

<Popover.Root bind:open>
	<Popover.Trigger>
		{#snippet child({ props })}
			{#if ready || working}
				<Button
					{...props}
					variant="outline"
					size="sm"
					class="gap-1.5 border-sea/50 text-sea hover:text-sea"
					aria-label={working ? 'Upgrading Wheelhouse' : 'Wheelhouse update available'}
				>
					{#if working}<LoaderCircle class="animate-spin" />{:else}<CircleArrowUp />{/if}
					<span class="hidden md:inline">{working ? 'Upgrading…' : 'Update'}</span>
				</Button>
			{:else}
				<Button
					{...props}
					variant="ghost"
					size="icon-sm"
					class="relative text-muted-foreground"
					aria-label={trouble
						? 'Wheelhouse updates: needs a look'
						: 'Wheelhouse version and updates'}
				>
					<CircleArrowUp />
					{#if trouble}
						<span class="absolute top-1 right-1 size-1.5 rounded-full bg-warning" aria-hidden="true"
						></span>
					{/if}
				</Button>
			{/if}
		{/snippet}
	</Popover.Trigger>
	<Popover.Portal>
		<Popover.Content
			align="end"
			sideOffset={4}
			class="z-50 w-96 max-w-[calc(100vw-2rem)] overflow-hidden rounded-md bg-popover text-sm text-popover-foreground shadow-md ring-1 ring-foreground/10"
		>
			<div class="border-b border-b-brass/60 px-4 py-3">
				<p class="font-display text-base font-semibold">Wheelhouse</p>
				<p class="tabular text-xs break-words text-muted-foreground">
					{version(check?.current) || 'Version unknown'}{#if check?.repository}
						· from
						<a
							class="hover:underline"
							href="https://github.com/{check.repository}"
							target="_blank"
							rel="noreferrer">{check.repository}</a
						>
						{check.branch}{/if}
				</p>
			</div>

			<div class="px-4 py-3" aria-live="polite">
				{#if working}
					<ol class="space-y-1.5" aria-label="Upgrade progress">
						{#each UPGRADE_STEPS as s, i (s.step)}
							<li class="flex items-center gap-2 {i <= stepAt ? '' : 'text-muted-foreground'}">
								{#if i < stepAt}<Check
										class="size-4 text-success"
									/>{:else if i === stepAt}<LoaderCircle
										class="size-4 animate-spin text-sea"
									/>{:else}<span class="size-4 text-center" aria-hidden="true">·</span>{/if}
								{s.label}
							</li>
						{/each}
					</ol>
					{#if job?.state === 'restarting' || (u.upgrading && !job)}
						<p class="mt-3 text-xs text-muted-foreground">Waiting for Wheelhouse to come back…</p>
					{/if}
				{:else if u.upgraded && check?.state !== 'available'}
					<p class="flex items-center gap-2">
						<Check class="size-4 text-success" />Upgraded and restarted.
					</p>
					{#if check?.current.version}
						<p class="mt-1 text-xs text-muted-foreground">
							Now running {version(check.current)}.
						</p>
					{/if}
				{:else if job?.state === 'failed'}
					<p class="flex items-start gap-2">
						<AlertTriangle class="mt-0.5 size-4 shrink-0 text-danger" />
						<span>Wheelhouse was not upgraded: {job.error}.</span>
					</p>
					{#if job.output}
						<pre
							class="mt-2 max-h-32 overflow-auto rounded-md bg-muted/60 px-2.5 py-1.5 font-mono text-[0.7rem] whitespace-pre-wrap">{job.output
								.trim()
								.split('\n')
								.slice(-12)
								.join('\n')}</pre>
					{/if}
					{#if check?.changes.length}
						<pre
							class="mt-2 rounded-md bg-muted/60 px-2.5 py-1.5 font-mono text-xs">{check.changes.join(
								'\n'
							)}</pre>
					{/if}
				{:else if !check || (v?.checking && check.state !== 'available')}
					<p class="flex items-center gap-2 text-muted-foreground">
						<LoaderCircle class="size-4 animate-spin" />Checking GitHub…
					</p>
				{:else if check.state === 'current'}
					<p class="flex items-center gap-2">
						<Check class="size-4 text-success" />Up to date.
					</p>
					<p class="mt-1 text-xs text-muted-foreground">
						Checked GitHub {ago(check.checkedAt, live.now)}.
					</p>
				{:else if check.state === 'available'}
					<p class="font-medium">
						{check.behind}
						{plural(check.behind, 'new commit', 'new commits')} on {check.branch}{#if check.latest?.version && check.latest.version !== check.current.version}
							<span class="font-normal text-muted-foreground"> · {check.latest.version}</span>{/if}
					</p>
					<ul class="mt-2 max-h-56 space-y-1.5 overflow-auto border-l border-hair pl-3">
						{#each check.commits as c (c.sha)}
							<li class="text-xs">
								<span class="line-clamp-2">{c.subject}</span>
								<span class="tabular text-muted-foreground"
									>{short(c.sha)} · {ago(c.date, live.now)}</span
								>
							</li>
						{/each}
						{#if check.behind > check.commits.length}
							<li class="text-xs text-muted-foreground">
								and {check.behind - check.commits.length} more
							</li>
						{/if}
					</ul>
					{#if check.repository && check.current.commit && check.latest}
						<a
							href="https://github.com/{check.repository}/compare/{check.current.commit}...{check
								.latest.commit}"
							target="_blank"
							rel="noreferrer"
							class="mt-2 inline-flex items-center gap-1 text-xs text-sea hover:underline"
							>Compare on GitHub<ExternalLink class="size-3" /></a
						>
					{/if}
					<p class="mt-3 text-xs leading-relaxed text-muted-foreground">
						Upgrading fast-forwards {check.dir}, reinstalls, rebuilds and restarts Wheelhouse. This
						page reconnects by itself. Firstmate and its crew keep running.
					</p>
					{#if v?.busy.length}
						<div class="mt-3 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs">
							<p class="font-medium text-warning">Restarting stops:</p>
							<ul class="mt-0.5">
								{#each v.busy as b (b)}<li>{b}</li>{/each}
							</ul>
						</div>
					{/if}
					{#if !v?.canRestart}
						<p class="mt-3 text-xs text-muted-foreground">
							This Wheelhouse was not started by <code>wheelhouse open</code>, so it cannot restart
							itself; run <code>wheelhouse upgrade</code> in a terminal instead.
						</p>
					{/if}
				{:else}
					<p class="flex items-start gap-2">
						<AlertTriangle class="mt-0.5 size-4 shrink-0 text-warning" />
						<span
							>{#if check.state === 'refused'}{check.behind}
								{plural(check.behind, 'new commit', 'new commits')} on {check.branch}, but
							{/if}{check.reason}.</span
						>
					</p>
					{#if check.changes.length}
						<pre
							class="mt-2 rounded-md bg-muted/60 px-2.5 py-1.5 font-mono text-xs">{check.changes.join(
								'\n'
							)}</pre>
					{/if}
					{#if check.state === 'refused'}
						<p class="mt-2 text-xs text-muted-foreground">Nothing was changed.</p>
					{/if}
				{/if}
				{#if u.error}
					<p class="mt-3 text-xs text-danger" role="alert">{u.error}</p>
				{/if}
			</div>

			<div class="flex items-center justify-between gap-2 border-t px-4 py-2.5">
				{#if ready}
					<Button variant="ghost" size="sm" onclick={() => (open = false)}>Not now</Button>
					<Button
						size="sm"
						disabled={u.sending || !v?.canRestart}
						onclick={() => u.upgrade(token())}>Upgrade and restart</Button
					>
				{:else if working}
					<span class="text-xs text-muted-foreground">You can close this; it carries on.</span>
				{:else}
					<span class="text-xs text-muted-foreground">Checks GitHub every 6 hours.</span>
					<Button
						variant="outline"
						size="sm"
						disabled={u.sending || v?.checking}
						onclick={() => u.check(token())}
					>
						<RefreshCw class={u.sending || v?.checking ? 'animate-spin' : ''} />Check now
					</Button>
				{/if}
			</div>
		</Popover.Content>
	</Popover.Portal>
</Popover.Root>
