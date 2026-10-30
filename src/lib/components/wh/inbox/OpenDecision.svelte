<script lang="ts">
	/**
	 * One decision box answered outside the Decisions page (On deck, the task
	 * page): the same DecisionCard, keeping its own note, picks and evidence
	 * toggle, and sending through the inbox. An answered card leaves at once;
	 * one whose answer was not taken stays with the reason.
	 */
	import { page } from '$app/state';
	import { inbox } from '$lib/client/inbox.svelte';
	import type { InboxAction, InboxCard, InboxView, Picks } from '$lib/inbox';
	import DecisionCard from './DecisionCard.svelte';

	let {
		card,
		project = null,
		now,
		onLater
	}: {
		card: InboxCard;
		project?: string | null;
		now: number;
		/** Ask me later, where the list honours it. */
		onLater?: () => void;
	} = $props();

	let note = $state('');
	let picks = $state<Picks>({});
	let expanded = $state(false);
	const token = $derived((page.data.sessionToken as string | undefined) ?? '');

	const answer = (choice: InboxAction) =>
		inbox.answer(card, choice, note.trim() || null, token, picks);
</script>

<DecisionCard
	{card}
	{project}
	{expanded}
	canAnswer={inbox.view(page.data.inbox as InboxView | undefined)?.canAnswer ?? false}
	error={inbox.errors[card.id] ?? null}
	bind:note
	bind:picks
	{now}
	onAnswer={answer}
	{onLater}
	onClose={() => answer('close')}
	onToggle={() => (expanded = !expanded)}
/>
