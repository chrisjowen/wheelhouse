<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { currentCrew, currentFleet, live } from '$lib/client/live.svelte';
	import { hueOf, initials } from '$lib/bridge';
	import { ago } from '$lib/format';
	import Discussion from '$lib/components/wh/crew/Discussion.svelte';

	/**
	 * Crew: the crew discussions the captain has open, each a direct talk with
	 * one worker, listed on the left with the one picked (`?with=`; a page's
	 * `?task=` opens that task, see lib/server/oldlinks.ts) beside them. Only
	 * discussions opened with Chat with crew on a task's Chat are here (none by default):
	 * most of the time the captain talks to Firstmate.
	 */
	const crew = $derived(currentCrew());
	const discussions = $derived(crew?.discussions ?? []);
	const tasks = $derived(currentFleet()?.tasks ?? []);
	const picked = $derived(
		discussions.find((d) => d.taskId === page.url.searchParams.get('with')) ??
			discussions[0] ??
			null
	);
	const token = $derived((page.data.sessionToken as string | undefined) ?? '');
	const last = (d: (typeof discussions)[number]) => d.messages.at(-1)?.at ?? d.openedAt;
	const unread = (d: (typeof discussions)[number]) =>
		d.messages.filter((m) => m.delivery === 'sent' && !m.seen).length;
</script>

<svelte:head><title>Crew · Wheelhouse</title></svelte:head>

<main class="flex min-h-0 flex-1 max-md:flex-col">
	<section
		class="flex shrink-0 flex-col border-r max-md:border-r-0 max-md:border-b md:w-[22rem]"
		aria-labelledby="crew-title"
	>
		<div class="px-5 pt-6 pb-4">
			<h1 id="crew-title" class="text-2xl">The <em>crew</em></h1>
			<p class="mt-1 text-sm text-muted-foreground">
				Discussions you opened with a worker directly. Start one with Chat with crew on a task’s
				Chat; Firstmate is told of each.
			</p>
		</div>
		{#if crew && !crew.available}
			<p class="px-5 text-sm text-warning">{crew.reason}</p>
		{:else if discussions.length}
			<ul class="flex flex-col gap-0.5 overflow-y-auto px-3 pb-4" aria-label="Open discussions">
				{#each discussions as d (d.taskId)}
					{@const t = tasks.find((x) => x.id === d.taskId)}
					{@const n = unread(d)}
					<li>
						<a
							href="/crew?with={encodeURIComponent(d.taskId)}"
							class="nav-item min-h-14 gap-3"
							aria-current={picked?.taskId === d.taskId ? 'page' : undefined}
							data-crew-row={d.taskId}
						>
							<span class="mate-avatar" data-hue={hueOf(d.taskId)} aria-hidden="true"
								>{initials(d.taskId)}</span
							>
							<span class="min-w-0 flex-1">
								<span class="block truncate text-foreground">{t?.title ?? d.title}</span>
								<span class="block truncate font-mono text-xs text-muted-foreground"
									>{d.taskId} · {t?.statusLabel ?? 'gone from the fleet'}</span
								>
							</span>
							<span class="flex shrink-0 flex-col items-end gap-1 text-xs text-muted-foreground">
								<span>{ago(last(d), live.now)}</span>
								{#if d.paused}<span class="text-warning">paused</span>{:else if n}<span
										>{n} not read yet</span
									>{/if}
							</span>
						</a>
					</li>
				{/each}
			</ul>
		{/if}
		{#if crew?.reason && crew.available}
			<p class="mt-auto px-5 pb-4 text-xs text-muted-foreground">{crew.reason}</p>
		{/if}
	</section>

	<div class="flex min-h-0 min-w-0 flex-1 flex-col">
		{#if picked}
			{#key picked.taskId}
				<Discussion
					taskId={picked.taskId}
					discussion={picked}
					task={tasks.find((t) => t.id === picked.taskId) ?? null}
					{token}
					onended={() => goto('/crew', { replaceState: true })}
				/>
			{/key}
		{:else}
			<div class="m-auto max-w-md px-6 py-10 text-center" data-crew-empty>
				<p class="font-display text-xl">No crew discussions open</p>
				<p class="mt-2 text-sm text-muted-foreground">
					Most of the time, talk to Firstmate. When you need a worker directly, open its task’s
					<b>Chat</b> and choose <b>Chat with crew</b>.
				</p>
				<a class="mt-4 inline-block text-sm text-sea hover:underline" href="/harbour"
					>Go to the Harbour</a
				>
			</div>
		{/if}
	</div>
</main>
