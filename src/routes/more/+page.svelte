<script lang="ts">
	/**
	 * More page (phone-only): aggregates Logbook, Crew, Vault, Plugins, Settings.
	 * Reuses LOGBOOK_ROW from $lib/nav.
	 * On desktop this is reached via the header gear/settings; on phone it is a tab.
	 */
	import { page } from '$app/state';
	import { LOGBOOK_ROW } from '$lib/nav';
	import { currentFleet } from '$lib/client/live.svelte';
	import { slots } from '$lib/client/slots.svelte';
	import { navPageHref, slotKey } from '$lib/plugins/keys';
	import type { SlotView } from '$lib/plugins/types';
	import { BookOpen, Users, Key, Puzzle, Settings, ChevronRight } from '@lucide/svelte';

	const fleet = $derived(currentFleet());
	const pageSlots = $derived(page.data.slots as Record<string, SlotView> | undefined);
	const fleetSlotsAt = $derived(
		pageSlots?.[slotKey.fleet] ? ((page.data.slotsAt as number | undefined) ?? 0) : 0
	);
	const fleetEntries = $derived(
		slots.entries(slotKey.fleet, pageSlots, fleetSlotsAt).filter((e) => e.content.available)
	);
	const pluginPages = $derived(
		fleetEntries
			.filter((e) => e.slot === 'nav.page')
			.map((e) => ({ href: navPageHref(e), label: e.title, icon: e.icon, badge: e.badge }))
	);

	const logbook = LOGBOOK_ROW;
	const mates = $derived(fleet?.secondMates ?? []);
</script>

<svelte:head><title>More · Wheelhouse</title></svelte:head>

<div class="mx-auto max-w-2xl px-4 py-6 md:py-8">
	<h1 class="mb-6 text-2xl font-semibold tracking-tight">More</h1>

	<!-- Logbook -->
	<section class="mb-8">
		<div class="mb-3 flex items-center gap-2 px-1">
			<BookOpen class="size-4 text-muted-foreground" aria-hidden="true" />
			<h2 class="mono-label text-sm">Logbook</h2>
		</div>
		<div class="divide-y rounded-xl border bg-card">
			{#each logbook as item (item.href)}
				<a
					href={item.href}
					class="flex items-center justify-between px-4 py-3 transition-colors hover:bg-muted/50 active:bg-muted"
				>
					<span>{item.label}</span>
					<ChevronRight class="size-4 text-muted-foreground" />
				</a>
			{/each}
		</div>
	</section>

	<!-- Crew -->
	<section class="mb-8">
		<div class="mb-3 flex items-center gap-2 px-1">
			<Users class="size-4 text-muted-foreground" aria-hidden="true" />
			<h2 class="mono-label text-sm">Crew</h2>
		</div>
		<div class="divide-y rounded-xl border bg-card">
			<a
				href="/second-mates"
				class="flex items-center justify-between px-4 py-3 transition-colors hover:bg-muted/50 active:bg-muted"
			>
				<span>Second mates</span>
				<div class="flex items-center gap-2 text-sm text-muted-foreground">
					{#if mates.length}<span>{mates.length}</span>{/if}
					<ChevronRight class="size-4" />
				</div>
			</a>
			<a
				href="/settings/plugins"
				class="flex items-center justify-between px-4 py-3 transition-colors hover:bg-muted/50 active:bg-muted"
			>
				<span>Plugins</span>
				<ChevronRight class="size-4 text-muted-foreground" />
			</a>
			<a
				href="/plugins"
				class="flex items-center justify-between px-4 py-3 transition-colors hover:bg-muted/50 active:bg-muted"
			>
				<span>Find plugins</span>
				<ChevronRight class="size-4 text-muted-foreground" />
			</a>
		</div>
	</section>

	<!-- Vault -->
	<section class="mb-8">
		<div class="mb-3 flex items-center gap-2 px-1">
			<Key class="size-4 text-muted-foreground" aria-hidden="true" />
			<h2 class="mono-label text-sm">Vault</h2>
		</div>
		<div class="rounded-xl border bg-card">
			<a
				href="/settings/vault"
				class="flex items-center justify-between px-4 py-3 transition-colors hover:bg-muted/50 active:bg-muted"
			>
				<span>Secrets</span>
				<ChevronRight class="size-4 text-muted-foreground" />
			</a>
		</div>
	</section>

	<!-- Plugins (nav.page entries) -->
	{#if pluginPages.length}
		<section class="mb-8">
			<div class="mb-3 flex items-center gap-2 px-1">
				<Puzzle class="size-4 text-muted-foreground" aria-hidden="true" />
				<h2 class="mono-label text-sm">Plugins</h2>
			</div>
			<div class="divide-y rounded-xl border bg-card">
				{#each pluginPages as p (p.href)}
					<a
						href={p.href}
						class="flex items-center justify-between px-4 py-3 transition-colors hover:bg-muted/50 active:bg-muted"
					>
						<span>{p.label}</span>
						<ChevronRight class="size-4 text-muted-foreground" />
					</a>
				{/each}
			</div>
		</section>
	{/if}

	<!-- Settings -->
	<section>
		<div class="mb-3 flex items-center gap-2 px-1">
			<Settings class="size-4 text-muted-foreground" aria-hidden="true" />
			<h2 class="mono-label text-sm">This phone</h2>
		</div>
		<div class="divide-y rounded-xl border bg-card">
			<a
				href="/settings/gateway"
				class="flex items-center justify-between px-4 py-3 transition-colors hover:bg-muted/50 active:bg-muted"
			>
				<span>Appearance & notifications</span>
				<ChevronRight class="size-4 text-muted-foreground" />
			</a>
			<a
				href="/settings/cloud"
				class="flex items-center justify-between px-4 py-3 transition-colors hover:bg-muted/50 active:bg-muted"
			>
				<span>Wheelhouse Cloud</span>
				<ChevronRight class="size-4 text-muted-foreground" />
			</a>
		</div>
	</section>
</div>
