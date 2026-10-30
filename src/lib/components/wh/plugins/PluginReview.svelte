<script lang="ts" module>
	import type { PluginPreview, PluginSettingView } from '$lib/updates';
	import { answerText } from './SettingsFields.svelte';

	/** The settings a review asks for: all it declares at install, only new ones at update. */
	export const askedSettings = (p: PluginPreview): PluginSettingView[] =>
		p.installed ? p.settings.filter((s) => s.current === undefined) : p.settings;

	/** Each asked setting's starting answer: what the plugins file has, else its default. */
	export const initialAnswers = (p: PluginPreview): Record<string, string> =>
		Object.fromEntries(askedSettings(p).map((s) => [s.key, answerText(s.current ?? s.default)]));

	/** A required setting with no answer, or null when the review can go ahead. */
	export const missingSetting = (p: PluginPreview, answers: Record<string, string>) =>
		askedSettings(p).find((s) => s.required && !answers[s.key]?.trim()) ?? null;

	/** The answers worth sending: the filled ones. */
	export const filledAnswers = (answers: Record<string, string>) =>
		Object.fromEntries(Object.entries(answers).filter(([, v]) => v.trim() !== ''));
</script>

<script lang="ts">
	import { AlertTriangle } from '@lucide/svelte';
	import SettingsFields from './SettingsFields.svelte';

	/**
	 * What the captain agrees to before a plugin is installed or updated: what it
	 * is, where it comes from at which exact commit, what it adds and runs, the
	 * settings it asks for, and that its code runs with their permissions.
	 */
	let {
		preview: p,
		answers = $bindable(),
		busy = []
	}: { preview: PluginPreview; answers: Record<string, string>; busy?: string[] } = $props();

	const asked = $derived(askedSettings(p));
	const short = (c: string) => c.slice(0, 12);
</script>

<div class="grid gap-4">
	<div class="rounded-md border bg-card px-4 py-3">
		<p class="font-medium">
			{p.name}
			<span class="font-normal text-muted-foreground">{p.id} {p.version}</span>
		</p>
		{#if p.description}
			<p class="mt-0.5 text-xs text-muted-foreground">{p.description}</p>
		{/if}
		<dl class="mt-3 grid grid-cols-[6rem_minmax(0,1fr)] gap-x-3 gap-y-1 text-xs">
			<dt class="text-muted-foreground">From</dt>
			<dd class="font-mono break-all">{p.repository}{p.ref ? ` (${p.ref})` : ''}</dd>
			{#if p.installed}
				<dt class="text-muted-foreground">Now</dt>
				<dd class="tabular font-mono">{p.installed.version} · {short(p.installed.commit)}</dd>
			{/if}
			<dt class="text-muted-foreground">Commit</dt>
			<dd class="tabular font-mono">
				{short(p.commit)}
				{#if p.installed}
					<span class="font-sans">
						·
						<a
							class="text-sea hover:underline"
							href="https://github.com/{p.repository}/compare/{p.installed.commit}...{p.commit}"
							target="_blank"
							rel="noreferrer">compare</a
						>
					</span>
				{/if}
			</dd>
			{#if p.author}
				<dt class="text-muted-foreground">Author</dt>
				<dd>{p.author}</dd>
			{/if}
			<dt class="text-muted-foreground">Adds</dt>
			<dd>{p.slots.join(', ') || 'nothing to the pages'}{p.ui ? '; a UI bundle' : ''}</dd>
			{#if p.services.length}
				<dt class="text-muted-foreground">Runs</dt>
				<dd>{p.services.join(', ')}</dd>
			{/if}
			<dt class="text-muted-foreground">On</dt>
			<dd>{p.on}</dd>
		</dl>
	</div>

	{#if asked.length}
		<fieldset class="grid gap-3">
			<legend class="mb-1 text-xs font-medium">
				{p.installed ? 'Its new settings' : 'Its settings'}
			</legend>
			<SettingsFields settings={asked} bind:answers />
			<p class="text-xs text-muted-foreground">Kept in Wheelhouse’s plugins file.</p>
		</fieldset>
	{/if}

	<p
		class="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs"
	>
		<AlertTriangle class="mt-0.5 size-3.5 shrink-0 text-warning" />
		<span
			>Its code runs with your permissions, inside Wheelhouse and in its pages. Wheelhouse does not
			sandbox it. {p.installed ? 'Update' : 'Install'} only plugins you trust.</span
		>
	</p>
	{#if busy.length}
		<div class="text-xs text-muted-foreground">
			Wheelhouse restarts to load it, which stops:
			<ul class="mt-0.5 list-inside list-disc">
				{#each busy as b (b)}<li>{b}</li>{/each}
			</ul>
		</div>
	{/if}
</div>
