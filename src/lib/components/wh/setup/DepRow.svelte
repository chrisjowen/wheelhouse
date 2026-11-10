<script lang="ts">
	import {
		CircleAlert,
		CircleCheck,
		CircleDashed,
		Copy,
		Check,
		ExternalLink,
		KeyRound,
		LoaderCircle
	} from '@lucide/svelte';
	import { Button } from '$lib/components/ui/button';
	import type { DepItem } from '$lib/setup';

	/**
	 * One tool in the setup wizard: a tick, or what is wrong and what to do.
	 * A one-click install shows its exact command and runs only after a second,
	 * explicit click; anything else is a command to copy into your own terminal.
	 */
	let {
		item,
		busy = false,
		dryRun = false,
		oninstall
	}: {
		item: DepItem;
		/** Something is installing (this or another): no second install starts. */
		busy?: boolean;
		dryRun?: boolean;
		oninstall?: () => Promise<{ ok: boolean; output?: string; error?: string }>;
	} = $props();

	let confirming = $state(false);
	let running = $state(false);
	let result = $state<{ ok: boolean; text: string } | null>(null);
	let copied = $state<string | null>(null);

	const ICON = {
		ok: { icon: CircleCheck, tone: 'text-success', label: 'Ready' },
		missing: { icon: CircleAlert, tone: 'text-danger', label: 'Missing' },
		outdated: { icon: CircleAlert, tone: 'text-warning', label: 'Outdated' },
		'needs-auth': { icon: KeyRound, tone: 'text-warning', label: 'Sign in' },
		optional: { icon: CircleDashed, tone: 'text-muted-foreground', label: 'Optional' },
		unknown: { icon: CircleDashed, tone: 'text-muted-foreground', label: 'Unknown' }
	} as const;
	const st = $derived(ICON[item.status]);

	async function run() {
		if (!oninstall) return;
		confirming = false;
		running = true;
		result = null;
		const r = await oninstall();
		running = false;
		result = { ok: r.ok, text: (r.ok ? r.output : r.error) ?? '' };
	}

	async function copy(cmd: string) {
		try {
			await navigator.clipboard.writeText(cmd);
			copied = cmd;
			setTimeout(() => (copied = null), 1500);
		} catch {
			// clipboard unavailable: the command stays selectable
		}
	}
</script>

<li class="px-4 py-3" data-tool={item.tool} data-status={item.status}>
	<div class="flex items-start gap-3">
		<st.icon class="mt-0.5 size-4 shrink-0 {st.tone}" aria-hidden="true" />
		<div class="min-w-0 flex-1">
			<p class="flex flex-wrap items-baseline gap-x-2 text-sm">
				<span class="font-mono font-medium">{item.tool}</span>
				<span class="text-muted-foreground">{item.what}</span>
				<span class="sr-only">{st.label}</span>
			</p>
			{#if item.detail}
				<p
					class="mt-0.5 text-xs break-words {item.status === 'ok'
						? 'text-muted-foreground'
						: st.tone}"
				>
					{item.detail}
				</p>
			{/if}

			{#if item.status !== 'ok'}
				{#if item.oneClick}
					<div class="mt-2">
						{#if confirming}
							<div
								class="rounded-md border border-sea/50 bg-background px-3 py-2 text-xs"
								role="group"
								aria-label="Confirm installing {item.tool}"
							>
								<p>Wheelhouse will run{dryRun ? ' (dry run: it only says so)' : ''}:</p>
								<code class="mt-1 block font-mono break-all text-foreground"
									>{item.oneClick.command}</code
								>
								<div class="mt-2 flex gap-2">
									<Button size="sm" onclick={run}>Run it</Button>
									<Button size="sm" variant="ghost" onclick={() => (confirming = false)}
										>Cancel</Button
									>
								</div>
							</div>
						{:else}
							<Button
								size="sm"
								variant="outline"
								disabled={busy || running}
								onclick={() => (confirming = true)}
							>
								{#if running}<LoaderCircle class="animate-spin" />Installing…{:else}Install {item.tool}…{/if}
							</Button>
						{/if}
					</div>
				{/if}
				{#each item.terminal as cmd (cmd)}
					<div class="mt-2">
						<p class="text-xs text-muted-foreground">
							{item.oneClick ? 'Or run in your own terminal:' : 'Run in your own terminal:'}
						</p>
						<span
							class="mt-1 flex items-start gap-2 rounded-md border bg-muted/60 px-2.5 py-1.5 text-xs"
						>
							<code class="min-w-0 flex-1 font-mono break-all text-foreground select-all"
								>{cmd}</code
							>
							<button
								class="flex shrink-0 cursor-pointer items-center gap-1 text-muted-foreground hover:text-foreground"
								onclick={() => copy(cmd)}
								aria-label="Copy {cmd}"
								>{#if copied === cmd}<Check class="size-3.5" />Copied{:else}<Copy
										class="size-3.5"
									/>Copy{/if}</button
							>
						</span>
					</div>
				{/each}
				{#if item.note}
					<p class="mt-1.5 max-w-prose text-xs text-muted-foreground">{item.note}</p>
				{/if}
				{#if item.link}
					<a
						class="mt-1.5 inline-flex items-center gap-1 text-xs text-sea hover:underline"
						href={item.link}
						target="_blank"
						rel="noreferrer">How to install {item.tool}<ExternalLink class="size-3" /></a
					>
				{/if}
			{/if}
			{#if result}
				<pre
					class="mt-2 max-h-48 overflow-auto rounded-md border px-2.5 py-1.5 font-mono text-[11px] whitespace-pre-wrap {result.ok
						? 'bg-muted/40 text-muted-foreground'
						: 'border-danger/40 bg-danger/5 text-danger'}">{result.text}</pre>
			{/if}
		</div>
	</div>
</li>
