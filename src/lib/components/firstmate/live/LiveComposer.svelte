<script lang="ts">
	import { ArrowUp, FilePlus, Hand, Mic, MicOff, Telescope } from '@lucide/svelte';
	import { liveCall } from '$lib/client/livecall.svelte';
	import LiveDocPicker from '$lib/components/wh/docs/LiveDocPicker.svelte';
	import { spaceToTalk } from '$lib/voice/spacehold';

	/**
	 * The chat's composer while Live mode is on: talk or type to the discussion
	 * crew. On a keyboard, hold Space for two seconds with the pointer over the
	 * chat (`talkArea`; see spaceToTalk), or the mic button; on a phone, where there
	 * is no Space, a wide hold-to-talk bar sits under the thumb (let go to send,
	 * slide away to cancel) beside a Hands-free switch for always-on listening.
	 * The line above shows what is being heard as it is heard, in a fixed height
	 * so nothing below it moves. Messages to Firstmate wait until the call ends.
	 * What is typed can instead go off as a question for a scout. Documents
	 * (reports, library documents, prototypes) can be brought in, attached in
	 * full or listed by title.
	 */

	let { talkArea = null }: { talkArea?: HTMLElement | null } = $props();

	let text = $state('');
	let picking = $state(false);
	let away = $state(false);
	let touch = $state(false);
	const ptt = $derived(liveCall.prefs.input === 'ptt');
	const editable = (t: EventTarget | null) =>
		t instanceof HTMLElement &&
		(t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName));

	$effect(() => {
		if (!talkArea) return;
		return spaceToTalk(talkArea, {
			enabled: () => liveCall.on && liveCall.prefs.input === 'ptt',
			start: () => liveCall.press(),
			stop: () => void liveCall.release()
		});
	});

	$effect(() => {
		const coarse = matchMedia('(pointer: coarse), (max-width: 640px)');
		touch = coarse.matches;
		const changed = () => (touch = coarse.matches);
		coarse.addEventListener('change', changed);
		return () => coarse.removeEventListener('change', changed);
	});

	function submit() {
		if (!text.trim()) return;
		liveCall.type(text);
		text = '';
	}
	function scout() {
		if (!text.trim()) return;
		liveCall.askScout(text);
		text = '';
	}

	/** Hold to talk with a finger or the mouse; sliding well away from the button cancels. */
	function down(e: PointerEvent) {
		e.preventDefault();
		(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
		away = false;
		liveCall.press();
	}
	function move(e: PointerEvent) {
		if (!liveCall.pressing) return;
		const box = (e.currentTarget as HTMLElement).getBoundingClientRect();
		const reach = 48;
		away =
			e.clientX < box.left - reach ||
			e.clientX > box.right + reach ||
			e.clientY < box.top - reach * 1.5 ||
			e.clientY > box.bottom + reach;
	}
	function up() {
		if (away) liveCall.cancel();
		else void liveCall.release();
		away = false;
	}
	const handsFree = () => liveCall.setPrefs({ input: ptt ? 'always' : 'ptt' });
</script>

<svelte:window
	onkeydown={(e) => {
		if (!liveCall.on || editable(e.target) || e.metaKey || e.ctrlKey || e.altKey) return;
		if ((e.key === 'm' || e.key === 'M') && !ptt) liveCall.toggleMute();
	}}
/>

{#snippet holdButton(big: boolean)}
	<button
		class="inline-flex shrink-0 cursor-pointer touch-none items-center justify-center gap-2 rounded-full border font-semibold transition select-none [-webkit-touch-callout:none] {big
			? 'h-14 flex-1 text-base'
			: 'h-9 px-3.5 text-sm'} {liveCall.pressing
			? away
				? 'border-danger bg-danger/15 text-danger'
				: 'scale-[0.98] border-sea bg-sea text-on-accent'
			: 'border-sea/55 bg-sea/10 text-sea'}"
		aria-label="Hold to talk"
		aria-pressed={liveCall.pressing}
		oncontextmenu={(e) => e.preventDefault()}
		onpointerdown={down}
		onpointermove={move}
		onpointerup={up}
		onpointercancel={() => liveCall.cancel()}
	>
		<Mic class={big ? 'size-5' : 'size-4'} aria-hidden="true" />
		{liveCall.pressing ? (away ? 'Let go to cancel' : 'Let go to send') : 'Hold to talk'}
	</button>
{/snippet}

{#snippet muteButton(big: boolean)}
	<button
		class="inline-flex shrink-0 cursor-pointer items-center justify-center gap-2 rounded-full border font-semibold {big
			? 'h-14 flex-1 text-base'
			: 'h-9 px-3.5 text-sm'} {liveCall.state === 'muted'
			? 'border-danger/55 bg-danger/10 text-danger'
			: 'border-teal/55 bg-teal/10 text-teal'}"
		aria-label={liveCall.state === 'muted' ? 'Unmute' : 'Mute'}
		onclick={() => liveCall.toggleMute()}
	>
		{#if liveCall.state === 'muted'}<MicOff class="size-4" aria-hidden="true" />Muted{:else}<Mic
				class="size-4"
				aria-hidden="true"
			/>Listening{/if}
	</button>
{/snippet}

<div data-live-composer>
	<p
		class="flex h-6 items-center gap-2 overflow-hidden px-1 pb-1 text-sm whitespace-nowrap"
		aria-live="polite"
	>
		<span
			class="shrink-0 font-mono text-[0.65rem] tracking-widest uppercase {liveCall.state ===
			'transcribing'
				? 'text-sea'
				: 'text-teal'}"
			>{liveCall.state === 'transcribing'
				? 'Transcribing'
				: liveCall.heard.settled || liveCall.heard.forming
					? 'Hearing'
					: ptt
						? 'Push to talk'
						: 'Hands-free'}</span
		>
		<span class="min-w-0 truncate">
			{#if liveCall.heard.settled || liveCall.heard.forming}
				{liveCall.heard.settled} <span class="text-muted-foreground">{liveCall.heard.forming}</span>
			{:else}
				<span class="text-muted-foreground"
					>{liveCall.problem ??
						(ptt
							? touch
								? 'Hold the button and talk; let go to send.'
								: 'Hold Space for 2 seconds and talk; let go to send.'
							: 'Talk any time; it sends when you pause.')}</span
				>
			{/if}
		</span>
	</p>
	{#if touch}
		<div class="mb-2 flex items-center gap-2">
			{#if ptt}{@render holdButton(true)}{:else}{@render muteButton(true)}{/if}
			<button
				class="inline-flex h-14 shrink-0 cursor-pointer flex-col items-center justify-center rounded-2xl border px-3 text-[0.7rem] font-semibold {ptt
					? 'text-muted-foreground'
					: 'border-teal/55 bg-teal/10 text-teal'}"
				aria-pressed={!ptt}
				aria-label="Hands-free"
				onclick={handsFree}><Hand class="mb-0.5 size-4" aria-hidden="true" />Hands-free</button
			>
		</div>
	{/if}
	<div class="flex items-center gap-2 rounded-xl border border-sea/45 bg-card p-1.5 pl-2">
		{#if !touch}
			{#if ptt}{@render holdButton(false)}{:else}{@render muteButton(false)}{/if}
		{/if}
		<input
			class="min-w-0 flex-1 bg-transparent px-2 text-base outline-none placeholder:text-muted-foreground sm:text-[0.95rem]"
			placeholder={touch
				? 'Or type to the crew'
				: ptt
					? 'Talk to the crew (hold Space for 2 s), or type here'
					: 'Type to the crew'}
			aria-label="Message the discussion crew"
			enterkeyhint="send"
			bind:value={text}
			onkeydown={(e) => {
				if (e.key === 'Enter') {
					e.preventDefault();
					submit();
				}
			}}
		/>
		<button
			class="flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-full border border-sea/45 text-sea hover:bg-sea/10"
			aria-label="Add documents to the discussion"
			title="Add documents: attach in full, or list by title"
			onclick={() => (picking = true)}
			data-live-add-doc><FilePlus class="size-4" /></button
		>
		<button
			class="flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-full border border-sea/45 text-sea hover:bg-sea/10 disabled:cursor-default disabled:opacity-40"
			aria-label="Send a scout on this question"
			title="Send a scout on this question"
			disabled={!text.trim()}
			onclick={scout}><Telescope class="size-4" /></button
		>
		<button
			class="flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-full bg-sea text-on-accent disabled:opacity-40"
			aria-label="Send to the crew"
			disabled={!text.trim()}
			onclick={submit}><ArrowUp class="size-4" /></button
		>
	</div>
</div>

<LiveDocPicker bind:open={picking} />
