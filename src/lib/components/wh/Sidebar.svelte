<script lang="ts">
	import { onMount, type Component } from 'svelte';
	import type { Section, SectionKey } from '$lib/nav';
	import * as Tooltip from '$lib/components/ui/tooltip';
	import {
		BookOpen,
		FolderGit2,
		MessageCircleQuestionMark,
		MessagesSquare,
		PanelLeftClose,
		PanelLeftOpen,
		Puzzle,
		Ship
	} from '@lucide/svelte';

	/**
	 * The left-hand menu under the header: the main sections (see mainSections), each with
	 * an icon, Decisions with its count of open questions, then the plugins' own pages.
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

	const icons: Record<SectionKey, Component> = {
		firstmate: MessagesSquare,
		harbour: Ship,
		projects: FolderGit2,
		decisions: MessageCircleQuestionMark,
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
	class="sidebar z-20 hidden shrink-0 flex-col border-r border-hair bg-panel md:flex {fill
		? 'min-h-0'
		: 'sticky top-14 h-[calc(100dvh-3.5rem)] self-start'}"
	aria-label="Menu"
>
	<nav
		class="no-scrollbar flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto px-2.5 pt-4 pb-3"
		aria-label="Main"
	>
		{#each sections as s, i (s.href)}
			{@const Icon = s.key ? icons[s.key] : Puzzle}
			{@const count = s.key === 'decisions' ? decisionsOpen : 0}
			{#if !s.key && sections[i - 1]?.key}<div
					class="mx-2.5 my-2 border-t border-hair"
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
							aria-label={count ? `${s.label}, ${count} open` : undefined}
						>
							<span class="relative shrink-0">
								<Icon class="size-[1.1rem]" strokeWidth={1.75} aria-hidden="true" />
								{#if count}<span
										class="nav-dot absolute -top-0.5 -right-0.5 size-2 rounded-full bg-sea ring-2 ring-panel"
										aria-hidden="true"
									></span>{/if}
							</span>
							<span class="nav-label flex-1 truncate">{s.label}</span>
							{#if count}<span
									class="nav-label tabular rounded-full bg-sea/15 px-1.5 text-xs leading-5 font-medium text-sea"
									aria-hidden="true">{count}</span
								>{/if}
						</a>
					{/snippet}
				</Tooltip.Trigger>
				{@render tip(count ? `${s.label} · ${count} open` : s.label)}
			</Tooltip.Root>
		{/each}
	</nav>

	<div class="border-t border-hair p-2.5">
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
