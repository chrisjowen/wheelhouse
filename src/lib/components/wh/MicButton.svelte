<script lang="ts">
	import { onDestroy } from 'svelte';
	import { Mic, Square, X } from '@lucide/svelte';
	import { dictation, dictationKeys, type DictationTarget } from '$lib/voice/dictation.svelte';
	import { dictationEngine, problemText } from '$lib/voice/engine';

	/**
	 * Dictate into a text box. Click (or Ctrl/⌘+Shift+Space in the box, held
	 * down for push-to-talk) to start; the words appear in the box as you speak
	 * and are never sent for you. Click again to stop, Esc to cancel. The first
	 * time, when the engine sends audio off this machine, it says so and asks.
	 */
	let {
		field,
		target,
		label = 'Dictate',
		size = 'md',
		disabled = false,
		listening = $bindable(false)
	}: {
		/** The box the keyboard shortcut works in. */
		field: HTMLElement | null | undefined;
		/** Where the words go, made fresh for each dictation. */
		target: () => DictationTarget;
		label?: string;
		size?: 'md' | 'sm';
		disabled?: boolean;
		/** Out: whether this button is dictating, so the box can make room for the timer. */
		listening?: boolean;
	} = $props();

	const owner = {};
	$effect.pre(() => {
		listening = dictation.active(owner);
	});
	const stopping = $derived(listening && dictation.phase === 'stopping');
	const problem = $derived(dictation.owner === owner ? dictation.problem : null);
	let asking = $state(false);
	let now = $state(Date.now());
	let shortcut = $state('Ctrl+Shift+Space');

	const NOTED = 'wheelhouse.voice.noted';
	let notedHere = false;
	function noted() {
		if (notedHere) return true;
		try {
			return localStorage.getItem(NOTED) === '1';
		} catch {
			return false;
		}
	}

	function start() {
		if (disabled) return;
		const engine = dictationEngine();
		if (engine.supported() && engine.privacyNote && !noted()) {
			asking = true;
			return;
		}
		dictation.start(owner, target());
		field?.focus();
	}

	function agree() {
		notedHere = true;
		try {
			localStorage.setItem(NOTED, '1');
		} catch {
			/* asked again next visit */
		}
		asking = false;
		start();
	}

	function toggle() {
		if (listening) dictation.stop();
		else if (asking) asking = false;
		else start();
	}

	const elapsed = $derived.by(() => {
		const s = Math.max(0, Math.floor((now - dictation.startedAt) / 1000));
		return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
	});

	$effect(() => {
		if (/Mac|iPhone|iPad/.test(navigator.platform)) shortcut = '⌘⇧Space';
	});

	$effect(() => {
		if (!listening) return;
		now = Date.now();
		const t = setInterval(() => (now = Date.now()), 250);
		return () => clearInterval(t);
	});

	$effect(() => {
		if (field) return dictationKeys(field, owner, start);
	});

	// Esc cancels even when the focus has left the box, and closes the first-use note.
	$effect(() => {
		if (!listening && !asking) return;
		const onkey = (e: KeyboardEvent) => {
			if (e.key !== 'Escape' || e.defaultPrevented) return;
			e.preventDefault();
			if (listening) dictation.cancel();
			asking = false;
		};
		window.addEventListener('keydown', onkey);
		return () => window.removeEventListener('keydown', onkey);
	});

	onDestroy(() => {
		if (dictation.active(owner)) dictation.commit();
	});
</script>

<span class="relative inline-flex shrink-0 items-center gap-1.5">
	{#if listening}
		<span class="tabular text-xs text-muted-foreground" data-dictation-time
			>{stopping ? 'Finishing…' : elapsed}</span
		>
	{/if}
	<button
		type="button"
		aria-label={listening ? 'Stop dictating' : label}
		aria-pressed={listening}
		title={listening
			? 'Stop dictating · Esc cancels'
			: `${label} (${shortcut}; hold for push-to-talk)`}
		{disabled}
		onmousedown={(e) => e.preventDefault()}
		onclick={toggle}
		data-dictating={listening ? '' : undefined}
		class="mic flex shrink-0 cursor-pointer items-center justify-center rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-30 {size ===
		'md'
			? 'size-9'
			: 'size-7'} {listening
			? 'bg-danger/10 text-danger'
			: 'text-muted-foreground hover:bg-muted hover:text-foreground'}"
	>
		{#if listening}
			<Square class={size === 'md' ? 'size-3.5 fill-current' : 'size-3 fill-current'} />
		{:else}
			<Mic class={size === 'md' ? 'size-4.5' : 'size-4'} />
		{/if}
	</button>
	<span class="sr-only" aria-live="polite">{listening ? 'Listening' : ''}</span>

	{#if asking}
		<div
			class="absolute right-0 bottom-full z-30 mb-2 w-72 rounded-md border bg-popover p-3 text-left text-xs leading-relaxed text-popover-foreground shadow-md"
			role="dialog"
			aria-label="Before you dictate"
			data-dictation-note
		>
			<p>{dictationEngine().privacyNote}</p>
			<p class="mt-1.5 text-muted-foreground">
				Words appear in the box for you to check; nothing is sent until you send it.
			</p>
			<div class="mt-2.5 flex justify-end gap-2">
				<button
					type="button"
					class="rounded-md px-2 py-1 text-muted-foreground hover:bg-muted hover:text-foreground"
					onclick={() => (asking = false)}>Not now</button
				>
				<button
					type="button"
					class="rounded-md bg-primary px-2.5 py-1 font-medium text-primary-foreground"
					onclick={agree}>Start dictating</button
				>
			</div>
		</div>
	{:else if problem}
		<div
			class="absolute right-0 bottom-full z-30 mb-2 flex w-72 items-start gap-2 rounded-md border bg-popover p-3 text-left text-xs leading-relaxed text-popover-foreground shadow-md"
			role="alert"
			data-dictation-problem
		>
			<p class="min-w-0 flex-1">{problemText[problem]}</p>
			<button
				type="button"
				class="-m-1 rounded-sm p-1 text-muted-foreground hover:text-foreground"
				aria-label="Dismiss"
				onclick={() => dictation.dismiss()}><X class="size-3.5" /></button
			>
		</div>
	{/if}
</span>

<style>
	.mic[data-dictating] {
		animation: mic-pulse 1.6s ease-out infinite;
	}
	@keyframes mic-pulse {
		0% {
			box-shadow: 0 0 0 0 color-mix(in oklab, var(--danger) 35%, transparent);
		}
		100% {
			box-shadow: 0 0 0 0.55rem color-mix(in oklab, var(--danger) 0%, transparent);
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.mic[data-dictating] {
			animation: none;
			box-shadow: 0 0 0 2px color-mix(in oklab, var(--danger) 40%, transparent);
		}
	}
</style>
