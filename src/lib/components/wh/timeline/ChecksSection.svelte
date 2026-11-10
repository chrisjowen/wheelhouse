<script lang="ts">
	import {
		Check as CheckIcon,
		ChevronRight,
		CircleDashed,
		CirclePause,
		FileText,
		LoaderCircle,
		Minus,
		ShieldCheck,
		X
	} from '@lucide/svelte';
	import { live } from '$lib/client/live.svelte';
	import {
		checkRows,
		checksLine,
		ciChecksLine,
		duration,
		reportLine,
		showsChecks,
		type CheckRow
	} from '$lib/checks';
	import { ago, clock } from '$lib/format';
	import { plainStatus } from '$lib/plain';
	import type { ChecksView } from '$lib/buildlog';
	import type { Available, Check, TaskSummary, ValidationRun } from '$lib/types';
	import RawDetails from '../RawDetails.svelte';

	/**
	 * The task's checks in one place: the validation run's steps (rebase,
	 * review, tests, docs, lint, push, pull request, CI) with what each is
	 * doing or came to and how long it took, what each step found opening in
	 * place (failed tests with their output, the docs it touched, its notes),
	 * the pull request's CI checks on the CI step, and the task's earlier runs.
	 */
	let {
		task,
		checks,
		prChecks = [],
		validations = [],
		validation
	}: {
		task: TaskSummary;
		checks: Available<ChecksView>;
		prChecks?: readonly Check[];
		validations?: ValidationRun[];
		/** Firstmate's crew-state read of the validation step, when it has one. */
		validation: Available<{ detail: string }> | null;
	} = $props();

	const running = $derived(showsChecks(task) ? task.pipeline : null);
	const report = $derived(checks.available ? checks.value : null);
	const rows = $derived(checkRows(running, report));
	const reached = $derived(rows.filter((r) => r.tone !== 'todo'));
	const later = $derived(rows.filter((r) => r.tone === 'todo'));
	const ci = $derived(ciChecksLine(prChecks));
	const line = $derived(
		running ? checksLine(running, live.now) : report ? reportLine(report) : null
	);
	const startedAt = $derived(running?.startedAt ?? report?.startedAt ?? null);
	const earlier = $derived(validations.slice(0, -1).filter((v) => v.startedAt));

	const hasMore = (r: CheckRow) =>
		(r.key === 'ci' && prChecks.length > 0) ||
		!!r.report?.notes.length ||
		!!r.report?.tests?.failures.length ||
		!!r.report?.tests?.scenarios.length ||
		r.report?.tests?.passed != null ||
		!!r.report?.docs?.files.length ||
		!!r.report?.docs?.summary.length;
	const failing = (r: CheckRow) =>
		r.tone === 'failed' ||
		!!r.report?.tests?.failed ||
		!!r.report?.tests?.scenarios.some((x) => x.result === 'fail');
	// Failures and the step under way start open; the rest fold to their one line.
	let toggled = $state<Record<string, boolean>>({});
	const isOpen = (r: CheckRow) => toggled[`${task.id} ${r.key}`] ?? (failing(r) || r.current);

	/** How long a step took, or has taken so far (live for the step under way). */
	function took(r: CheckRow): string | null {
		if (r.current && running && (r.tone === 'active' || r.tone === 'fixing')) {
			const from = Date.parse(running.roundStartedAt ?? running.startedAt ?? '');
			if (!Number.isNaN(from)) return duration(live.now - from);
		}
		return r.durationMs != null && r.durationMs >= 1000 ? duration(r.durationMs) : null;
	}
	const summary = (r: CheckRow) => (r.key === 'ci' && ci ? `${r.summary} · ${ci}` : r.summary);
	const docHref = (p: string) =>
		`/tasks/${encodeURIComponent(task.id)}/doc?path=${encodeURIComponent(p)}`;
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
	const SEGMENT: Record<CheckRow['tone'], string> = {
		done: 'bg-foreground/45',
		active: 'bg-foreground',
		waiting: 'bg-warning',
		fixing: 'bg-foreground',
		failed: 'bg-danger',
		skipped: 'bg-muted',
		todo: 'bg-muted'
	};
</script>

{#snippet icon(r: CheckRow)}
	{#if r.tone === 'done'}<CheckIcon
			class="size-4 shrink-0 {r.key === 'ci' ? 'text-success' : 'text-muted-foreground'}"
			aria-label="Done"
		/>
	{:else if r.tone === 'failed'}<X class="size-4 shrink-0 text-danger" aria-label="Failed" />
	{:else if r.tone === 'waiting'}<CirclePause
			class="size-4 shrink-0 text-warning"
			aria-label="Waiting on Firstmate"
		/>
	{:else if r.tone === 'skipped'}<Minus
			class="size-4 shrink-0 text-muted-foreground"
			aria-label="Skipped"
		/>
	{:else}<LoaderCircle
			class="size-4 shrink-0 {task.busy ? 'motion-safe:animate-spin' : ''}"
			aria-label={r.tone === 'fixing' ? 'Fixing' : 'Under way'}
		/>{/if}
{/snippet}

{#snippet ciCheck(c: Check)}
	{#if c.state === 'pass'}<CheckIcon class="size-4 shrink-0 text-success" aria-label="Passed" />
	{:else if c.state === 'fail'}<X class="size-4 shrink-0 text-danger" aria-label="Failed" />
	{:else if c.state === 'running'}<LoaderCircle
			class="size-4 shrink-0 animate-spin text-muted-foreground"
			aria-label="Running"
		/>
	{:else if c.state === 'skipped'}<Minus
			class="size-4 shrink-0 text-muted-foreground"
			aria-label="Skipped"
		/>
	{:else}<CircleDashed class="size-4 shrink-0 text-muted-foreground" aria-label="Pending" />{/if}
{/snippet}

{#snippet found(r: CheckRow)}
	{@const s = r.report}
	{#if r.key === 'ci' && prChecks.length}
		<ul class="divide-y rounded-lg border">
			{#each prChecks as c, i (c.name + i)}
				<li class="flex items-center gap-3 px-3 py-2">
					{@render ciCheck(c)}<span class="truncate">{c.name}</span>
				</li>
			{/each}
		</ul>
	{/if}
	{#if s?.tests}
		{@const t = s.tests}
		{#if t.passed !== null || t.failed !== null}
			<p class="tabular flex flex-wrap gap-x-4">
				<span><span class="font-medium text-success">{t.passed ?? 0}</span> passed</span>
				<span
					><span class="font-medium {t.failed ? 'text-danger' : ''}">{t.failed ?? 0}</span> failed</span
				>
				{#if t.skipped}<span><span class="font-medium">{t.skipped}</span> skipped</span>{/if}
			</p>
		{/if}
		{#if t.failures.length}
			<ul class="space-y-2">
				{#each t.failures as f, n (f.name)}
					{@const name = testName(f.name)}
					<li>
						<details class="rounded-md border border-danger/30 bg-danger/5" open={n === 0}>
							<summary class="flex cursor-pointer items-start gap-2 px-3 py-2">
								<X class="mt-0.5 size-4 shrink-0 text-danger" aria-hidden="true" />
								<span class="min-w-0 break-words"
									>{name.title}{#if name.where}<span class="block text-xs text-muted-foreground"
											>{name.where}</span
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
						{#if sc.result === 'pass'}<CheckIcon
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
		{#if report?.testingNote}<p class="leading-relaxed text-muted-foreground">
				{report.testingNote}
			</p>{/if}
		<p class="text-xs text-muted-foreground">From {t.basis}.</p>
	{/if}
	{#if s?.docs}
		{#if s.docs.summary.length}
			<ul class="list-disc space-y-1 pl-5">
				{#each s.docs.summary as l, i (i)}<li>{l}</li>{/each}
			</ul>
		{/if}
		{#if s.docs.files.length}
			<ul class="flex flex-wrap gap-2">
				{#each s.docs.files as d (d.path)}
					<li>
						<a
							href={docHref(d.path)}
							class="inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 hover:bg-accent/60"
							><FileText class="size-3.5 text-muted-foreground" aria-hidden="true" />{d.title}</a
						>
					</li>
				{/each}
			</ul>
		{/if}
	{/if}
	{#if s?.notes.length}
		<div>
			<p class="text-xs text-muted-foreground">
				{s.key === 'test' || s.key === 'document' ? 'In its own words' : 'Along the way'}
			</p>
			<ul class="mt-1 list-disc space-y-1 pl-5 text-muted-foreground">
				{#each s.notes as n, i (i)}<li>{n}</li>{/each}
			</ul>
		</div>
	{/if}
{/snippet}

<section class="rounded-xl border bg-card" aria-labelledby="checks-{task.id}" data-checks>
	<div class="flex flex-wrap items-center gap-x-3 gap-y-2 border-b px-4 py-3">
		<ShieldCheck class="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
		<h3 id="checks-{task.id}" class="font-medium">Checks</h3>
		{#if line}
			<p
				class="tabular min-w-0 text-sm {line.startsWith('All checks passed')
					? 'text-success'
					: 'text-muted-foreground'}"
			>
				{line}{startedAt ? ` · started ${clock(startedAt)}` : ''}
			</p>
		{/if}
		{#if rows.length}
			<!-- The strip the cards show, one segment per step. -->
			<div class="ml-auto flex w-full gap-0.5 sm:w-48" aria-hidden="true">
				{#each rows as r (r.key)}
					<span
						class="h-1.5 flex-1 rounded-full {SEGMENT[r.tone]} {r.current && task.busy
							? 'motion-safe:animate-pulse'
							: ''}"
					></span>
				{/each}
			</div>
		{/if}
	</div>

	{#if rows.length}
		<ol class="divide-y divide-hair/60 text-sm">
			{#each reached as r (r.key)}
				{@const more = hasMore(r)}
				{@const open = more && isOpen(r)}
				<li data-check-step={r.key}>
					<button
						type="button"
						class="grid w-full grid-cols-[1.25rem_minmax(0,7rem)_minmax(0,1fr)_auto_1rem] items-start gap-x-3 px-4 py-2 text-left enabled:hover:bg-accent/40 disabled:cursor-default"
						disabled={!more}
						aria-expanded={more ? open : undefined}
						aria-controls={more ? `check-${task.id}-${r.key}` : undefined}
						onclick={() => (toggled[`${task.id} ${r.key}`] = !open)}
					>
						<span class="flex h-6 items-center">{@render icon(r)}</span>
						<span class="truncate leading-6 {r.current ? 'font-medium' : ''}">{r.label}</span>
						<span
							class="leading-6 {failing(r)
								? 'text-danger'
								: r.tone === 'waiting'
									? 'text-warning'
									: 'text-muted-foreground'}">{summary(r)}</span
						>
						<span class="tabular text-right text-xs leading-6 text-muted-foreground"
							>{took(r) ?? ''}</span
						>
						{#if more}<ChevronRight
								class="mt-1 size-4 text-muted-foreground transition-transform {open
									? 'rotate-90'
									: ''}"
								aria-hidden="true"
							/>{:else}<span></span>{/if}
					</button>
					{#if open}
						<div id="check-{task.id}-{r.key}" class="space-y-4 px-4 pt-1 pb-4 pl-12">
							{@render found(r)}
						</div>
					{/if}
				</li>
			{/each}
			{#if later.length}
				<li class="flex items-center gap-3 px-4 py-2 text-muted-foreground">
					<CircleDashed class="size-4 shrink-0 text-muted-foreground/60" aria-hidden="true" />
					Still to come: {later.map((r) => r.label).join(', ')}
				</li>
			{/if}
		</ol>
	{:else}
		<p class="px-4 py-3 text-sm text-muted-foreground">
			{#if validation?.available}{plainStatus(task.current?.state, validation.value.detail)}
			{:else if !checks.available}{checks.reason}
			{:else}No checks have run yet.{/if}
		</p>
	{/if}

	<div class="space-y-1 border-t px-4 py-2 text-xs text-muted-foreground">
		{#if validation?.available}
			<RawDetails
				raw={validation.value.detail}
				plain={plainStatus(task.current?.state, validation.value.detail)}
			/>
		{/if}
		{#if earlier.length}
			<p>
				Earlier runs: {#each earlier as v, i (v.id)}{i ? ' · ' : ''}{clock(v.startedAt!)}
					{v.text}{/each}
			</p>
		{/if}
		<p>
			From the validation run’s own report{running?.observedAt
				? `, ${ago(running.observedAt, live.now)}`
				: checks.available
					? ` (${checks.source})`
					: ''}.
		</p>
	</div>
</section>
