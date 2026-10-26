<script lang="ts">
	import { MessagesSquare } from '@lucide/svelte';
	import { clock, ago } from '$lib/format';
	import { PARTY_LABEL, type TalkEntry } from '$lib/buildlog';
	import type { Available } from '$lib/types';

	let { talk, now }: { talk: Available<TalkEntry[]>; now: number } = $props();

	const LONG = 280;
	let opened = $state<Record<string, boolean>>({});

	/** Who spoke to whom, in a few words. */
	function lead(e: TalkEntry): string {
		switch (e.kind) {
			case 'question':
				return 'The worker asked Firstmate';
			case 'blocked':
				return 'The worker asked Firstmate for help';
			case 'review':
				return 'The automated review asked Firstmate';
			case 'steer':
				return 'Firstmate told the worker';
			case 'captain':
				return e.to === 'worker' ? 'Your feedback reached the worker' : 'You wrote to Firstmate';
		}
	}

	const tone: Record<TalkEntry['outcome']['state'], string> = {
		open: 'bg-warning/10 text-warning',
		answered: 'bg-success/10 text-success',
		cleared: 'bg-muted text-muted-foreground',
		read: 'bg-muted text-muted-foreground',
		unread: 'bg-sea/10 text-sea',
		sent: 'bg-muted text-muted-foreground'
	};
	const verdictTone = (v: string) =>
		v === 'Fix it' ? 'text-foreground' : v === 'Defer' ? 'text-warning' : 'text-muted-foreground';
</script>

{#snippet longText(id: string, text: string)}
	{@const long = text.length > LONG}
	<p
		class="mt-1 text-sm leading-relaxed whitespace-pre-line {long && !opened[id]
			? 'line-clamp-4'
			: ''}"
	>
		{text}
	</p>
	{#if long}
		<button
			type="button"
			class="mt-1 text-xs text-muted-foreground hover:text-foreground hover:underline"
			aria-expanded={!!opened[id]}
			onclick={() => (opened[id] = !opened[id])}>{opened[id] ? 'Show less' : 'Show all'}</button
		>
	{/if}
{/snippet}

<section aria-labelledby="conversation" class="max-w-4xl">
	<h2 id="conversation" class="sr-only">Conversation</h2>
	{#if !talk.available}
		<p class="text-sm text-muted-foreground">{talk.reason}</p>
	{:else if !talk.value.length}
		<div class="rounded-xl border border-dashed p-6 text-muted-foreground">
			<MessagesSquare class="size-5" aria-hidden="true" />
			<p class="mt-2 text-sm font-medium text-foreground">Nothing has been asked yet</p>
			<p class="mt-1 text-sm">
				When the worker asks Firstmate something, or Firstmate steers the worker, it shows here.
			</p>
		</div>
	{:else}
		<p class="text-sm text-muted-foreground">
			Between the worker and Firstmate, oldest first. Firstmate answers for you while you are away.
		</p>
		<ol class="mt-4 divide-y divide-hair rounded-lg border bg-card">
			{#each talk.value as e (e.id)}
				<li class="grid gap-x-4 px-4 py-4 sm:grid-cols-[4.5rem_minmax(0,1fr)]" data-talk={e.kind}>
					<time
						class="tabular pt-0.5 text-xs text-muted-foreground"
						datetime={e.at}
						title={ago(e.at, now)}>{clock(e.at)}</time
					>
					<div class="min-w-0">
						<div class="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
							<p class="text-xs tracking-wide text-muted-foreground">{lead(e)}</p>
							<span class="rounded-full px-2 py-0.5 text-xs font-medium {tone[e.outcome.state]}"
								>{e.outcome.label}</span
							>
						</div>
						<p class="mt-1 font-medium">{e.title}</p>
						{#if e.body}{@render longText(`${e.id} body`, e.body)}{/if}

						{#if e.calls.length}
							<ul class="mt-3 space-y-2">
								{#each e.calls as c, i (i)}
									<li class="rounded-md border border-hair px-3 py-2 text-sm">
										<p>{c.question}</p>
										<p class="mt-1">
											<span class="font-medium {verdictTone(c.verdict)}">{c.verdict}</span>
											{#if c.reason}<span class="text-muted-foreground"> · {c.reason}</span>{/if}
										</p>
									</li>
								{/each}
							</ul>
						{/if}

						{#if e.reply}
							<div class="mt-3 border-l-2 border-brass/60 pl-3">
								<p class="text-xs text-muted-foreground">
									{PARTY_LABEL[e.reply.from]}
									{e.reply.from === 'worker' ? 'noted' : 'answered'}{e.reply.at
										? ` · ${clock(e.reply.at)}`
										: ''}
								</p>
								{@render longText(`${e.id} reply`, e.reply.text)}
							</div>
						{/if}
					</div>
				</li>
			{/each}
		</ol>
		<p class="mt-2 text-xs text-muted-foreground">From {talk.source}.</p>
	{/if}
</section>
