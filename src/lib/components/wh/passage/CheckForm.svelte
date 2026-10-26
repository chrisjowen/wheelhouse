<script lang="ts">
	import {
		CHECK_FIELDS,
		CHECK_WORDS,
		COMMAND_BASE_ENV,
		type CheckField,
		type CheckTypeName
	} from '$lib/passage-meta';
	import { Button } from '$lib/components/ui/button';
	import { ArrowLeft, SquareTerminal, Trash2 } from '@lucide/svelte';

	/** One check's form: its own fields from the schema, plus name and interval. */
	let {
		checkId,
		spec,
		readonly = false,
		readonlyWhy = null,
		captain,
		releaseChecks,
		usedBy,
		onchange,
		onlabeldone,
		back = null,
		onremove
	}: {
		checkId: string;
		spec: Record<string, unknown>;
		readonly?: boolean;
		readonlyWhy?: string | null;
		captain: boolean;
		releaseChecks: { id: string; label: string }[];
		usedBy: string[];
		onchange: (spec: Record<string, unknown>) => void;
		onlabeldone: () => void;
		/** Return to the step this check was opened from. */
		back?: { label: string; go: () => void } | null;
		onremove: () => void;
	} = $props();

	const type = $derived(spec.type as CheckTypeName);
	const words = $derived(CHECK_WORDS[type] ?? { name: String(spec.type), what: '' });
	const fields = $derived((CHECK_FIELDS[type] ?? []).filter((f) => !f.captainOnly || captain));

	function get(key: string): unknown {
		const [a, b] = key.split('.');
		const v = spec[a];
		return b ? (v && typeof v === 'object' ? (v as Record<string, unknown>)[b] : undefined) : v;
	}

	function put(key: string, value: unknown) {
		const [a, b] = key.split('.');
		const next = { ...spec };
		if (b) {
			const inner = { ...((next[a] as Record<string, unknown>) ?? {}) };
			inner[b] = value;
			next[a] = inner;
		} else next[a] = value;
		onchange(next);
	}

	const text = (v: unknown) => (v === undefined || v === null ? '' : String(v));
	const lines = (v: unknown) => (Array.isArray(v) ? v.map(String).join('\n') : text(v));
	const fromLines = (s: string) =>
		s
			.split('\n')
			.map((x) => x.trim())
			.filter(Boolean);
	const mapText = (v: unknown) =>
		v && typeof v === 'object'
			? Object.entries(v)
					.map(([k, x]) => `${k}: ${x}`)
					.join('\n')
			: '';
	const fromMap = (s: string) =>
		Object.fromEntries(
			fromLines(s)
				.map((l) => l.split(':').map((x) => x.trim()))
				.filter((p) => p.length === 2 && p[0] && p[1])
		);
	// The command line as it will run, for reading (arguments with spaces are quoted).
	const shown = (run: unknown) =>
		Array.isArray(run)
			? run
					.map((a) => String(a))
					.map((a) => (/^[A-Za-z0-9_@%+=:,./-]+$/.test(a) ? a : `'${a.replace(/'/g, `'\\''`)}'`))
					.join(' ')
			: '';
	const WHEN: Record<string, string> = {
		merged: 'After the merge',
		'pr.recorded': 'Once a pull request is open',
		'crew.done': 'Once the worker reports done'
	};
	function whenText(sp: Record<string, unknown>): string {
		const when =
			sp.when === undefined
				? 'As soon as a task can use it, even before the merge'
				: (WHEN[String(sp.when)] ?? 'When its condition holds');
		const per =
			sp.ref === 'merge.commit'
				? ', once per merged commit'
				: sp.ref === 'pr.head'
					? ', once per pull request commit'
					: '';
		return `${when}${per}. A pass is not run again.`;
	}
	const inputClass =
		'mt-1 w-full rounded-md border border-input bg-card px-3 py-1.5 text-sm disabled:opacity-60';
</script>

{#snippet field(f: CheckField)}
	{@const fid = `check-${checkId}-${f.key}`}
	<div class="min-w-0">
		<label for={fid} class="block text-sm font-medium"
			>{f.label}{#if f.required}<span class="ml-1 font-normal text-muted-foreground"
					>(required)</span
				>{/if}</label
		>
		{#if f.kind === 'select'}
			{@const cur = text(get(f.key))}
			<select
				id={fid}
				class={inputClass}
				disabled={readonly}
				value={text(get(f.key))}
				onchange={(e) => {
					const v = (e.currentTarget as HTMLSelectElement).value;
					if (v !== cur || typeof get(f.key) === 'string' || !v) put(f.key, v || undefined);
				}}
			>
				{#if !f.required}<option value="">Not set</option>{/if}
				{#if get(f.key) !== undefined && typeof get(f.key) !== 'string'}
					<option value={cur}>As written in the YAML</option>
				{:else if cur && !(f.options ?? []).some((o) => o.value === cur)}
					<option value={cur}>{cur}</option>
				{/if}
				{#each f.options ?? [] as o (o.value)}<option value={o.value}>{o.label}</option>{/each}
			</select>
		{:else if f.kind === 'check'}
			<select
				id={fid}
				class={inputClass}
				disabled={readonly}
				value={text(get(f.key))}
				onchange={(e) => put(f.key, (e.currentTarget as HTMLSelectElement).value || undefined)}
			>
				<option value="">Choose a release check</option>
				{#each releaseChecks as c (c.id)}<option value={c.id}>{c.label}</option>{/each}
			</select>
		{:else if f.kind === 'list'}
			<textarea
				id={fid}
				rows={Math.max(2, (get(f.key) as unknown[] | undefined)?.length ?? 2)}
				class="{inputClass} font-mono"
				disabled={readonly}
				value={lines(get(f.key))}
				onchange={(e) => put(f.key, fromLines((e.currentTarget as HTMLTextAreaElement).value))}
			></textarea>
		{:else if f.kind === 'map'}
			<textarea
				id={fid}
				rows="2"
				class="{inputClass} font-mono"
				disabled={readonly}
				value={mapText(get(f.key))}
				onchange={(e) => put(f.key, fromMap((e.currentTarget as HTMLTextAreaElement).value))}
			></textarea>
		{:else if f.kind === 'number'}
			<input
				id={fid}
				type="number"
				class={inputClass}
				disabled={readonly}
				placeholder={f.placeholder}
				value={text(get(f.key))}
				onchange={(e) => {
					const v = (e.currentTarget as HTMLInputElement).value;
					put(f.key, v === '' ? undefined : Number(v));
				}}
			/>
		{:else}
			<input
				id={fid}
				class="{inputClass} {f.kind === 'duration' ? 'max-w-40' : ''}"
				disabled={readonly}
				placeholder={f.placeholder}
				value={text(get(f.key))}
				oninput={(e) => put(f.key, (e.currentTarget as HTMLInputElement).value || undefined)}
			/>
		{/if}
		{#if f.help}<p class="mt-1 text-xs text-muted-foreground">{f.help}</p>{/if}
	</div>
{/snippet}

<section aria-labelledby="check-{checkId}-title" data-check-form={checkId}>
	{#if back}
		<button
			type="button"
			class="mb-3 inline-flex items-center gap-1 text-sm text-sea hover:underline"
			onclick={back.go}
			><ArrowLeft class="size-3.5" aria-hidden="true" />Back to {back.label}</button
		>
	{/if}
	<p class="text-xs tracking-wide text-muted-foreground uppercase">{words.name}</p>
	<h2 id="check-{checkId}-title" class="mt-0.5 text-xl">{text(spec.label) || checkId}</h2>
	<p class="mt-1 text-sm text-muted-foreground">{words.what}</p>
	{#if readonlyWhy}<p class="mt-2 text-sm text-muted-foreground">{readonlyWhy}</p>{/if}

	<div class="mt-5 grid gap-4 sm:grid-cols-2">
		<div class="min-w-0 sm:col-span-2">
			<label for="check-{checkId}-label" class="block text-sm font-medium">Name</label>
			<input
				id="check-{checkId}-label"
				class={inputClass}
				disabled={readonly}
				value={text(spec.label)}
				placeholder={checkId}
				oninput={(e) => put('label', (e.currentTarget as HTMLInputElement).value || undefined)}
				onchange={onlabeldone}
			/>
		</div>
		{#each fields as f (f.key)}
			<div class={f.kind === 'list' || f.key === 'url' ? 'sm:col-span-2' : ''}>
				{@render field(f)}
			</div>
		{/each}
		{#if type !== 'status.note'}
			<div>
				<label for="check-{checkId}-interval" class="block text-sm font-medium">How often</label>
				<input
					id="check-{checkId}-interval"
					class="{inputClass} max-w-40"
					disabled={readonly}
					placeholder={type === 'command'
						? '10m'
						: type === 'github.release' || type === 'npm.published'
							? '5m'
							: '60s'}
					value={text(spec.interval)}
					oninput={(e) => put('interval', (e.currentTarget as HTMLInputElement).value || undefined)}
				/>
				<p class="mt-1 text-xs text-muted-foreground">At least 30s, e.g. 60s, 5m or 1h.</p>
			</div>
		{/if}
	</div>

	{#if type === 'command'}
		<div class="mt-6 rounded-lg border bg-panel p-4 text-sm" data-command-preview>
			<p class="flex items-center gap-2 font-medium">
				<SquareTerminal class="size-4" aria-hidden="true" />Exactly what will run
			</p>
			<pre
				class="mt-2 overflow-x-auto rounded-md bg-terminal px-3 py-2 font-mono text-xs text-terminal-foreground">{shown(
					spec.run
				) || '(no program yet)'}</pre>
			<dl class="mt-3 grid gap-x-4 gap-y-1 text-xs sm:grid-cols-[9rem_minmax(0,1fr)]">
				<dt class="text-muted-foreground">In the folder</dt>
				<dd>
					{text(spec.cwd) && spec.cwd !== '.'
						? `${spec.cwd}, inside the project`
						: 'At the top of the project'}, in a fresh checkout of {spec.ref === 'merge.commit'
						? 'the merge commit'
						: spec.ref === 'pr.head'
							? 'the pull request’s latest commit'
							: 'the default branch'}
				</dd>
				<dt class="text-muted-foreground">For at most</dt>
				<dd>{text(spec.timeout) || '5m'}</dd>
				<dt class="text-muted-foreground">With only</dt>
				<dd class="break-words">
					{[...COMMAND_BASE_ENV, ...((spec.env as string[] | undefined) ?? [])].join(', ')} from Wheelhouse’s
					environment, plus the task and project names
				</dd>
				<dt class="text-muted-foreground">When</dt>
				<dd>{whenText(spec)}</dd>
			</dl>
			<p class="mt-3 text-xs text-muted-foreground">
				It never goes through a shell. Command checks run only after you allow them on the project’s
				passage page, and changing a command line turns them off again. Allowing them trusts the
				project’s own scripts as they are at that commit: consent covers the command line, not the
				scripts it calls, which can change through merged pull requests without turning the commands
				off.
			</p>
		</div>
	{/if}

	{#if !readonly}
		<div class="mt-6 flex flex-wrap items-center gap-3 border-t pt-4">
			<Button variant="destructive" size="sm" onclick={onremove}
				><Trash2 aria-hidden="true" />Remove this check</Button
			>
			{#if usedBy.length}
				<p class="text-xs text-muted-foreground">
					Used by {usedBy.join(', ')}; removing it takes it out of {usedBy.length === 1
						? 'that step'
						: 'those steps'}.
				</p>
			{/if}
		</div>
	{/if}
</section>
