<script lang="ts">
	import { onMount, type Component } from 'svelte';
	import type { Section, SectionKey } from '$lib/nav';
	import * as Tooltip from '$lib/components/ui/tooltip';
	import { roll } from '$lib/motion';
	import { currentFleet } from '$lib/client/live.svelte';
	import { firstmateChat } from '$lib/client/chat.svelte';
	import { hueOf, initials, inPlay } from '$lib/bridge';
	import {
		BookOpen,
		MessageCircleQuestionMark,
		MessagesSquare,
		PanelLeftClose,
		PanelLeftOpen,
		Puzzle,
		RadioTower,
		Ship
	} from '@lucide/svelte';

	/**
	 * The left-hand menu under the header, the bridge: the main sections (see mainSections),
	 * each with an icon, Firstmate marked while it works, the Harbour with the work in play,
	 * Decisions with its count of open questions, then the plugins' own pages, each with the
	 * icon its manifest names (an SVG drawn in the menu's ink, like the sections', any other
	 * image in its own colours), else a puzzle piece, and the count it reports. Under them,
	 * the second mates: each as an initials disc, where it runs and a status dot.
	 * It folds to an icon rail (with tooltips) from its own button or Cmd/Ctrl+B,
	 * remembered in this browser; `<html data-nav="rail">` holds the folded state so the
	 * first paint is already right (see app.html). Narrow screens leave it out: the
	 * header carries the sections there.
	 */
	let {
		sections,
		decisionsOpen = 0,
		fill = false
	}: {
		sections: Section[];
		decisionsOpen?: number;
		/** The page fills the viewport, so the menu takes its row's height instead of sticking. */
		fill?: boolean;
	} = $props();

	const fleet = $derived(currentFleet());
	const mates = $derived(fleet?.secondMates ?? []);
	const playing = $derived((fleet?.tasks ?? []).filter(inPlay).length);
	const countOf = (s: Section) =>
		s.key === 'decisions'
			? decisionsOpen
			: s.key === 'harbour'
				? playing
				: s.key
					? 0
					: (s.badge ?? 0);
	const mateDot = (m: (typeof mates)[number]) =>
		m.tone === 'captain'
			? 'waiting on you'
			: m.tone === 'trouble'
				? 'cannot be read'
				: m.health.text;

	const icons: Record<SectionKey, Component> = {
		firstmate: MessagesSquare,
		harbour: Ship,
		decisions: MessageCircleQuestionMark,
		remotes: RadioTower,
		logbook: BookOpen
	};

	let rail = $state(false);
	onMount(() => {
		rail = document.documentElement.dataset.nav === 'rail';
	});
	function toggleRail() {
		rail = !rail;
		if (rail) document.documentElement.dataset.nav = 'rail';
		else delete document.documentElement.dataset.nav;
		try {
			localStorage.setItem('wheelhouse-nav', rail ? 'rail' : 'full');
		} catch {
			// storage unavailable; the choice lasts for this page only
		}
	}
	const mac = $derived(
		typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)
	);
	const shortcut = $derived(mac ? '⌘B' : 'Ctrl+B');

	// Cmd/Ctrl+B folds the menu, except inside a terminal, where Ctrl+B is tmux's.
	function onkeydown(e: KeyboardEvent) {
		if (e.key.toLowerCase() !== 'b' || e.shiftKey || e.altKey) return;
		if (!(mac ? e.metaKey : e.ctrlKey)) return;
		if ((e.target as HTMLElement | null)?.closest?.('.xterm')) return;
		e.preventDefault();
		toggleRail();
	}
</script>

<svelte:window {onkeydown} />

{#snippet tip(label: string)}
	<Tooltip.Content side="right" sideOffset={8}>{label}</Tooltip.Content>
{/snippet}

<aside
	class="sidebar z-20 hidden shrink-0 flex-col border-r bg-nav md:flex {fill
		? 'min-h-0'
		: 'sticky top-15 h-[calc(100dvh-3.75rem)] self-start'}"
	aria-label="Menu"
>
	<nav
		class="no-scrollbar flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto px-3 pt-5 pb-3"
		aria-label="Main"
	>
		<p class="mono-label px-3 pb-2" aria-hidden="true">Bridge</p>
		{#each sections as s, i (s.href)}
			{@const Icon = s.key ? icons[s.key] : Puzzle}
			{@const count = countOf(s)}
			{@const strong = s.key === 'decisions'}
			{@const working = s.key === 'firstmate' && firstmateChat.atWork}
			{#if !s.key && sections[i - 1]?.key}<div
					class="mx-3 my-2.5 border-t"
					aria-hidden="true"
				></div>{/if}
			<Tooltip.Root disabled={!rail}>
				<Tooltip.Trigger>
					{#snippet child({ props })}
						<a
							{...props}
							href={s.href}
							class="nav-item"
							aria-current={s.on ? 'page' : undefined}
							aria-label={count
								? `${s.label}, ${count} ${strong ? 'open' : s.key === 'harbour' ? 'in play' : ''}`.trim()
								: working
									? `${s.label}, working`
									: undefined}
						>
							<span class="relative shrink-0">
								{#if s.icon && /\.svg(\?|$)/.test(s.icon)}<span
										class="plugin-icon block size-[1.1rem] bg-current"
										style:--icon="url('{s.icon}')"
										aria-hidden="true"
									></span>{:else if s.icon}<img
										src={s.icon}
										alt=""
										class="block size-[1.1rem] object-contain"
									/>{:else}<Icon class="size-[1.1rem]" strokeWidth={1.75} aria-hidden="true" />{/if}
								{#if count && strong}<span
										class="nav-dot absolute -top-0.5 -right-0.5 size-2 rounded-full bg-sea ring-2 ring-nav"
										aria-hidden="true"
									></span>{/if}
							</span>
							<span class="nav-label flex-1 truncate">{s.label}</span>
							{#if working}<span class="nav-label nav-working" aria-hidden="true">Working</span
								>{/if}
							{#if count}<span
									class="nav-label tabular overflow-hidden {strong
										? 'rounded-full bg-sea/15 px-1.5 text-xs leading-5 font-medium text-sea'
										: 'font-mono text-[0.72rem] text-muted-foreground'}"
									aria-hidden="true"
									>{#key count}<span class="inline-block" in:roll>{count}</span>{/key}</span
								>{/if}
						</a>
					{/snippet}
				</Tooltip.Trigger>
				{@render tip(
					count
						? `${s.label} · ${count} ${strong ? 'open' : s.key === 'harbour' ? 'in play' : ''}`.trim()
						: s.label
				)}
			</Tooltip.Root>
		{/each}

		{#if mates.length}
			<section class="mt-6" aria-labelledby="menu-mates">
				<h2 id="menu-mates" class="mono-label px-3 pb-2">Second mates</h2>
				<ul class="flex flex-col gap-0.5">
					{#each mates as m (m.id)}
						<li>
							<Tooltip.Root disabled={!rail}>
								<Tooltip.Trigger>
									{#snippet child({ props })}
										<a
											{...props}
											href="/second-mates#mate-{encodeURIComponent(m.id)}"
											class="nav-item min-h-13 gap-3 text-[0.95rem] leading-tight"
											aria-label="{m.id}, {m.where === 'remote'
												? `on ${m.host ?? 'another host'}`
												: 'on this computer'}: {mateDot(m)}"
											data-mate={m.id}
										>
											<span class="mate-avatar" data-hue={hueOf(m.id)} aria-hidden="true"
												>{initials(m.id)}</span
											>
											<span class="nav-label min-w-0 flex-1" aria-hidden="true">
												<span class="block truncate text-foreground">{m.id}</span>
												<span class="block truncate text-xs text-muted-foreground"
													>{m.where === 'remote'
														? (m.host ?? 'another host')
														: 'this computer'}</span
												>
											</span>
											<span
												class="mate-dot nav-label"
												data-online={m.health.online}
												data-tone={m.tone}
												aria-hidden="true"
											></span>
										</a>
									{/snippet}
								</Tooltip.Trigger>
								{@render tip(`${m.id} · ${mateDot(m)}`)}
							</Tooltip.Root>
						</li>
					{/each}
				</ul>
			</section>
		{/if}
	</nav>

	<div class="border-t p-3">
		<Tooltip.Root>
			<Tooltip.Trigger>
				{#snippet child({ props })}
					<button
						{...props}
						class="nav-item w-full"
						onclick={toggleRail}
						aria-label={rail ? 'Expand the menu' : 'Collapse the menu'}
						aria-expanded={!rail}
					>
						{#if rail}<PanelLeftOpen
								class="size-[1.1rem] shrink-0"
								strokeWidth={1.75}
							/>{:else}<PanelLeftClose class="size-[1.1rem] shrink-0" strokeWidth={1.75} />{/if}
						<span class="nav-label flex-1 text-left">Collapse</span>
						<kbd class="nav-label font-sans text-xs text-muted-foreground">{shortcut}</kbd>
					</button>
				{/snippet}
			</Tooltip.Trigger>
			{@render tip(`${rail ? 'Expand' : 'Collapse'} the menu · ${shortcut}`)}
		</Tooltip.Root>
	</div>
</aside>

<style>
	/* A plugin's SVG icon, as a stencil: it takes the menu's ink and its states. */
	.plugin-icon {
		mask: var(--icon) center / contain no-repeat;
	}
</style>
