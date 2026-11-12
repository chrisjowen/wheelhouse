<script lang="ts">
	import type { BarKey } from '$lib/terminalkeys';
	import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp } from '@lucide/svelte';

	/**
	 * The keys a phone's keyboard lacks, in a row under the terminal: Esc (to
	 * interrupt Claude Code), Tab, a sticky Ctrl, Ctrl+C and the arrows. A tap
	 * never takes focus, so the terminal keeps it and the phone's keyboard stays
	 * up; the keys work with the keyboard down too.
	 */
	let {
		ctrl,
		disabled = false,
		onkey,
		onctrl
	}: {
		/** Ctrl is armed for the next key. */
		ctrl: boolean;
		disabled?: boolean;
		onkey: (key: BarKey) => void;
		/** Ctrl was tapped: arm it, or disarm it if it was armed. */
		onctrl: () => void;
	} = $props();

	const keys: { key: BarKey; label: string; name: string }[] = [
		{ key: 'esc', label: 'Esc', name: 'Escape' },
		{ key: 'tab', label: 'Tab', name: 'Tab' }
	];
	const arrows = [
		{ key: 'left', icon: ArrowLeft, name: 'Left arrow' },
		{ key: 'up', icon: ArrowUp, name: 'Up arrow' },
		{ key: 'down', icon: ArrowDown, name: 'Down arrow' },
		{ key: 'right', icon: ArrowRight, name: 'Right arrow' }
	] as const;

	// Pressing a button would focus it and take focus (and the phone's keyboard) from the terminal.
	const keepFocus = (e: Event) => e.preventDefault();
	const base =
		'flex h-10 min-w-0 flex-1 cursor-pointer touch-manipulation items-center justify-center rounded-md font-mono text-xs select-none disabled:cursor-default disabled:opacity-40';
	const plain = `${base} bg-white/5 text-slate-300 active:bg-white/20`;
</script>

<div
	class="flex shrink-0 gap-1 border-t border-white/10 px-1.5 py-1.5"
	role="toolbar"
	aria-label="Terminal keys"
	data-terminal-keys
>
	{#each keys as k (k.key)}
		<button
			type="button"
			tabindex="-1"
			class={plain}
			aria-label={k.name}
			{disabled}
			onpointerdown={keepFocus}
			onmousedown={keepFocus}
			onclick={() => onkey(k.key)}>{k.label}</button
		>
	{/each}
	<button
		type="button"
		tabindex="-1"
		class="{base} {ctrl
			? 'bg-slate-300 text-console'
			: 'bg-white/5 text-slate-300 active:bg-white/20'}"
		aria-label="Control: applies to the next key"
		aria-pressed={ctrl}
		{disabled}
		onpointerdown={keepFocus}
		onmousedown={keepFocus}
		onclick={onctrl}>Ctrl</button
	>
	<button
		type="button"
		tabindex="-1"
		class={plain}
		aria-label="Control C"
		{disabled}
		onpointerdown={keepFocus}
		onmousedown={keepFocus}
		onclick={() => onkey('ctrl-c')}>^C</button
	>
	{#each arrows as a (a.key)}
		<button
			type="button"
			tabindex="-1"
			class={plain}
			aria-label={a.name}
			{disabled}
			onpointerdown={keepFocus}
			onmousedown={keepFocus}
			onclick={() => onkey(a.key)}><a.icon class="size-4" aria-hidden="true" /></button
		>
	{/each}
</div>
