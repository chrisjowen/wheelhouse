<script lang="ts">
	import CondField from './CondField.svelte';
	import { Button } from '$lib/components/ui/button';
	import { CHECK_WORDS, type CheckTypeName } from '$lib/passage-meta';
	import type { Cond, ListedStep, StageLike } from '$lib/passage-edit';
	import { ArrowDown, ArrowUp, Plus, RotateCcw, Trash2 } from '@lucide/svelte';

	type Refs = { group: string; options: { value: string; label: string }[] }[];

	/** The selected step's form. Built-in steps can be renamed and restyled, not re-ruled. */
	let {
		step,
		entry,
		declared,
		refs,
		evidence,
		links,
		uses,
		canUp,
		canDown,
		onfield,
		onmove,
		onremove,
		onreset,
		onopencheck,
		onaddcheck
	}: {
		step: ListedStep;
		entry: StageLike | null;
		/** Where the step is declared: built-in, the project file, or added by this file. */
		declared: 'builtin' | 'project' | 'captain' | 'file';
		refs: Refs;
		evidence: { value: string; label: string }[];
		links: { id: string; label: string }[];
		uses: { id: string; label: string; type: string }[];
		canUp: boolean;
		canDown: boolean;
		onfield: (key: string, value: unknown) => void;
		onmove: (delta: -1 | 1) => void;
		onremove: () => void;
		onreset: () => void;
		onopencheck: (id: string) => void;
		onaddcheck: (type: CheckTypeName) => void;
	} = $props();

	const rules = $derived(declared !== 'builtin');
	const text = (v: unknown) => (typeof v === 'string' ? v : '');
	const shows = $derived(Array.isArray(entry?.evidence) ? (entry!.evidence as string[]) : null);
	const noteText = $derived(typeof entry?.note === 'string' ? entry.note : '');
	const noteIsRule = $derived(!!entry?.note && typeof entry.note === 'object');
	const ORIGIN = {
		builtin: 'A built-in step',
		project: 'Added by the project’s repository file',
		captain: 'Added by your Wheelhouse config',
		file: 'Added by this file'
	};
	const inputClass = 'mt-1 w-full rounded-md border border-input bg-card px-3 py-1.5 text-sm';
	let adding = $state<CheckTypeName>('command');
</script>

<section aria-labelledby="step-title" data-step-form={step.id}>
	<p class="text-xs tracking-wide text-muted-foreground uppercase">
		{ORIGIN[declared]}{step.restyled && !step.added ? ', changed by this file' : ''}
	</p>
	<h2 id="step-title" class="mt-0.5 text-xl">{step.label}</h2>
	{#if step.lost}
		<p class="mt-2 text-sm text-danger" role="alert">
			It is placed after a step that does not exist. Move it to put it back in the passage.
		</p>
	{/if}

	<div class="mt-5 grid gap-4 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
		<div>
			<label for="step-label" class="block text-sm font-medium"
				>Name{#if step.added}<span class="font-normal text-muted-foreground">
						(required)</span
					>{/if}</label
			>
			<input
				id="step-label"
				class={inputClass}
				value={text(entry?.label)}
				placeholder={step.added ? 'e.g. Deployed locally' : step.label}
				oninput={(e) => onfield('label', (e.currentTarget as HTMLInputElement).value)}
			/>
		</div>
		<div>
			<label for="step-short" class="block text-sm font-medium">Short name</label>
			<input
				id="step-short"
				class={inputClass}
				value={text(entry?.short)}
				placeholder="For narrow layouts"
				oninput={(e) => onfield('short', (e.currentTarget as HTMLInputElement).value)}
			/>
		</div>
	</div>

	<div class="mt-6 space-y-5">
		{#if rules}
			<CondField
				id="reached"
				label="Reached when"
				help={step.added ? 'Required. The step is current once this holds.' : null}
				value={entry?.reached_when}
				{refs}
				onchange={(c: Cond | undefined) => onfield('reached_when', c)}
			/>
			<CondField
				id="failed"
				label="Failed when"
				help="Optional. The task shows as failed at this step."
				value={entry?.failed_when}
				{refs}
				onchange={(c: Cond | undefined) => onfield('failed_when', c)}
			/>
			<CondField
				id="skipped"
				label="Skipped when"
				help="Optional. Shown as skipped unless it is the current step."
				value={entry?.skip_when}
				{refs}
				onchange={(c: Cond | undefined) => onfield('skip_when', c)}
			/>
			{#if entry?.skip_when !== undefined}
				<div>
					<label for="step-skip-note" class="block text-sm font-medium">Why it is skipped</label>
					<input
						id="step-skip-note"
						class={inputClass}
						value={text(entry?.skip_note)}
						oninput={(e) => onfield('skip_note', (e.currentTarget as HTMLInputElement).value)}
					/>
				</div>
			{/if}
		{:else}
			<p class="rounded-md bg-muted/60 px-3 py-2 text-sm text-muted-foreground">
				When a built-in step is reached is fixed. You can rename it and choose what it shows.
			</p>
		{/if}

		<fieldset>
			<legend class="block text-sm font-medium">What it shows on the task page</legend>
			<p class="mt-0.5 text-xs text-muted-foreground">
				{shows ? 'Chosen here.' : 'Unchanged from below; tick to choose your own.'}
			</p>
			<div class="mt-2 grid gap-x-4 gap-y-1.5 sm:grid-cols-2 xl:grid-cols-3">
				{#each evidence as o (o.value)}
					<label class="flex items-center gap-2 text-sm">
						<input
							type="checkbox"
							class="size-4 accent-[var(--sea)]"
							checked={shows?.includes(o.value) ?? false}
							onchange={(e) => {
								const on = (e.currentTarget as HTMLInputElement).checked;
								const cur = shows ?? [];
								onfield('evidence', on ? [...cur, o.value] : cur.filter((x) => x !== o.value));
							}}
						/>{o.label}
					</label>
				{/each}
			</div>
		</fieldset>

		<div class="grid gap-4 sm:grid-cols-2">
			<div>
				<label for="step-link" class="block text-sm font-medium">Main link while current</label>
				<select
					id="step-link"
					class={inputClass}
					value={text(entry?.primary_link)}
					onchange={(e) => onfield('primary_link', (e.currentTarget as HTMLSelectElement).value)}
				>
					<option value="">None</option>
					{#each links as c (c.id)}<option value="{c.id}.url">{c.label}</option>{/each}
				</select>
			</div>
			{#if rules}
				<div>
					<label for="step-give-up" class="block text-sm font-medium">Stop checking after</label>
					<input
						id="step-give-up"
						class="{inputClass} max-w-40"
						placeholder="e.g. 24h"
						value={text(entry?.give_up_after)}
						oninput={(e) => onfield('give_up_after', (e.currentTarget as HTMLInputElement).value)}
					/>
				</div>
			{/if}
		</div>

		<div>
			<label for="step-note" class="block text-sm font-medium">Note shown with the step</label>
			{#if noteIsRule}
				<p class="mt-1 text-sm text-muted-foreground">
					This note depends on a condition; edit it in the YAML view.
				</p>
			{:else}
				<textarea
					id="step-note"
					rows="2"
					class={inputClass}
					value={noteText}
					oninput={(e) => onfield('note', (e.currentTarget as HTMLTextAreaElement).value)}
				></textarea>
			{/if}
		</div>
	</div>

	<div class="mt-8 border-t pt-5">
		<h3 class="block text-sm font-medium">Checks this step uses</h3>
		{#if uses.length}
			<ul class="mt-2 divide-y rounded-lg border">
				{#each uses as c (c.id)}
					<li>
						<button
							type="button"
							class="flex w-full items-baseline justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-muted/60"
							onclick={() => onopencheck(c.id)}
						>
							<span class="font-medium">{c.label}</span>
							<span class="text-xs text-muted-foreground"
								>{CHECK_WORDS[c.type as CheckTypeName]?.name ?? c.type}</span
							>
						</button>
					</li>
				{/each}
			</ul>
		{:else}
			<p class="mt-1 text-sm text-muted-foreground">None yet.</p>
		{/if}
		{#if rules}
			<div class="mt-3 flex flex-wrap items-center gap-2">
				<label for="add-check-type" class="sr-only">Kind of check</label>
				<select
					id="add-check-type"
					class="rounded-md border border-input bg-card px-2 py-1.5 text-sm"
					bind:value={adding}
				>
					{#each Object.entries(CHECK_WORDS) as [t, w] (t)}<option value={t}>{w.name}</option
						>{/each}
				</select>
				<Button variant="outline" size="sm" onclick={() => onaddcheck(adding)}
					><Plus aria-hidden="true" />Add a check to this step</Button
				>
			</div>
			<p class="mt-1 text-xs text-muted-foreground">
				The step is then reached when the check passes, and shows its result.
			</p>
		{/if}
	</div>

	<div class="mt-8 flex flex-wrap gap-2 border-t pt-5">
		{#if step.added}
			<Button variant="outline" size="sm" disabled={!canUp} onclick={() => onmove(-1)}
				><ArrowUp aria-hidden="true" />Move up</Button
			>
			<Button variant="outline" size="sm" disabled={!canDown} onclick={() => onmove(1)}
				><ArrowDown aria-hidden="true" />Move down</Button
			>
			<Button variant="destructive" size="sm" onclick={onremove}
				><Trash2 aria-hidden="true" />Remove this step</Button
			>
		{:else if step.restyled}
			<Button variant="outline" size="sm" onclick={onreset}
				><RotateCcw aria-hidden="true" />Undo this file’s changes to the step</Button
			>
		{/if}
		{#if declared === 'builtin'}
			<p class="self-center text-xs text-muted-foreground">
				Built-in steps stay in place and cannot be removed.
			</p>
		{/if}
	</div>
</section>
