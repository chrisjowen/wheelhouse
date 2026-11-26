<script lang="ts">
	import { Dialog as DialogPrimitive } from 'bits-ui';
	import type { Snippet } from 'svelte';
	import { page } from '$app/state';
	import type { Section } from '$lib/nav';
	import { currentCrew, currentFleet, currentHealth } from '$lib/client/live.svelte';
	import { firstmateChat } from '$lib/client/chat.svelte';
	import { navDrawer } from '$lib/client/navdrawer.svelte';
	import { theme, toggleTheme } from '$lib/client/theme.svelte';
	import { homeLabel, inPlay } from '$lib/bridge';
	import Switch from './Switch.svelte';
	import { sectionIcons } from './navicons';
	import { Anchor, Gauge, MoreHorizontal, Puzzle, Settings, X } from '@lucide/svelte';

	/**
	 * A phone's menu: a drawer that slides in from the left (from MenuButton) in place
	 * of the left-hand menu and a bar along the foot of the screen. It holds the
	 * project the pages are scoped to (`scope`, which opens the project picker), the
	 * main sections with their counts, On deck as "Needs you", then More, Settings
	 * and the light/dark switch. A link taken from it, a tap beside it, Escape and
	 * the back gesture close it (lib/client/navdrawer.svelte.ts). It keeps clear of
	 * the notch and the home bar.
	 */
	let {
		sections,
		decisionsOpen = 0,
		scope
	}: {
		sections: Section[];
		decisionsOpen?: number;
		/** The project picker's trigger: the pages' project, which opens the picker. */
		scope: Snippet;
	} = $props();

	const fleet = $derived(currentFleet());
	const home = $derived(homeLabel(currentHealth()?.firstmate.home));
	const playing = $derived((fleet?.tasks ?? []).filter(inPlay).length);
	const discussions = $derived(currentCrew()?.discussions.length ?? 0);
	const countOf = (s: Section) =>
		s.key === 'decisions'
			? decisionsOpen
			: s.key === 'harbour'
				? playing
				: s.key === 'crew'
					? discussions
					: s.key
						? 0
						: (s.badge ?? 0);
	const path = $derived(page.url.pathname);
	const onMore = $derived(path === '/more');
	const onSettings = $derived(path.startsWith('/settings'));

	// A link taken from the drawer closes it without leaving it open behind in the history.
	function onclick(e: MouseEvent) {
		if ((e.target as HTMLElement | null)?.closest('a[href]')) navDrawer.leave();
	}
</script>

{#snippet row(href: string, label: string, on: boolean, Icon: typeof Anchor)}
	<a {href} class="nav-item" aria-current={on ? 'page' : undefined}>
		<Icon class="size-[1.1rem] shrink-0" strokeWidth={1.75} aria-hidden="true" />
		<span class="flex-1 truncate">{label}</span>
	</a>
{/snippet}

<DialogPrimitive.Root
	open={navDrawer.open}
	onOpenChange={(open) => {
		if (!open) navDrawer.hide();
	}}
>
	<DialogPrimitive.Portal>
		<DialogPrimitive.Overlay
			class="fixed inset-0 z-50 bg-black/40 duration-200 data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0"
		/>
		<DialogPrimitive.Content
			class="fixed inset-y-0 left-0 z-50 flex w-[min(20rem,86vw)] flex-col border-r bg-nav pt-[env(safe-area-inset-top,0px)] pb-[env(safe-area-inset-bottom,0px)] pl-[env(safe-area-inset-left,0px)] text-foreground shadow-2xl duration-200 outline-none data-open:animate-in data-open:slide-in-from-left data-closed:animate-out data-closed:slide-out-to-left"
			onOpenAutoFocus={(e) => e.preventDefault()}
			{onclick}
			data-nav-drawer
		>
			<div class="flex h-14 shrink-0 items-center gap-2.5 pr-1.5 pl-4">
				<span class="logo-mark"><Anchor class="size-5" aria-hidden="true" /></span>
				<DialogPrimitive.Title
					class="min-w-0 flex-1 font-logo text-[1.2rem] font-bold tracking-tight"
					>Wheelhouse</DialogPrimitive.Title
				>
				<DialogPrimitive.Close
					class="grid size-11 shrink-0 cursor-pointer place-items-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
					aria-label="Close the menu"><X class="size-5" aria-hidden="true" /></DialogPrimitive.Close
				>
			</div>
			{#if home}<p class="px-4 pb-1">
					<span class="home-tag inline-block">{home}</span>
				</p>{/if}

			<nav
				class="no-scrollbar flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto overscroll-contain px-3 pt-3 pb-3"
				aria-label="Main"
			>
				<p class="mono-label px-3 pb-2" aria-hidden="true">Project</p>
				<div class="px-1 pb-4">{@render scope()}</div>

				<p class="mono-label px-3 pb-2" aria-hidden="true">Bridge</p>
				{#each sections as s, i (s.href)}
					{@const Icon = s.key ? sectionIcons[s.key] : Puzzle}
					{@const count = countOf(s)}
					{@const strong = s.key === 'decisions'}
					{#if !s.key && sections[i - 1]?.key}<div
							class="mx-3 my-2.5 border-t"
							aria-hidden="true"
						></div>{/if}
					<a
						href={s.href}
						class="nav-item"
						aria-current={s.on ? 'page' : undefined}
						aria-label={count
							? `${s.label}, ${count} ${strong || s.key === 'crew' ? 'open' : s.key === 'harbour' ? 'in play' : ''}`.trim()
							: undefined}
					>
						{#if s.icon && /\.svg(\?|$)/.test(s.icon)}<span
								class="plugin-icon block size-[1.1rem] shrink-0 bg-current"
								style:--icon="url('{s.icon}')"
								aria-hidden="true"
							></span>{:else if s.icon}<img
								src={s.icon}
								alt=""
								class="block size-[1.1rem] shrink-0 object-contain"
							/>{:else}<Icon
								class="size-[1.1rem] shrink-0"
								strokeWidth={1.75}
								aria-hidden="true"
							/>{/if}
						<span class="flex-1 truncate">{s.label}</span>
						{#if s.key === 'firstmate' && firstmateChat.needsYou}<span
								class="nav-working nav-needs"
								aria-hidden="true">Needs you</span
							>{:else if s.key === 'firstmate' && firstmateChat.atWork}<span
								class="nav-working"
								aria-hidden="true">Working</span
							>{/if}
						{#if count}<span
								class="tabular {strong
									? 'rounded-full bg-sea/15 px-1.5 text-xs leading-5 font-medium text-sea'
									: 'font-mono text-[0.72rem] text-muted-foreground'}"
								aria-hidden="true">{count}</span
							>{/if}
					</a>
					{#if s.key === 'firstmate'}
						<!-- On deck: what is waiting on the captain, beside the chat on a wide screen. -->
						<a
							href="/deck"
							class="nav-item"
							aria-current={path === '/deck' ? 'page' : undefined}
							aria-label={decisionsOpen ? `Needs you, ${decisionsOpen} open` : undefined}
						>
							<Gauge class="size-[1.1rem] shrink-0" strokeWidth={1.75} aria-hidden="true" />
							<span class="flex-1 truncate">Needs you</span>
							{#if decisionsOpen}<span
									class="tabular rounded-full bg-sea/15 px-1.5 text-xs leading-5 font-medium text-sea"
									aria-hidden="true">{decisionsOpen}</span
								>{/if}
						</a>
					{/if}
				{/each}
			</nav>

			<div class="flex shrink-0 flex-col gap-1 border-t p-3">
				{@render row('/more', 'More', onMore, MoreHorizontal)}
				{@render row('/settings', 'Settings', onSettings, Settings)}
				<div class="flex min-h-11 items-center justify-between gap-3 px-3" data-theme-row>
					<span class="text-[1.02rem] text-foreground/85">Dark mode</span>
					<Switch checked={theme.dark} label="Dark mode" onchange={() => toggleTheme()} />
				</div>
			</div>
		</DialogPrimitive.Content>
	</DialogPrimitive.Portal>
</DialogPrimitive.Root>

<style>
	/* A plugin's SVG icon, as a stencil: it takes the menu's ink and its states. */
	.plugin-icon {
		mask: var(--icon) center / contain no-repeat;
	}
</style>
