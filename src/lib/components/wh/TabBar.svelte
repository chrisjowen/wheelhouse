<script lang="ts">
	/**
	 * Bottom tab bar for phones: Chat, Needs you, Harbour, Decisions, More.
	 * Hidden on desktop (md+). Padded for safe-area-inset-bottom.
	 * Uses pointer-coarse for touch-friendly 44px+ targets.
	 */
	import { page } from '$app/state';
	import { MessageCircle, Gauge, Anchor, Inbox, MoreHorizontal } from '@lucide/svelte';
	import { inbox } from '$lib/client/inbox.svelte';
	import { live } from '$lib/client/live.svelte';

	const decisionsOpen = $derived(inbox.open(live.now));

	// Active route matching for tabs
	const isActive = (href: string) => {
		const p = page.url.pathname;
		if (href === '/') return p === '/';
		if (href === '/inbox') return p === '/inbox' || p.startsWith('/inbox/');
		if (href === '/harbour') return p === '/harbour' || p.startsWith('/harbour') || p.startsWith('/projects') || p.startsWith('/tasks') || p.startsWith('/second-mates');
		if (href === '/more') return p === '/more' || p.startsWith('/more/') || p.startsWith('/settings') || p.startsWith('/headroom') || p.startsWith('/time') || p.startsWith('/decisions');
		return false;
	};
</script>

<nav
	class="md:hidden fixed bottom-0 left-0 right-0 z-40 border-t bg-nav/95 backdrop-blur supports-[backdrop-filter]:bg-nav/80"
	style:padding-bottom="env(safe-area-inset-bottom, 0px)"
	aria-label="Primary navigation"
>
	<div class="flex items-center justify-around h-14 px-1">
		<a
			href="/"
			class="flex flex-col items-center justify-center gap-0.5 min-w-[44px] min-h-[44px] rounded-lg {isActive('/') ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'}"
			aria-current={isActive('/') ? 'page' : undefined}
		>
			<MessageCircle class="size-5" aria-hidden="true" />
			<span class="text-[10px] font-medium tracking-[0.02em]">Chat</span>
		</a>

		<a
			href="/inbox"
			class="flex flex-col items-center justify-center gap-0.5 min-w-[44px] min-h-[44px] rounded-lg relative {isActive('/inbox') ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'}"
			aria-current={isActive('/inbox') ? 'page' : undefined}
		>
			<div class="relative">
				<Gauge class="size-5" aria-hidden="true" />
				{#if decisionsOpen > 0}
					<span
						class="absolute -top-0.5 -right-0.5 min-w-[14px] h-[14px] px-1 rounded-full bg-sea text-[9px] font-medium text-on-accent tabular-nums flex items-center justify-center"
						aria-label="{decisionsOpen} open"
					>
						{decisionsOpen > 9 ? '9+' : decisionsOpen}
					</span>
				{/if}
			</div>
			<span class="text-[10px] font-medium tracking-[0.02em]">Needs you</span>
		</a>

		<a
			href="/harbour"
			class="flex flex-col items-center justify-center gap-0.5 min-w-[44px] min-h-[44px] rounded-lg {isActive('/harbour') ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'}"
			aria-current={isActive('/harbour') ? 'page' : undefined}
		>
			<Anchor class="size-5" aria-hidden="true" />
			<span class="text-[10px] font-medium tracking-[0.02em]">Harbour</span>
		</a>

		<a
			href="/inbox"
			class="flex flex-col items-center justify-center gap-0.5 min-w-[44px] min-h-[44px] rounded-lg {isActive('/inbox') ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'}"
			aria-current={isActive('/inbox') ? 'page' : undefined}
		>
			<Inbox class="size-5" aria-hidden="true" />
			<span class="text-[10px] font-medium tracking-[0.02em]">Decisions</span>
		</a>

		<a
			href="/more"
			class="flex flex-col items-center justify-center gap-0.5 min-w-[44px] min-h-[44px] rounded-lg {isActive('/more') ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'}"
			aria-current={isActive('/more') ? 'page' : undefined}
		>
			<MoreHorizontal class="size-5" aria-hidden="true" />
			<span class="text-[10px] font-medium tracking-[0.02em]">More</span>
		</a>
	</div>
</nav>

<!-- Spacer to keep content above the tab bar on mobile -->
<div class="md:hidden h-14" style:height="calc(3.5rem + env(safe-area-inset-bottom, 0px))"></div>
