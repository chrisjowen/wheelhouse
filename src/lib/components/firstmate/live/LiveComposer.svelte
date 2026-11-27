<script lang="ts">
	import { ArrowUp, FilePlus, Hand, Mic, MicOff, Plus, Telescope, X } from '@lucide/svelte';
	import { liveCall } from '$lib/client/livecall.svelte';
	import { attachments } from '$lib/client/attach.svelte';
	import { expandAttachment } from '$lib/chat/attachments';
	import LiveDocPicker from '$lib/components/wh/docs/LiveDocPicker.svelte';
	import Switch from '$lib/components/wh/Switch.svelte';
	import { spaceToTalk } from '$lib/voice/spacehold';

	/**
	 * Live mode's box, in a large rounded frame: type to the discussion crew,
	 * with + to attach files (uploaded as the chat's are and named in what is
	 * sent, so the crew can open them), documents (reports, library documents,
	 * prototypes) brought in in full or by title, and what is typed sent off
	 * as a question for a scout instead. Voice is off when a call starts; its
	 * switch turns talking out loud on. With voice on: on a keyboard, hold
	 * Space for two seconds with the pointer over the talk (`talkArea`; see
	 * spaceToTalk), or the mic button; on a phone a wide hold-to-talk bar sits
	 * under the thumb (let go to send, slide away to cancel) beside a
	 * Hands-free switch for always-on listening. The line above then shows
	 * what is being heard as it is heard. `big`: the empty screen's box.
	 */

	let {
		talkArea = null,
		big = false,
		token
	}: { talkArea?: HTMLElement | null; big?: boolean; token: string } = $props();

	let text = $state('');
	let picking = $state(false);
	let away = $state(false);
	let touch = $state(false);
	let box = $state<HTMLTextAreaElement | null>(null);
	let files = $state<HTMLInputElement | null>(null);
	const voice = $derived(liveCall.voiceOn);
	const ptt = $derived(liveCall.prefs.input === 'ptt');
	const open = $derived(
		liveCall.on && liveCall.state !== 'starting' && liveCall.state !== 'ending'
	);
	const sendable = $derived(open && !attachments.uploading && (!!text.trim() || attachments.ready));
	const editable = (t: EventTarget | null) =>
		t instanceof HTMLElement &&
		(t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName));

	/** Put the cursor in the box, at the end of what is there. */
	export function focus(words?: string) {
		if (words !== undefined) text = words;
		box?.focus();
		const n = box?.value.length ?? 0;
		box?.setSelectionRange(n, n);
	}

	$effect(() => {
		if (!talkArea) return;
		return spaceToTalk(talkArea, {
			enabled: () => liveCall.on && liveCall.voiceOn && liveCall.prefs.input === 'ptt',
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

	function submit(e?: Event) {
		e?.preventDefault();
		if (!sendable) return;
		const body = [text.trim(), ...attachments.take().map(expandAttachment)]
			.filter(Boolean)
			.join('\n');
		liveCall.type(body);
		text = '';
	}
	function scout() {
		if (!text.trim() || !open) return;
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
		const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
		const reach = 48;
		away =
			e.clientX < r.left - reach ||
			e.clientX > r.right + reach ||
			e.clientY < r.top - reach * 1.5 ||
			e.clientY > r.bottom + reach;
	}
	function up() {
		if (away) liveCall.cancel();
		else void liveCall.release();
		away = false;
	}
	const handsFree = () => liveCall.setPrefs({ input: ptt ? 'always' : 'ptt' });
	const round =
		'grid size-8 shrink-0 cursor-pointer place-items-center rounded-full border text-muted-foreground hover:bg-muted hover:text-foreground disabled:cursor-default disabled:opacity-40 max-md:size-10';
</script>

<svelte:window
	onkeydown={(e) => {
		if (!liveCall.on || !voice || editable(e.target) || e.metaKey || e.ctrlKey || e.altKey) return;
		if ((e.key === 'm' || e.key === 'M') && !ptt) liveCall.toggleMute();
	}}
/>

{#snippet holdButton(wide: boolean)}
	<button
		type="button"
		class="inline-flex shrink-0 cursor-pointer touch-none items-center justify-center gap-2 rounded-full border font-semibold transition select-none [-webkit-touch-callout:none] {wide
			? 'h-14 flex-1 text-base'
			: 'h-8 px-3 text-sm'} {liveCall.pressing
			? away
				? 'border-danger bg-danger/15 text-danger'
				: 'scale-[0.98] border-sea bg-sea text-on-accent'
			: 'border-sea/55 bg-sea/10 text-sea'}"
		aria-label="Hold to talk"
		aria-pressed={liveCall.pressing}
		disabled={!open}
		oncontextmenu={(e) => e.preventDefault()}
		onpointerdown={down}
		onpointermove={move}
		onpointerup={up}
		onpointercancel={() => liveCall.cancel()}
	>
		<Mic class={wide ? 'size-5' : 'size-4'} aria-hidden="true" />
		{liveCall.pressing ? (away ? 'Let go to cancel' : 'Let go to send') : 'Hold to talk'}
	</button>
{/snippet}

{#snippet muteButton(wide: boolean)}
	<button
		type="button"
		class="inline-flex shrink-0 cursor-pointer items-center justify-center gap-2 rounded-full border font-semibold {wide
			? 'h-14 flex-1 text-base'
			: 'h-8 px-3 text-sm'} {liveCall.state === 'muted'
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
	{#if voice}
		<p
			class="flex h-6 items-center gap-2 overflow-hidden px-1 pb-1 text-sm whitespace-nowrap"
			aria-live="polite"
			data-live-heard
		>
			<span
				class="shrink-0 text-[0.95rem] font-semibold tracking-[0.08em] [font-variant-caps:all-small-caps] {liveCall.state ===
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
					{liveCall.heard.settled}
					<span class="text-muted-foreground">{liveCall.heard.forming}</span>
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
					type="button"
					class="inline-flex h-14 shrink-0 cursor-pointer flex-col items-center justify-center rounded-2xl border px-3 text-[0.7rem] font-semibold {ptt
						? 'text-muted-foreground'
						: 'border-teal/55 bg-teal/10 text-teal'}"
					aria-pressed={!ptt}
					aria-label="Hands-free"
					onclick={handsFree}><Hand class="mb-0.5 size-4" aria-hidden="true" />Hands-free</button
				>
			</div>
		{/if}
	{/if}
	<form
		class="rounded-2xl border bg-card px-4 pt-3 pb-2.5 shadow-sm focus-within:border-gold/60 dark:bg-card/70 dark:backdrop-blur"
		onsubmit={submit}
	>
		<textarea
			bind:this={box}
			bind:value={text}
			rows={big ? 2 : 1}
			class="block max-h-40 w-full resize-none bg-transparent text-[0.95rem] leading-relaxed outline-none placeholder:text-muted-foreground max-md:text-base"
			placeholder={liveCall.state === 'starting'
				? 'The crew is reading the fleet…'
				: voice && !touch && ptt
					? 'Type to the crew, or hold Space for 2 s to talk'
					: 'Tell the crew what’s on your mind…'}
			aria-label="Message the discussion crew"
			enterkeyhint="send"
			disabled={!liveCall.on}
			onkeydown={(e) => {
				if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) submit(e);
			}}></textarea>
		{#if attachments.drafts.length}
			<ul class="mt-2 flex flex-wrap gap-1.5" aria-label="Attached files">
				{#each attachments.drafts as d (d.id)}
					<li
						class="flex max-w-56 items-center gap-1 rounded-full border bg-background px-2 py-0.5 text-xs {d.state ===
						'failed'
							? 'border-danger/50 text-danger'
							: 'text-muted-foreground'}"
						title={d.error ?? d.name}
					>
						<span class="truncate"
							>{d.name}{d.state === 'uploading' ? ` · ${Math.round(d.progress * 100)}%` : ''}</span
						>
						<button
							type="button"
							class="grid size-4 shrink-0 cursor-pointer place-items-center rounded-full hover:bg-muted"
							aria-label="Remove {d.name}"
							onclick={() => attachments.remove(d.id)}><X class="size-3" /></button
						>
					</li>
				{/each}
			</ul>
		{/if}
		<div class="mt-1.5 flex items-center gap-2">
			<button
				type="button"
				class={round}
				aria-label="Attach files"
				title="Attach files for the crew to read"
				disabled={!liveCall.on}
				onclick={() => files?.click()}
				data-live-attach><Plus class="size-4" aria-hidden="true" /></button
			>
			<input
				bind:this={files}
				type="file"
				multiple
				class="hidden"
				data-live-files
				onchange={(e) => {
					const picked = [...(e.currentTarget.files ?? [])];
					if (picked.length) attachments.add(picked, token);
					e.currentTarget.value = '';
				}}
			/>
			<button
				type="button"
				class={round}
				aria-label="Add documents to the discussion"
				title="Add documents: attach in full, or list by title"
				disabled={!open}
				onclick={() => (picking = true)}
				data-live-add-doc><FilePlus class="size-4" aria-hidden="true" /></button
			>
			<button
				type="button"
				class={round}
				aria-label="Send a scout on this question"
				title="Send a scout on this question"
				disabled={!open || !text.trim()}
				onclick={scout}><Telescope class="size-4" aria-hidden="true" /></button
			>
			<span class="ml-auto"></span>
			{#if voice && !touch}
				{#if ptt}{@render holdButton(false)}{:else}{@render muteButton(false)}{/if}
			{/if}
			<span
				class="flex shrink-0 items-center gap-2 rounded-full border py-1 pr-1.5 pl-2.5 text-sm font-medium max-md:py-1.5 {voice
					? 'border-sea/50 text-sea'
					: 'text-muted-foreground'}"
				title={voice
					? 'Voice on: the crew speaks, and hears you'
					: 'Voice off: type, and read the replies. Turn it on to talk out loud.'}
				data-live-voice={voice ? 'on' : 'off'}
				>{#if voice}<Mic class="size-3.5" aria-hidden="true" />{:else}<MicOff
						class="size-3.5"
						aria-hidden="true"
					/>{/if}<span aria-hidden="true">Voice</span><Switch
					checked={voice}
					label="Voice"
					disabled={!open}
					onchange={(on) => void liveCall.setVoice(on)}
				/></span
			>
			<button
				type="submit"
				class="grid size-9 shrink-0 cursor-pointer place-items-center rounded-full bg-gold text-background transition-opacity disabled:cursor-default disabled:opacity-35 max-md:size-10"
				disabled={!sendable}
				aria-label="Send to the crew"><ArrowUp class="size-4" aria-hidden="true" /></button
			>
		</div>
	</form>
</div>

<LiveDocPicker bind:open={picking} />
