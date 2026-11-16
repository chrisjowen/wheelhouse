<script lang="ts" module>
	export interface Lane {
		topic: string;
		name: string;
		hue: number | null;
		/** Messages new since the captain last read the lane. */
		unread: number;
		/** Decisions in it waiting on the captain. */
		needs: number;
	}
	export interface LaneTask {
		/** A task id, or '-' for the lane's messages about no task. */
		task: string;
		name: string;
		unread: number;
	}
</script>

<script lang="ts">
	import { Check } from '@lucide/svelte';
	import Sheet from '$lib/components/wh/Sheet.svelte';

	/**
	 * The chat's lanes (the experimental `lanes` feature): All, then one lane
	 * per thread in the chat, each with its new messages and a dot for a
	 * decision waiting on the captain; picking one reads the chat one thread at
	 * a time. Under a lane, its tasks narrow it further. ⌥1–9 pick the first
	 * nine lanes and ⌥0 All; ⌥↓ and ⌥↑ go to the next or previous lane with
	 * news. A phone has no rows, to leave the conversation the screen: the
	 * chat's bar names the lane, and opens them all in a sheet (`sheet`), with
	 * the lane's tasks under it.
	 */
	let {
		lanes,
		current,
		onPick,
		tasks = [],
		currentTask = null,
		onPickTask,
		allUnread = 0,
		sheet = $bindable(false)
	}: {
		lanes: Lane[];
		/** The lane being read, or null for All. */
		current: string | null;
		onPick: (topic: string | null) => void;
		/** The tasks of the lane being read; no row without two or more. */
		tasks?: LaneTask[];
		currentTask?: string | null;
		onPickTask: (task: string | null) => void;
		/** New messages across every lane. */
		allUnread?: number;
		/** Whether the phone's sheet of lanes is open. */
		sheet?: boolean;
	} = $props();

	function pickFromSheet(topic: string | null, task: string | null = null) {
		sheet = false;
		if (topic !== current) onPick(topic);
		onPickTask(task);
	}

	const lane = $derived(lanes.find((l) => l.topic === current) ?? null);

	function keydown(e: KeyboardEvent) {
		if (!e.altKey || e.metaKey || e.ctrlKey) return;
		// The terminal keeps its own keys.
		if ((e.target as Element | null)?.closest?.('[data-firstmate-terminal]')) return;
		const digit = /^Digit([0-9])$/.exec(e.code);
		if (digit) {
			const n = Number(digit[1]);
			if (n === 0) onPick(null);
			else if (lanes[n - 1]) onPick(lanes[n - 1].topic);
			else return;
			e.preventDefault();
			return;
		}
		if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
		const news = lanes.filter((l) => l.unread || l.needs || l.topic === current);
		if (!news.length || (news.length === 1 && news[0].topic === current)) return;
		e.preventDefault();
		const at = news.findIndex((l) => l.topic === current);
		const step = e.key === 'ArrowDown' ? 1 : -1;
		const next =
			at < 0 ? (step > 0 ? 0 : news.length - 1) : (at + step + news.length) % news.length;
		onPick(news[next].topic);
	}

	// The lane picked scrolls into view in its row.
	let row = $state<HTMLElement | null>(null);
	$effect(() => {
		void current;
		row
			?.querySelector('[aria-current="true"]')
			?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
	});
</script>

<svelte:window onkeydown={keydown} />

<nav class="lanes max-md:hidden" aria-label="Lanes" data-lanes>
	<div class="lanes-row no-scrollbar" bind:this={row}>
		<button
			type="button"
			class="lane"
			aria-current={current === null ? 'true' : undefined}
			title="Every thread (⌥0)"
			onclick={() => onPick(null)}
			>All{#if allUnread}<span class="lane-count" aria-label="{allUnread} new">{allUnread}</span
				>{/if}<span class="lane-key" aria-hidden="true">⌥0</span></button
		>
		<span class="lane-rule" aria-hidden="true"></span>
		{#each lanes as l, i (l.topic)}
			<button
				type="button"
				class="lane"
				data-hue={l.hue ?? undefined}
				data-lane={l.topic}
				aria-current={current === l.topic ? 'true' : undefined}
				title="{l.name}{i < 9 ? ` (⌥${i + 1})` : ''}"
				onclick={() => onPick(l.topic)}
				><span class="thread-dot" data-hue={l.hue ?? undefined} aria-hidden="true"></span><span
					class="lane-name">{l.name}</span
				>{#if l.needs}<span
						class="lane-needs"
						role="img"
						aria-label="{l.needs} waiting on you"
						title="{l.needs} waiting on you"
					></span>{/if}{#if l.unread}<span class="lane-count" aria-label="{l.unread} new"
						>{l.unread}</span
					>{/if}{#if i < 9}<span class="lane-key" aria-hidden="true">⌥{i + 1}</span>{/if}</button
			>
		{/each}
	</div>
	{#if lane && tasks.length > 1}
		<div class="lane-tasks no-scrollbar" data-hue={lane.hue ?? undefined} data-lane-tasks>
			<button
				type="button"
				class="thread-chip"
				aria-pressed={currentTask === null}
				onclick={() => onPickTask(null)}>All of {lane.name}</button
			>
			{#each tasks as t (t.task)}
				<button
					type="button"
					class="thread-chip"
					aria-pressed={currentTask === t.task}
					title={t.name}
					onclick={() => onPickTask(t.task)}
					><span class="lane-task-name">{t.name}</span>{#if t.unread}<span
							class="lane-count"
							aria-label="{t.unread} new">{t.unread}</span
						>{/if}</button
				>
			{/each}
		</div>
	{/if}
</nav>

<Sheet bind:open={sheet} title="Lanes" onOpenAutoFocus={(e) => e.preventDefault()}>
	<div class="flex flex-col px-2 pb-3" data-lane-sheet>
		<button
			type="button"
			class="lane-row"
			aria-current={current === null ? 'true' : undefined}
			onclick={() => pickFromSheet(null)}
			><span class="lane-row-name">All</span>{#if allUnread}<span
					class="lane-count"
					aria-label="{allUnread} new">{allUnread}</span
				>{/if}{#if current === null}<Check
					class="size-4 shrink-0"
					aria-hidden="true"
				/>{/if}</button
		>
		{#each lanes as l (l.topic)}
			<button
				type="button"
				class="lane-row"
				data-hue={l.hue ?? undefined}
				aria-current={current === l.topic && !currentTask ? 'true' : undefined}
				onclick={() => pickFromSheet(l.topic)}
				><span class="thread-dot" data-hue={l.hue ?? undefined} aria-hidden="true"></span><span
					class="lane-row-name">{l.name}</span
				>{#if l.needs}<span class="lane-needs" role="img" aria-label="{l.needs} waiting on you"
					></span>{/if}{#if l.unread}<span class="lane-count" aria-label="{l.unread} new"
						>{l.unread}</span
					>{/if}{#if current === l.topic && !currentTask}<Check
						class="size-4 shrink-0"
						aria-hidden="true"
					/>{/if}</button
			>
			{#if current === l.topic && tasks.length > 1}
				{#each tasks as t (t.task)}
					<button
						type="button"
						class="lane-row lane-row-task"
						aria-current={currentTask === t.task ? 'true' : undefined}
						onclick={() => pickFromSheet(l.topic, t.task)}
						><span class="lane-row-name">{t.name}</span>{#if t.unread}<span
								class="lane-count"
								aria-label="{t.unread} new">{t.unread}</span
							>{/if}{#if currentTask === t.task}<Check
								class="size-4 shrink-0"
								aria-hidden="true"
							/>{/if}</button
					>
				{/each}
			{/if}
		{/each}
	</div>
</Sheet>
