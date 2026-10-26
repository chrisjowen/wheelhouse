<script lang="ts">
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
	import { Button } from '$lib/components/ui/button';
	import { Bell, BellOff, BellRing } from '@lucide/svelte';
	import { ALERT_KINDS } from '$lib/bell';
	import { bell, kindLabel } from '$lib/client/bell.svelte';
	import { live } from '$lib/client/live.svelte';
	import { strike } from '$lib/client/chime';
	import { ago } from '$lib/format';
	import { alertTone, textClass } from '../tone';

	// The header's ship's bell: its recent alerts and this browser's settings.
	const muted = $derived(Object.values(bell.settings.kinds).every((on) => !on));
	const notifyNote = $derived(
		bell.permission === 'unsupported'
			? 'This browser cannot show notifications.'
			: bell.permission === 'denied'
				? 'Blocked in this browser’s site settings.'
				: 'When no Wheelhouse tab is in front.'
	);
</script>

<DropdownMenu.Root onOpenChange={(open) => open && bell.opened()}>
	<DropdownMenu.Trigger>
		{#snippet child({ props })}
			<Button
				{...props}
				variant="ghost"
				size="icon-sm"
				class="relative"
				aria-label={bell.unread
					? `Ship’s bell: ${bell.unread} new ${bell.unread === 1 ? 'alert' : 'alerts'}`
					: 'Ship’s bell'}
			>
				{#if muted}<BellOff />{:else if bell.unread}<BellRing />{:else}<Bell />{/if}
				{#if bell.unread}
					<span
						class="tabular absolute -top-0.5 -right-0.5 min-w-4 rounded-full bg-brass px-1 text-[0.6875rem] leading-4 font-semibold text-white dark:text-slate-950"
						aria-hidden="true">{bell.unread}</span
					>
				{/if}
			</Button>
		{/snippet}
	</DropdownMenu.Trigger>
	<DropdownMenu.Content align="end" class="w-80 max-w-[calc(100vw-2rem)] p-0">
		<div class="border-b border-b-brass/60 px-3 py-2.5">
			<p class="font-display text-base font-semibold">Ship’s bell</p>
			<p class="text-xs text-muted-foreground">Rings for the moments that need you.</p>
		</div>

		<DropdownMenu.Group class="p-1">
			<DropdownMenu.Label>Recent</DropdownMenu.Label>
			{#each bell.log as a (a.id)}
				{@const open = a.actions.find((x) => x.kind === 'open')}
				<DropdownMenu.Item
					class="flex-col items-start gap-0.5"
					onSelect={() => open && bell.act(open)}
				>
					<span class="flex w-full items-baseline justify-between gap-3 text-xs">
						<span class="font-medium {textClass[alertTone[a.kind]]}">{kindLabel(a.kind)}</span>
						<span class="text-muted-foreground">{ago(a.at, live.now)}</span>
					</span>
					<span class="line-clamp-1 font-medium">{a.title}</span>
					<span class="line-clamp-2 text-xs text-muted-foreground">{a.text}</span>
				</DropdownMenu.Item>
			{:else}
				<p class="px-2 pb-2 text-sm text-muted-foreground">Nothing has rung yet.</p>
			{/each}
		</DropdownMenu.Group>

		<DropdownMenu.Separator class="my-0" />
		<DropdownMenu.Group class="p-1">
			<DropdownMenu.Label>Ring for</DropdownMenu.Label>
			{#each ALERT_KINDS as k (k.kind)}
				<DropdownMenu.CheckboxItem
					checked={bell.settings.kinds[k.kind]}
					onCheckedChange={(on) => bell.setKind(k.kind, on)}
				>
					<span class="flex flex-col">
						<span>{k.label}</span>
						<span class="text-xs text-muted-foreground">{k.hint}</span>
					</span>
				</DropdownMenu.CheckboxItem>
			{/each}
		</DropdownMenu.Group>

		<DropdownMenu.Separator class="my-0" />
		<DropdownMenu.Group class="p-1">
			<DropdownMenu.Label>How</DropdownMenu.Label>
			<DropdownMenu.CheckboxItem
				checked={bell.settings.sound}
				onCheckedChange={(on) => bell.setSound(on)}
			>
				<span class="flex flex-col">
					<span>Bell sound</span>
					<span class="text-xs text-muted-foreground"
						>Two strokes of a ship’s bell. Off unless you turn it on.</span
					>
				</span>
			</DropdownMenu.CheckboxItem>
			<DropdownMenu.CheckboxItem
				checked={bell.settings.notify}
				disabled={bell.permission === 'unsupported' || bell.permission === 'denied'}
				onCheckedChange={(on) => void bell.setNotify(on)}
			>
				<span class="flex flex-col">
					<span>Browser notifications</span>
					<span class="text-xs text-muted-foreground">{notifyNote}</span>
				</span>
			</DropdownMenu.CheckboxItem>
			<DropdownMenu.Item closeOnSelect={false} onSelect={() => strike()}>
				<BellRing class="text-brass" />Ring the bell to hear it
			</DropdownMenu.Item>
		</DropdownMenu.Group>
	</DropdownMenu.Content>
</DropdownMenu.Root>
