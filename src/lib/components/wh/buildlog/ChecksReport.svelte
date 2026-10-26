<script lang="ts">
	import {
		Check,
		ChevronRight,
		CircleDashed,
		CirclePause,
		FileText,
		LoaderCircle,
		Minus,
		X
	} from '@lucide/svelte';
	import { clock } from '$lib/format';
	import { duration } from '$lib/insights';
	import type { CheckReport, ChecksView } from '$lib/buildlog';
	import type { Available } from '$lib/types';

	let { checks, taskId }: { checks: Available<ChecksView>; taskId: string } = $props();

	const hasMore = (s: CheckReport) =>
		s.notes.length > 0 ||
		!!s.tests?.failures.length ||
		!!s.tests?.scenarios.length ||
		!!s.docs?.files.length ||
		!!s.docs?.summary.length;
	// Failures and the current step start open; the rest fold to their one line.
	let toggled = $state<Record<string, boolean>>({});
	const isOpen = (s: CheckReport) =>
		toggled[s.key] ??
		(s.state === 'failed' ||
			!!s.tests?.failed ||
			s.tests?.scenarios.some((x) => x.result === 'fail'));
	const docHref = (p: string) =>
		`/tasks/${encodeURIComponent(taskId)}/doc?path=${encodeURIComponent(p)}`;
	const RESULT = { pass: 'Passed', fail: 'Failed', untested: 'Not tested', other: 'Other' };
	/** A failed test's own name first, in sentence case; where it lives (file and suite) under it. */
	function testName(full: string): { title: string; where: string | null } {
		const parts = full.split(' › ');
		const last = parts.pop() ?? full;
		return {
			title: last.charAt(0).toUpperCase() + last.slice(1),
			where: parts.length ? parts.join(' › ') : null
		};
	}
</script>

{#snippet stateIcon(s: CheckReport)}
	{#if s.state === 'done'}<Check class="size-4 shrink-0 text-success" aria-label="Done" />
	{:else if s.state === 'failed'}<X class="size-4 shrink-0 text-danger" aria-label="Failed" />
	{:else if s.state === 'running' || s.state === 'fixing'}<LoaderCircle
			class="size-4 shrink-0 animate-spin text-muted-foreground"
			aria-label={s.state === 'fixing' ? 'Fixing' : 'Running'}
		/>
	{:else if s.state === 'waiting'}<CirclePause
			class="size-4 shrink-0 text-warning"
			aria-label="Waiting for a decision"
		/>
	{:else if s.state === 'skipped'}<Minus
			class="size-4 shrink-0 text-muted-foreground"
			aria-label="Skipped"
		/>
	{:else}<CircleDashed
			class="size-4 shrink-0 text-muted-foreground"
			aria-label="Not started"
		/>{/if}
{/snippet}

<section aria-labelledby="checks-report" class="max-w-4xl">
	<h2 id="checks-report" class="sr-only">What each check found</h2>
	{#if !checks.available}
		<div class="rounded-xl border border-dashed p-6 text-sm text-muted-foreground">
			<p class="font-medium text-foreground">No checks to show yet</p>
			<p class="mt-1">{checks.reason}</p>
		</div>
	{:else}
		{@const v = checks.value}
		<p class="text-sm text-muted-foreground">
			The automated review and tests{v.startedAt ? `, started ${clock(v.startedAt)}` : ''}{v.runs >
			1
				? ` (the latest of ${v.runs} runs)`
				: ''}{v.outcome === 'passed'
				? ': everything passed.'
				: v.outcome === 'failed'
					? ': it failed.'
					: v.outcome === 'cancelled'
						? ': it was cancelled.'
						: '.'}
		</p>
		<ol class="mt-4 divide-y divide-hair rounded-lg border bg-card">
			{#each v.steps as s (s.key)}
				{@const more = hasMore(s)}
				{@const open = more && isOpen(s)}
				<li data-check-step={s.key}>
					<button
						type="button"
						class="flex w-full items-start gap-3 px-4 py-3 text-left disabled:cursor-default {more
							? 'hover:bg-accent/40'
							: ''}"
						disabled={!more}
						aria-expanded={more ? open : undefined}
						aria-controls={more ? `check-${s.key}` : undefined}
						onclick={() => (toggled[s.key] = !open)}
					>
						<span class="mt-0.5">{@render stateIcon(s)}</span>
						<span class="min-w-0 flex-1">
							<span class="font-medium">{s.label}</span>
							<span
								class="block text-sm {s.state === 'failed' ||
								s.tests?.failed ||
								s.tests?.scenarios.some((x) => x.result === 'fail')
									? 'text-danger'
									: 'text-muted-foreground'}">{s.summary}</span
							>
						</span>
						{#if s.durationMs}<span class="tabular shrink-0 pt-0.5 text-xs text-muted-foreground"
								>{duration(Math.round(s.durationMs / 1000))}</span
							>{/if}
						{#if more}<ChevronRight
								class="mt-0.5 size-4 shrink-0 text-muted-foreground transition-transform {open
									? 'rotate-90'
									: ''}"
								aria-hidden="true"
							/>{/if}
					</button>
					{#if open}
						<div id="check-{s.key}" class="space-y-4 px-4 pb-4 pl-11 text-sm">
							{#if s.tests}
								{@const t = s.tests}
								{#if t.passed !== null || t.failed !== null}
									<p class="tabular flex flex-wrap gap-x-4">
										<span><span class="font-medium text-success">{t.passed ?? 0}</span> passed</span
										>
										<span
											><span class="font-medium {t.failed ? 'text-danger' : ''}"
												>{t.failed ?? 0}</span
											> failed</span
										>
										{#if t.skipped}<span><span class="font-medium">{t.skipped}</span> skipped</span
											>{/if}
									</p>
								{/if}
								{#if t.failures.length}
									<ul class="space-y-2">
										{#each t.failures as f, n (f.name)}
											{@const name = testName(f.name)}
											<li>
												<details
													class="rounded-md border border-danger/30 bg-danger/5"
													open={n === 0}
												>
													<summary class="flex cursor-pointer items-start gap-2 px-3 py-2">
														<X class="mt-0.5 size-4 shrink-0 text-danger" aria-hidden="true" />
														<span class="min-w-0 break-words"
															>{name.title}{#if name.where}<span
																	class="block text-xs text-muted-foreground">{name.where}</span
																>{/if}</span
														>
													</summary>
													{#if f.output}<pre
															class="overflow-x-auto border-t border-danger/20 px-3 py-2 font-mono text-xs whitespace-pre">{f.output}</pre>{/if}
												</details>
											</li>
										{/each}
									</ul>
								{/if}
								{#if t.scenarios.length}
									<ul class="divide-y divide-hair rounded-md border border-hair">
										{#each t.scenarios as sc, i (i)}
											<li class="flex items-start gap-3 px-3 py-2">
												{#if sc.result === 'pass'}<Check
														class="mt-0.5 size-4 shrink-0 text-success"
														aria-hidden="true"
													/>{:else if sc.result === 'fail'}<X
														class="mt-0.5 size-4 shrink-0 text-danger"
														aria-hidden="true"
													/>{:else}<Minus
														class="mt-0.5 size-4 shrink-0 text-muted-foreground"
														aria-hidden="true"
													/>{/if}
												<span class="min-w-0 flex-1">
													<span class="sr-only">{RESULT[sc.result]}: </span>{sc.name}
													{#if sc.detail && sc.result !== 'pass'}<span
															class="mt-0.5 block text-xs text-muted-foreground">{sc.detail}</span
														>{/if}
												</span>
											</li>
										{/each}
									</ul>
								{/if}
								{#if v.testingNote}<p class="leading-relaxed text-muted-foreground">
										{v.testingNote}
									</p>{/if}
								<p class="text-xs text-muted-foreground">From {t.basis}.</p>
							{/if}

							{#if s.docs}
								{#if s.docs.summary.length}
									<ul class="list-disc space-y-1 pl-5">
										{#each s.docs.summary as line, i (i)}<li>{line}</li>{/each}
									</ul>
								{/if}
								{#if s.docs.files.length}
									<ul class="flex flex-wrap gap-2">
										{#each s.docs.files as d (d.path)}
											<li>
												<a
													href={docHref(d.path)}
													class="inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 hover:bg-accent/60"
													><FileText
														class="size-3.5 text-muted-foreground"
														aria-hidden="true"
													/>{d.title}</a
												>
											</li>
										{/each}
									</ul>
								{/if}
							{/if}

							{#if s.notes.length}
								<div>
									<p class="text-xs text-muted-foreground">
										{s.key === 'test' || s.key === 'document'
											? 'In its own words'
											: 'Along the way'}
									</p>
									<ul class="mt-1 list-disc space-y-1 pl-5 text-muted-foreground">
										{#each s.notes as n, i (i)}<li>{n}</li>{/each}
									</ul>
								</div>
							{/if}
						</div>
					{/if}
				</li>
			{/each}
		</ol>
		<p class="mt-2 text-xs text-muted-foreground">From {checks.source}.</p>
	{/if}
</section>
