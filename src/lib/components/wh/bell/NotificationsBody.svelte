<script lang="ts">
	import { page } from '$app/state';
	import { Button } from '$lib/components/ui/button';
	import { ArrowLeft, BellRing, Check, ExternalLink, Settings, X } from '@lucide/svelte';
	import { ALERT_KINDS } from '$lib/bell';
	import { bell, kindLabel } from '$lib/client/bell.svelte';
	import { currentFleet, live } from '$lib/client/live.svelte';
	import { aliases } from '$lib/client/aliases.svelte';
	import { strike } from '$lib/client/chime';
	import { projectLabels } from '$lib/projectnames';
	import { ago } from '$lib/format';
	import type { AlertAction, ShipAlert } from '$lib/types';
	import { alertTone, dotClass, textClass } from '../tone';

	/**
	 * What the notifications pane holds, in the header's popover on a wide screen and
	 * in a sheet on a phone (NotificationsPane, NotificationsSheet): what still waits
	 * on the captain pinned under Needs you with its one-tap actions, the rest newest
	 * first under its project, and, behind the gear, this browser's settings. A row
	 * opens its task, decision or page and is marked read.
	 */
	let { view = $bindable('list') }: { view?: 'list' | 'settings' } = $props();

	// A change of view starts at the top of whatever scrolls the pane (its own list, or a phone's sheet).
	let top = $state<HTMLElement | null>(null);
	$effect(() => {
		void view;
		for (let el = top?.parentElement; el; el = el.parentElement) {
			if (el.scrollTop > 0) {
				el.scrollTop = 0;
				break;
			}
		}
	});

	const token = $derived((page.data.sessionToken as string | undefined) ?? '');
	const unread = $derived(bell.unread);
	const waiting = $derived(bell.log.filter((a) => bell.waiting(a)));
	const labels = $derived(projectLabels(currentFleet()?.projects ?? [], aliases.names));
	const OWN = 'Firstmate and Wheelhouse';
	// The rest, under its project, the group with the newest alert first.
	const groups = $derived.by(() => {
		const out: [string, ShipAlert[]][] = [];
		for (const a of bell.log) {
			if (bell.waiting(a)) continue;
			const name = a.projectId ? (labels.get(a.projectId)?.label ?? a.projectId) : OWN;
			const group = out.find(([n]) => n === name);
			if (group) group[1].push(a);
			else out.push([name, [a]]);
		}
		return out;
	});

	const notifyNote = $derived(
		bell.permission === 'unsupported'
			? 'This browser cannot show notifications.'
			: bell.permission === 'denied'
				? 'Blocked in this browser’s site settings.'
				: 'When no Wheelhouse tab is in front.'
	);

	/** Where a row leads: its first page in Wheelhouse, else its first link. */
	function primary(a: ShipAlert): AlertAction | undefined {
		return (
			a.actions.find((x) => x.kind === 'open' && !x.external) ??
			a.actions.find((x) => x.kind === 'open')
		);
	}

	function follow(a: ShipAlert) {
		bell.markRead(a);
		const go = primary(a);
		if (go) void bell.act(go);
	}
</script>

{#snippet actions(a: ShipAlert)}
	<div class="mt-2 flex flex-wrap items-center gap-1.5 pointer-coarse:gap-1">
		{#each a.actions as action, i (action.label)}
			{#if action.kind === 'note'}
				{@const note = bell.notes[action.requestId]}
				{#if note?.state === 'sent'}
					<span class="inline-flex h-7 items-center gap-1 px-1 text-xs font-medium text-success"
						><Check class="size-3.5" aria-hidden="true" />{action.sent}</span
					>
				{:else}
					<Button
						size="sm"
						class="h-7 pointer-coarse:h-9 pointer-coarse:px-2.5 pointer-coarse:text-[0.8125rem]"
						variant={i === 0 ? 'default' : 'outline'}
						disabled={note?.state === 'sending' || !token}
						onclick={() => {
							bell.markRead(a);
							void bell.act(action, token);
						}}
						>{note?.state === 'sending'
							? 'Sending…'
							: note?.state === 'failed'
								? `Retry: ${action.label}`
								: action.label}</Button
					>
				{/if}
			{:else}
				<Button
					size="sm"
					class="h-7 pointer-coarse:h-9 pointer-coarse:px-2.5 pointer-coarse:text-[0.8125rem]"
					variant={i === 0 ? 'default' : 'outline'}
					onclick={() => {
						bell.markRead(a);
						void bell.act(action);
					}}
					>{action.label}{#if action.external}<ExternalLink class="size-3" />{/if}</Button
				>
			{/if}
		{/each}
	</div>
	{#each a.actions as action (action.label)}
		{#if action.kind === 'note' && bell.notes[action.requestId]?.state === 'failed'}
			{@const n = bell.notes[action.requestId]}
			<p class="mt-1.5 text-xs text-danger">{n.state === 'failed' ? n.error : ''}</p>
		{/if}
	{/each}
{/snippet}

{#snippet row(a: ShipAlert, needs: boolean)}
	{@const tone = alertTone[a.kind]}
	{@const read = bell.isRead(a)}
	<li class="group relative border-b border-border/60 last:border-b-0" data-alert={a.id}>
		{#if needs}<span class="absolute inset-y-0 left-0 w-0.5 {dotClass[tone]}" aria-hidden="true"
			></span>{/if}
		<div class="flex items-start gap-2 py-2.5 pr-2 pl-4">
			<span
				class="mt-1.5 size-1.5 shrink-0 rounded-full {read ? 'bg-transparent' : 'bg-brass'}"
				aria-hidden="true"
			></span>
			<div class="min-w-0 flex-1">
				<button
					type="button"
					class="block w-full text-left focus-visible:underline focus-visible:outline-none"
					onclick={() => follow(a)}
				>
					<span class="flex items-baseline justify-between gap-3 text-xs">
						<span class="font-medium {textClass[tone]}">{kindLabel(a.kind)}</span>
						<span class="shrink-0 text-muted-foreground">{ago(a.at, live.now)}</span>
					</span>
					<span class="mt-0.5 line-clamp-1 text-sm {read ? 'font-normal' : 'font-semibold'}"
						>{a.title}</span
					>
					<span class="line-clamp-2 text-xs leading-snug text-muted-foreground">{a.text}</span>
					{#if !read}<span class="sr-only">Unread.</span>{/if}
				</button>
				{#if needs}{@render actions(a)}{/if}
			</div>
			<Button
				variant="ghost"
				size="icon-xs"
				class="-mr-0.5 text-muted-foreground md:group-focus-within:opacity-100 md:group-hover:opacity-100 pointer-coarse:-mt-2 pointer-coarse:size-10 md:pointer-fine:opacity-0"
				aria-label="Clear {a.title}"
				onclick={() => bell.clear(a)}><X /></Button
			>
		</div>
	</li>
{/snippet}

{#snippet list()}
	{#if waiting.length}
		<section aria-label="Needs you">
			<h3
				class="px-4 pt-3 pb-1 text-[0.6875rem] font-semibold tracking-[0.12em] text-sea uppercase"
			>
				Needs you
			</h3>
			<ul>
				{#each waiting as a (a.id)}{@render row(a, true)}{/each}
			</ul>
		</section>
	{/if}
	{#each groups as [name, items] (name)}
		<section aria-label={name}>
			<h3
				class="px-4 pt-3 pb-1 text-[0.6875rem] font-semibold tracking-[0.12em] text-muted-foreground uppercase"
			>
				{name}
			</h3>
			<ul>
				{#each items as a (a.id)}{@render row(a, false)}{/each}
			</ul>
		</section>
	{/each}
	{#if !bell.log.length}
		<p class="px-4 py-8 text-center text-sm text-muted-foreground">
			All quiet. Nothing has rung lately.
		</p>
	{/if}
{/snippet}

{#snippet settings()}
	<div class="px-4 py-3 text-sm">
		<h3 class="text-[0.6875rem] font-semibold tracking-[0.12em] text-muted-foreground uppercase">
			Count and ring for
		</h3>
		<ul class="mt-1">
			{#each ALERT_KINDS as k (k.kind)}
				<li>
					<label class="flex cursor-pointer items-start gap-2.5 py-1.5">
						<input
							type="checkbox"
							class="mt-0.5 size-4 accent-[var(--sea)]"
							checked={bell.settings.kinds[k.kind]}
							onchange={(e) => bell.setKind(k.kind, e.currentTarget.checked)}
						/>
						<span class="flex flex-col"
							><span>{k.label}</span><span class="text-xs text-muted-foreground">{k.hint}</span
							></span
						>
					</label>
				</li>
			{/each}
		</ul>
		<p class="mt-1 text-xs text-muted-foreground">Kinds you turn off are still listed, quietly.</p>

		<h3
			class="mt-4 text-[0.6875rem] font-semibold tracking-[0.12em] text-muted-foreground uppercase"
		>
			How
		</h3>
		<label class="flex cursor-pointer items-start gap-2.5 py-1.5">
			<input
				type="checkbox"
				class="mt-0.5 size-4 accent-[var(--sea)]"
				checked={bell.settings.sound}
				onchange={(e) => bell.setSound(e.currentTarget.checked)}
			/>
			<span class="flex flex-col"
				><span>Bell sound</span><span class="text-xs text-muted-foreground"
					>Two strokes of a ship’s bell. Off unless you turn it on.</span
				></span
			>
		</label>
		<label class="flex cursor-pointer items-start gap-2.5 py-1.5">
			<input
				type="checkbox"
				class="mt-0.5 size-4 accent-[var(--sea)]"
				checked={bell.settings.notify}
				disabled={bell.permission === 'unsupported' || bell.permission === 'denied'}
				onchange={(e) => void bell.setNotify(e.currentTarget.checked)}
			/>
			<span class="flex flex-col"
				><span>Browser notifications</span><span class="text-xs text-muted-foreground"
					>{notifyNote}</span
				></span
			>
		</label>
		<Button variant="ghost" size="sm" class="mt-1 -ml-2" onclick={() => strike()}
			><BellRing class="text-brass" />Ring the bell to hear it</Button
		>
	</div>
{/snippet}

<div
	bind:this={top}
	class="sticky top-0 z-10 flex items-center gap-1 border-b border-b-brass/60 bg-popover px-4 py-2 pointer-coarse:py-1.5"
>
	{#if view === 'settings'}
		<Button
			variant="ghost"
			size="sm"
			class="-ml-2 text-muted-foreground"
			onclick={() => (view = 'list')}><ArrowLeft />Back</Button
		>
		<span class="flex-1"></span>
	{:else}
		<p class="flex-1 text-xs text-muted-foreground">
			{unread ? `${unread} unread` : 'All read'}
		</p>
		<Button
			variant="ghost"
			size="sm"
			class="h-7 px-2 text-xs pointer-coarse:h-10 pointer-coarse:px-2.5 pointer-coarse:text-sm"
			disabled={!unread}
			onclick={() => bell.markAllRead()}>Mark all read</Button
		>
		<Button
			variant="ghost"
			size="sm"
			class="h-7 px-2 text-xs pointer-coarse:h-10 pointer-coarse:px-2.5 pointer-coarse:text-sm"
			disabled={bell.log.length === waiting.length}
			title="Clear everything that no longer needs you"
			onclick={() => bell.clearSettled()}>Clear</Button
		>
		<Button
			variant="ghost"
			size="icon-xs"
			class="text-muted-foreground pointer-coarse:size-10"
			aria-label="Notification settings"
			onclick={() => (view = 'settings')}><Settings /></Button
		>
	{/if}
</div>
<div class="min-h-0 flex-1 overflow-y-auto overscroll-contain">
	{#if view === 'settings'}{@render settings()}{:else}{@render list()}{/if}
</div>
