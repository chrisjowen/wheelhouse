<script lang="ts">
	/**
	 * The form a decision is answered with in the chat (lib/decisionform.ts):
	 * two plain answers as one-tap buttons, options picked and then decided,
	 * the card's own calls (several, or written), or a written answer. Every
	 * form also takes an answer in the captain's own words (Other; `other`
	 * opens it). A note can go with any of them. The answer is sent by the
	 * parent (onAnswer), through the inbox or as a chat message, never to a
	 * worker directly. Once answered (`decided`), it shows what was decided
	 * instead of its controls; once dismissed (`dismissed`), that it was.
	 * `onDismiss` adds Dismiss, for a form that is not a tracked decision (a
	 * card has its own).
	 */
	import { Check, CircleCheck, CircleX, PenLine, X } from '@lucide/svelte';
	import type { DecisionForm, FormAnswer } from '$lib/decisionform';
	import { DECIDED_MAX } from '$lib/decisionform';
	import DismissPicker from '$lib/components/wh/inbox/DismissPicker.svelte';
	import {
		NOTE_MAX,
		WRITTEN_MAX,
		callName,
		callRef,
		resolvePicks,
		unpicked,
		type Picks
	} from '$lib/inbox';

	let {
		form,
		name,
		canAnswer = true,
		decided = null,
		dismissed = null,
		other = $bindable(false),
		onAnswer,
		onDismiss
	}: {
		form: DecisionForm;
		/** Unique per card, for the radio groups. */
		name: string;
		canAnswer?: boolean;
		/** The words decided, once answered: shown in place of the controls. */
		decided?: string | null;
		/** Dismissed without an answer: the reason ('' for none), shown in place of the controls. */
		dismissed?: string | null;
		/** The captain's own answer is open (Other). */
		other?: boolean;
		onAnswer: (answer: FormAnswer, note: string | null) => void;
		onDismiss?: (reason: string | null) => void;
	} = $props();

	let picked = $state<string | null>(null);
	let picks = $state<Picks>({});
	let written = $state('');
	let note = $state('');
	let noting = $state(false);
	let own = $state('');
	let dismissing = $state(false);
	const OTHER = 'other';

	const options = $derived(form.kind === 'buttons' || form.kind === 'choice' ? form.options : []);
	const chosen = $derived(
		other
			? null
			: (options.find((o) => o.id === picked) ?? options.find((o) => o.recommended) ?? null)
	);
	const done = $derived(decided !== null || dismissed !== null);
	const sendOwn = () => {
		const t = own.trim();
		if (t) send({ choice: 'approve', picks: null, decided: t.slice(0, DECIDED_MAX), other: true });
	};
	const missing = $derived(form.kind === 'picks' ? unpicked(form.choices, picks) : []);
	const send = (a: FormAnswer) => onAnswer(a, note.trim() || null);
	const inRow = (call: { options: { label: string; detail: string | null }[] }) =>
		call.options.every((o) => !o.detail && o.label.length <= 28);
	const btn =
		'inline-flex min-h-10 cursor-pointer items-center gap-1.5 rounded-md border px-3 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 sm:min-h-9 max-md:min-h-12 max-md:w-full max-md:justify-center max-md:text-base';
	const primary = 'border-sea bg-sea text-on-accent hover:bg-sea/90';
</script>

<div class="mt-3" data-decision-form={form.kind} data-form-from={form.from}>
	{#if form.prompt}<p class="text-sm leading-snug font-medium">{form.prompt}</p>{/if}

	{#if decided !== null}
		<p class="mt-2 flex items-start gap-1.5 text-sm leading-snug" data-decided>
			<CircleCheck class="mt-0.5 size-3.5 shrink-0 text-success" aria-hidden="true" /><span
				>You decided <span class="font-semibold">{decided}</span></span
			>
		</p>
	{:else if dismissed !== null}
		<p class="mt-2 flex items-start gap-1.5 text-sm leading-snug" data-dismissed>
			<CircleX class="mt-0.5 size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" /><span
				>You dismissed it{dismissed ? `: ${dismissed}` : ''}</span
			>
		</p>
	{:else if form.kind === 'buttons'}
		<div
			class="mt-2 flex flex-wrap items-center gap-1.5 max-md:flex-col max-md:items-stretch max-md:gap-2"
			role="group"
			aria-label="Answer"
		>
			{#each form.options as o (o.id)}
				<button
					class="{btn} {o.recommended ? primary : 'bg-background hover:bg-accent'}"
					disabled={!canAnswer}
					onclick={() => send(o.answer)}
					data-option={o.id}
					>{o.label}{#if o.recommended}<span class="text-xs font-normal opacity-80"
							>· recommended</span
						>{/if}</button
				>
			{/each}
			<button
				class="{btn} border-dashed bg-background text-muted-foreground hover:bg-accent hover:text-foreground"
				disabled={!canAnswer}
				aria-expanded={other}
				onclick={() => (other = !other)}
				data-other><PenLine class="size-3.5" aria-hidden="true" />Other…</button
			>
		</div>
		{#if other}{@render ownAnswer()}{/if}
	{:else if form.kind === 'choice'}
		<div
			class="mt-2 flex flex-col gap-1.5 max-md:gap-2"
			role="radiogroup"
			aria-label={form.prompt ?? 'Options'}
		>
			{#each form.options as o (o.id)}
				<label
					class="flex min-w-0 cursor-pointer items-start gap-2 rounded-md border px-2.5 py-1.5 text-sm transition-colors hover:bg-accent has-[:checked]:border-sea has-[:checked]:bg-sea/5 has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-60 max-md:min-h-12 max-md:items-center max-md:gap-3 max-md:rounded-lg max-md:px-3.5 max-md:py-2.5 max-md:text-base"
				>
					<input
						type="radio"
						name="form-{name}"
						value={o.id}
						checked={chosen?.id === o.id}
						disabled={!canAnswer}
						onchange={() => {
							picked = o.id;
							other = false;
						}}
						class="mt-[0.2rem] shrink-0 accent-sea max-md:mt-0 max-md:size-5"
					/>
					<span class="min-w-0 leading-snug"
						><span class="font-semibold">{o.label}</span>{#if o.detail}<span
								class="text-foreground/85">{` · ${o.detail}`}</span
							>{/if}{#if o.recommended}<span
								class="ml-1.5 text-xs font-medium whitespace-nowrap text-brass">Recommended</span
							>{/if}</span
					>
				</label>
			{/each}
			<label
				class="flex min-w-0 cursor-pointer items-start gap-2 rounded-md border border-dashed px-2.5 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-accent has-[:checked]:border-sea has-[:checked]:bg-sea/5 has-[:checked]:text-foreground has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-60 max-md:min-h-12 max-md:items-center max-md:gap-3 max-md:rounded-lg max-md:px-3.5 max-md:py-2.5 max-md:text-base"
				data-other
			>
				<input
					type="radio"
					name="form-{name}"
					value={OTHER}
					checked={other}
					disabled={!canAnswer}
					onchange={() => (other = true)}
					class="mt-[0.2rem] shrink-0 accent-sea max-md:mt-0 max-md:size-5"
				/>
				<span class="inline-flex min-w-0 items-center gap-1 leading-snug"
					><PenLine class="size-3.5 shrink-0" aria-hidden="true" />Other: write your own answer</span
				>
			</label>
		</div>
		{#if other}
			<textarea
				bind:value={own}
				rows="2"
				maxlength={DECIDED_MAX}
				disabled={!canAnswer}
				placeholder="Your own answer"
				aria-label="Your own answer"
				class="mt-2 block field-sizing-content max-h-40 min-h-12 w-full resize-none rounded-md border border-input bg-background px-2.5 py-1.5 text-sm placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none max-md:text-base"
				data-other-text></textarea>
		{/if}
		<div class="mt-2.5">
			<button
				class="{btn} {primary}"
				disabled={!canAnswer || (other ? !own.trim() : !chosen)}
				onclick={() => (other ? sendOwn() : chosen && send(chosen.answer))}
				data-decide
				><Check class="size-3.5" aria-hidden="true" />{other
					? 'Send your answer'
					: `Decide${chosen ? `: ${chosen.label}` : ''}`}</button
			>
		</div>
	{:else if form.kind === 'picks'}
		{@const all = resolvePicks(form.choices, picks)}
		<div class="mt-2 flex flex-col gap-3" role="group" aria-label="Your picks">
			{#each form.choices.calls as call (call.id)}
				<fieldset class="min-w-0">
					<legend class="text-sm leading-snug font-medium">
						{#if call.number !== null}<span class="mr-1 text-muted-foreground tabular-nums"
								>{call.number}.</span
							>{/if}{call.prompt ?? 'Pick one'}{#if !call.required}<span
								class="ml-1 font-normal text-muted-foreground"
							>
								· optional</span
							>{/if}
					</legend>
					{#if call.options.length}
						<div
							class="mt-1.5 flex gap-1.5 max-md:flex-col max-md:gap-2 {inRow(call)
								? 'flex-wrap'
								: 'flex-col'}"
						>
							{#each call.options as o (o.id)}
								<label
									class="flex min-w-0 cursor-pointer items-start gap-2 rounded-md border px-2.5 py-1.5 text-sm transition-colors hover:bg-accent has-[:checked]:border-sea has-[:checked]:bg-sea/5 has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-60 max-md:min-h-12 max-md:items-center max-md:gap-3 max-md:rounded-lg max-md:px-3.5 max-md:py-2.5 max-md:text-base"
								>
									<input
										type="radio"
										name="pick-{name}-{call.id}"
										value={o.id}
										checked={all[call.id] === o.id}
										disabled={!canAnswer}
										onchange={() => (picks = { ...picks, [call.id]: o.id })}
										class="mt-[0.2rem] shrink-0 accent-sea max-md:mt-0 max-md:size-5"
									/>
									<span class="min-w-0 leading-snug"
										>{#if o.detail}<span class="font-semibold">{o.label}</span><span
												class="text-foreground/85">{` · ${o.detail}`}</span
											>{:else}{o.label}{/if}{#if o.recommended}<span
												class="ml-1.5 text-xs font-medium whitespace-nowrap text-brass"
												>Recommended</span
											>{/if}</span
									>
								</label>
							{/each}
						</div>
					{:else}
						<input
							type="text"
							value={picks[call.id] ?? ''}
							maxlength={WRITTEN_MAX}
							disabled={!canAnswer}
							placeholder="Your answer (optional)"
							aria-label="Your answer to {callName(call) || 'this call'}"
							oninput={(e) => (picks = { ...picks, [call.id]: e.currentTarget.value })}
							class="mt-1.5 block h-9 w-full rounded-md border border-input bg-background px-2.5 text-sm placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none max-md:h-12 max-md:text-base"
						/>
					{/if}
				</fieldset>
			{/each}
		</div>
		<div class="mt-2.5">
			<button
				class="{btn} {primary}"
				disabled={!canAnswer || missing.length > 0}
				onclick={() => send({ choice: 'approve', picks, decided: null })}
				data-decide><Check class="size-3.5" aria-hidden="true" />Decide</button
			>
			<button
				class="{btn} border-dashed bg-background text-muted-foreground hover:bg-accent hover:text-foreground"
				disabled={!canAnswer}
				aria-expanded={other}
				onclick={() => (other = !other)}
				data-other><PenLine class="size-3.5" aria-hidden="true" />Other…</button
			>
			{#if missing.length}
				<p class="mt-1.5 text-xs text-muted-foreground">
					Pick one for {missing.map(callRef).join(', ')} to decide.
				</p>
			{/if}
		</div>
		{#if other}{@render ownAnswer()}{/if}
	{:else}
		<form
			class="mt-2 flex items-end gap-2 rounded-lg border border-input bg-background px-2.5 py-1.5 focus-within:ring-2 focus-within:ring-ring"
			onsubmit={(e) => {
				e.preventDefault();
				const t = written.trim();
				if (t) send({ choice: 'approve', picks: null, decided: t });
			}}
		>
			<textarea
				bind:value={written}
				rows="1"
				maxlength={DECIDED_MAX}
				disabled={!canAnswer}
				placeholder="Your answer"
				aria-label={form.prompt ?? 'Your answer'}
				class="field-sizing-content max-h-32 min-h-7 flex-1 resize-none bg-transparent py-0.5 text-sm placeholder:text-muted-foreground focus:outline-none max-md:self-center max-md:text-base"
			></textarea>
			<button
				type="submit"
				class="inline-flex h-7 shrink-0 cursor-pointer items-center gap-1 rounded-md bg-sea px-2.5 text-sm font-medium text-on-accent disabled:cursor-not-allowed disabled:opacity-40 max-md:h-11 max-md:px-3.5"
				disabled={!canAnswer || !written.trim()}
				data-decide><Check class="size-3.5" aria-hidden="true" />Decide</button
			>
		</form>
	{/if}

	{#if done}
		<!-- Answered or dismissed: nothing more to add here. -->
	{:else if noting}
		<label class="mt-2 block">
			<span class="sr-only">Note for Firstmate (optional)</span>
			<textarea
				bind:value={note}
				rows="1"
				maxlength={NOTE_MAX}
				placeholder="A note to go with your answer (optional)"
				class="block field-sizing-content max-h-40 min-h-9 w-full resize-none rounded-md border border-input bg-background px-2.5 py-1.5 text-sm placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none max-md:text-base"
			></textarea>
		</label>
	{:else if canAnswer}
		<button
			class="mt-1.5 inline-flex cursor-pointer items-center gap-1 rounded px-1 text-xs text-muted-foreground hover:text-foreground max-md:min-h-11 max-md:text-sm"
			onclick={() => (noting = true)}
			><PenLine class="size-3" aria-hidden="true" />Add a note</button
		>
	{/if}
	{#if onDismiss && !done && canAnswer}
		{#if dismissing}
			<DismissPicker
				{name}
				onDismiss={(reason) => {
					dismissing = false;
					onDismiss(reason);
				}}
				onCancel={() => (dismissing = false)}
			/>
		{:else}
			<button
				class="mt-1.5 ml-1 inline-flex cursor-pointer items-center gap-1 rounded px-1 text-xs text-muted-foreground hover:text-foreground max-md:min-h-11 max-md:text-sm"
				onclick={() => (dismissing = true)}
				data-dismiss><X class="size-3" aria-hidden="true" />Dismiss</button
			>
		{/if}
	{/if}
</div>

{#snippet ownAnswer()}
	<form
		class="mt-2 flex items-end gap-2 rounded-lg border border-input bg-background px-2.5 py-1.5 focus-within:ring-2 focus-within:ring-ring"
		onsubmit={(e) => {
			e.preventDefault();
			sendOwn();
		}}
	>
		<textarea
			bind:value={own}
			rows="1"
			maxlength={DECIDED_MAX}
			disabled={!canAnswer}
			placeholder="Your own answer"
			aria-label="Your own answer"
			class="field-sizing-content max-h-32 min-h-7 flex-1 resize-none bg-transparent py-0.5 text-sm placeholder:text-muted-foreground focus:outline-none max-md:self-center max-md:text-base"
			data-other-text></textarea>
		<button
			type="submit"
			class="inline-flex h-7 shrink-0 cursor-pointer items-center gap-1 rounded-md bg-sea px-2.5 text-sm font-medium text-on-accent disabled:cursor-not-allowed disabled:opacity-40 max-md:h-11 max-md:px-3.5"
			disabled={!canAnswer || !own.trim()}
			data-other-send><Check class="size-3.5" aria-hidden="true" />Send</button
		>
	</form>
{/snippet}
