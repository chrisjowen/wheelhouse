<script lang="ts">
	import { page } from '$app/state';
	import * as Dialog from '$lib/components/ui/dialog';
	import { Button } from '$lib/components/ui/button';
	import { afterRestart, installPlugin } from '$lib/client/plugins';
	import type { PluginPreview } from '$lib/updates';
	import ChangeProgress from './ChangeProgress.svelte';
	import PluginReview, {
		filledAnswers,
		initialAnswers,
		missingSetting
	} from './PluginReview.svelte';

	/**
	 * Installing a plugin found in a registry, once it has been looked up: the
	 * same review the Plugins page shows (what it is, the exact commit, what it
	 * adds and runs, its settings, that its code runs with your permissions),
	 * then **Install and restart**, its progress, and whether it loaded.
	 */
	let {
		preview,
		busy = [],
		onclose,
		oninstalled
	}: {
		/** The plugin as looked up; the dialog is open while there is one. */
		preview: PluginPreview | null;
		busy?: string[];
		onclose: () => void;
		/** It was kept (true once Wheelhouse is back, false when it is slow to come back). */
		oninstalled?: (p: PluginPreview, back: boolean) => void;
	} = $props();

	type Step = 'review' | 'saving' | 'restarting' | 'done' | 'slow';
	let step = $state<Step>('review');
	let error = $state<string | null>(null);
	let answers = $state<Record<string, string>>({});
	let shownFor: PluginPreview | null = null;

	$effect(() => {
		if (preview && preview !== shownFor) {
			shownFor = preview;
			step = 'review';
			error = null;
			answers = initialAnswers(preview);
		}
	});

	const missing = $derived(preview ? missingSetting(preview, answers) : null);
	const working = $derived(step === 'saving' || step === 'restarting');

	async function install() {
		if (!preview || missing) return;
		const p = preview;
		step = 'saving';
		error = null;
		const back = afterRestart();
		const r = await installPlugin(p, filledAnswers(answers), page.data.sessionToken as string);
		if (!r.ok) {
			error = r.error;
			step = 'review';
			return;
		}
		step = 'restarting';
		const ok = await back;
		step = ok ? 'done' : 'slow';
		oninstalled?.(p, ok);
	}
</script>

<Dialog.Root
	open={!!preview}
	onOpenChange={(o) => {
		if (!o && !working) onclose();
	}}
>
	<Dialog.Content
		class="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-lg"
		interactOutsideBehavior={working ? 'ignore' : 'close'}
		escapeKeydownBehavior={working ? 'ignore' : 'close'}
	>
		{#if preview}
			<Dialog.Header>
				<Dialog.Title class="font-display text-lg">Install {preview.name}</Dialog.Title>
				<Dialog.Description>
					{#if step === 'review'}
						Check what it is and where it comes from. Nothing runs until you install it.
					{:else}
						Installing restarts Wheelhouse to load it; Firstmate and its crew keep running.
					{/if}
				</Dialog.Description>
			</Dialog.Header>
			{#if step === 'review'}
				<PluginReview {preview} bind:answers {busy} />
				{#if error}
					<p class="text-xs text-danger" role="alert">{error}</p>
				{/if}
				<Dialog.Footer>
					<Button variant="ghost" onclick={onclose}>Cancel</Button>
					<Button
						onclick={install}
						disabled={!!missing}
						title={missing ? `${missing.title} is needed` : undefined}>Install and restart</Button
					>
				</Dialog.Footer>
			{:else}
				<ChangeProgress label="Install {preview.id} at {preview.commit.slice(0, 7)}" phase={step} />
				{#if step === 'done'}
					<p class="text-sm">
						{preview.name}
						{preview.version} is installed and Wheelhouse restarted. Find it in
						<a class="text-sea hover:underline" href="/settings/plugins/{preview.id}"
							>Settings → Plugins</a
						>.
					</p>
				{/if}
				<Dialog.Footer>
					<Button onclick={onclose} disabled={working}>Done</Button>
				</Dialog.Footer>
			{/if}
		{/if}
	</Dialog.Content>
</Dialog.Root>
