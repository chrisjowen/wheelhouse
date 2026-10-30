<script lang="ts" module>
	import type { PluginSettingValue, PluginSettingView } from '$lib/updates';

	/** A setting's value as the form shows it: yes or no, a list joined with commas, else as is. */
	export const answerText = (v: PluginSettingValue | undefined) =>
		v === undefined
			? ''
			: v === true
				? 'yes'
				: v === false
					? 'no'
					: Array.isArray(v)
						? v.join(', ')
						: String(v);

	/** Each setting's starting answer: what the plugins file has, else its default. */
	export const answersFor = (settings: PluginSettingView[]): Record<string, string> =>
		Object.fromEntries(settings.map((s) => [s.key, answerText(s.current ?? s.default)]));
</script>

<script lang="ts">
	/**
	 * The form for a plugin's declared settings (its manifest's
	 * `wheelhouse.settings`): one field per setting, each answer kept as text
	 * by key. The install and update review and a plugin's own page share it.
	 */
	let {
		settings,
		answers = $bindable(),
		disabled = false
	}: {
		settings: PluginSettingView[];
		answers: Record<string, string>;
		disabled?: boolean;
	} = $props();

	const field =
		'h-9 rounded-md border border-input bg-background px-2.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60';
</script>

{#each settings as s (s.key)}
	<label class="grid gap-1">
		<span class="text-xs"
			>{s.title}{#if s.required}<span class="text-danger" aria-hidden="true">&nbsp;*</span
				>{:else}<span class="text-muted-foreground">&nbsp;(optional)</span>{/if}</span
		>
		{#if s.type === 'boolean' || s.options}
			<select class={field} bind:value={answers[s.key]} required={s.required} {disabled}>
				{#if !s.required}<option value="">Not set</option>{/if}
				{#if s.options}
					{#each s.options as o (o.value)}<option value={o.value}>{o.label}</option>{/each}
				{:else}
					<option value="yes">Yes</option>
					<option value="no">No</option>
				{/if}
			</select>
		{:else}
			<input
				class={field}
				type="text"
				inputmode={s.type === 'number' ? 'decimal' : undefined}
				autocomplete="off"
				spellcheck="false"
				required={s.required}
				{disabled}
				bind:value={answers[s.key]}
			/>
		{/if}
		{#if s.description || s.type === 'list'}
			<span class="text-xs text-muted-foreground"
				>{s.description ?? ''}{s.type === 'list'
					? `${s.description ? ' ' : ''}Separate them with commas.`
					: ''}</span
			>
		{/if}
	</label>
{/each}
