<script lang="ts">
	import { fromBuilder, toBuilder, type Builder, type Cond } from '$lib/passage-edit';
	import { Plus, X } from '@lucide/svelte';

	/** A condition as a plain list: all (or any) of these references, each possibly negated. */
	let {
		id,
		label,
		help = null,
		value,
		refs,
		disabled = false,
		onchange
	}: {
		id: string;
		label: string;
		help?: string | null;
		value: Cond | undefined;
		refs: { group: string; options: { value: string; label: string }[] }[];
		disabled?: boolean;
		onchange: (c: Cond | undefined) => void;
	} = $props();

	const b = $derived(toBuilder(value));
	const known = $derived(new Set(refs.flatMap((g) => g.options.map((o) => o.value))));

	function set(next: Builder) {
		onchange(fromBuilder(next));
	}
	const first = $derived(refs[0]?.options[0]?.value ?? 'merged');
</script>

<fieldset class="min-w-0" aria-describedby={help ? `${id}-help` : undefined}>
	<legend class="text-sm font-medium">{label}</legend>
	{#if help}<p id="{id}-help" class="mt-0.5 text-xs text-muted-foreground">{help}</p>{/if}
	{#if b === null}
		<p class="mt-2 rounded-md border border-dashed px-3 py-2 text-sm text-muted-foreground">
			This condition is more involved than the form shows. Edit it in the YAML view.
		</p>
	{:else}
		{#if b.items.length > 1}
			<label class="mt-2 inline-flex items-center gap-2 text-sm">
				<span class="sr-only">How these combine</span>
				<select
					class="rounded-md border border-input bg-card px-2 py-1 text-sm"
					value={b.join}
					{disabled}
					onchange={(e) =>
						set({ ...b, join: (e.currentTarget as HTMLSelectElement).value as Builder['join'] })}
				>
					<option value="all">All of these</option>
					<option value="any">Any of these</option>
				</select>
			</label>
		{/if}
		<ul class="mt-2 space-y-2">
			{#each b.items as item, i (i)}
				<li class="flex flex-wrap items-center gap-2">
					<select
						class="rounded-md border border-input bg-card px-2 py-1 text-sm"
						aria-label="{label}: when"
						value={item.not ? 'not' : 'is'}
						{disabled}
						onchange={(e) => {
							const items = [...b.items];
							items[i] = { ...item, not: (e.currentTarget as HTMLSelectElement).value === 'not' };
							set({ ...b, items });
						}}
					>
						<option value="is">When</option>
						<option value="not">Unless</option>
					</select>
					<select
						class="min-w-0 flex-1 rounded-md border border-input bg-card px-2 py-1 text-sm"
						aria-label="{label}: condition {i + 1}"
						value={item.ref}
						{disabled}
						onchange={(e) => {
							const items = [...b.items];
							items[i] = { ...item, ref: (e.currentTarget as HTMLSelectElement).value };
							set({ ...b, items });
						}}
					>
						{#if !known.has(item.ref)}<option value={item.ref}>{item.ref} (not known)</option>{/if}
						{#each refs as g (g.group)}
							<optgroup label={g.group}>
								{#each g.options as o (o.value)}<option value={o.value}>{o.label}</option>{/each}
							</optgroup>
						{/each}
					</select>
					<button
						type="button"
						class="inline-flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
						aria-label="Remove this condition"
						{disabled}
						onclick={() => set({ ...b, items: b.items.filter((_, k) => k !== i) })}
						><X class="size-4" aria-hidden="true" /></button
					>
				</li>
			{/each}
		</ul>
		<button
			type="button"
			class="mt-2 inline-flex items-center gap-1 text-sm text-sea hover:underline disabled:opacity-50"
			{disabled}
			onclick={() => set({ ...b, items: [...b.items, { not: false, ref: first }] })}
			><Plus class="size-3.5" aria-hidden="true" />{b.items.length
				? 'Add another'
				: 'Add a condition'}</button
		>
	{/if}
</fieldset>
