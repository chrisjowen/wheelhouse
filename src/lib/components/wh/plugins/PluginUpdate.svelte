<script lang="ts">
	import { page } from '$app/state';
	import { AlertTriangle, Check, CircleArrowUp, LoaderCircle } from '@lucide/svelte';
	import * as Dialog from '$lib/components/ui/dialog';
	import { Button } from '$lib/components/ui/button';
	import { afterRestart, lookUp, updatePlugin } from '$lib/client/plugins';
	import type { PluginPreview, PluginUpdateView } from '$lib/updates';
	import ChangeProgress from './ChangeProgress.svelte';
	import PluginReview, {
		filledAnswers,
		initialAnswers,
		missingSetting
	} from './PluginReview.svelte';

	/**
	 * An installed plugin's update state on its Plugins row, and its update:
	 * look up what updating moves to (its branch's newest commit, or a newer
	 * release tag), review it and any new settings, then update and restart.
	 */
	let {
		update: u,
		name,
		checking = false,
		busy = []
	}: { update: PluginUpdateView; name: string; checking?: boolean; busy?: string[] } = $props();

	type Step = 'looking' | 'review' | 'saving' | 'restarting' | 'done' | 'slow' | 'failed';
	let open = $state(false);
	let step = $state<Step>('looking');
	let error = $state<string | null>(null);
	let preview = $state<PluginPreview | null>(null);
	let answers = $state<Record<string, string>>({});
	const missing = $derived(preview ? missingSetting(preview, answers) : null);
	const token = () => page.data.sessionToken as string;

	async function begin() {
		open = true;
		step = 'looking';
		error = null;
		preview = null;
		// A newer tag moves the plugin to it; anything else fetches its own ref again.
		const ref = u.state === 'newer-tag' ? (u.latest?.ref ?? null) : null;
		const r = await lookUp({ id: u.id, ref }, token());
		if (!r.ok) {
			error = r.error;
			step = 'failed';
			return;
		}
		preview = r.value;
		answers = initialAnswers(r.value);
		step = 'review';
	}

	async function go() {
		if (!preview || missing) return;
		step = 'saving';
		error = null;
		const back = afterRestart();
		const r = await updatePlugin(preview, filledAnswers(answers), token());
		if (!r.ok) {
			error = r.error;
			step = 'review';
			return;
		}
		step = 'restarting';
		step = (await back) ? 'done' : 'slow';
	}
</script>

<div
	class="flex flex-wrap items-center justify-end gap-2 text-xs sm:min-w-48"
	data-update={u.state}
>
	{#if checking}
		<span class="flex items-center gap-1.5 text-muted-foreground"
			><LoaderCircle class="size-3.5 animate-spin" />Checking…</span
		>
	{:else if u.state === 'current'}
		<span class="flex items-center gap-1.5 text-muted-foreground"
			><Check class="size-3.5 text-success" />Up to date</span
		>
	{:else if u.state === 'pinned'}
		<span class="text-muted-foreground" title="Installed at a commit, so it is not checked"
			>Pinned to a commit</span
		>
	{:else if u.state === 'error'}
		<span class="flex items-center gap-1.5 text-muted-foreground" title={u.reason ?? undefined}
			><AlertTriangle class="size-3.5 text-warning" />Could not check</span
		>
	{:else}
		<span class="text-sea">
			{u.state === 'newer-tag'
				? `${u.latest?.ref} is out`
				: `New commits${u.ref ? ` on ${u.ref}` : ''}`}
		</span>
		<Button variant="outline" size="xs" onclick={begin}
			><CircleArrowUp />{u.state === 'newer-tag' ? `Move to ${u.latest?.ref}` : 'Update'}</Button
		>
	{/if}
</div>

<Dialog.Root bind:open>
	<Dialog.Content
		class="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-lg"
		interactOutsideBehavior={step === 'saving' || step === 'restarting' ? 'ignore' : 'close'}
	>
		<Dialog.Header>
			<Dialog.Title class="font-display text-lg">Update {name}</Dialog.Title>
			<Dialog.Description class="tabular">
				{#if preview}
					{u.version} → {preview.version}{u.state === 'newer-tag' && u.ref
						? `, from ${u.ref} to ${preview.ref}`
						: ''}
				{:else}
					{u.repository}
				{/if}
			</Dialog.Description>
		</Dialog.Header>

		{#if step === 'looking'}
			<p class="flex items-center gap-2 text-muted-foreground">
				<LoaderCircle class="size-4 animate-spin" />Fetching {u.repository}…
			</p>
		{:else if step === 'failed'}
			<p class="flex items-start gap-2 text-xs text-danger" role="alert">
				<AlertTriangle class="mt-0.5 size-3.5 shrink-0" />{error}
			</p>
			<Dialog.Footer>
				<Dialog.Close>
					{#snippet child({ props })}<Button {...props} variant="ghost">Close</Button>{/snippet}
				</Dialog.Close>
			</Dialog.Footer>
		{:else if step === 'review' && preview}
			<PluginReview {preview} bind:answers {busy} />
			{#if error}
				<p class="text-xs text-danger" role="alert">{error}</p>
			{/if}
			<Dialog.Footer>
				<Dialog.Close>
					{#snippet child({ props })}<Button {...props} variant="ghost">Cancel</Button>{/snippet}
				</Dialog.Close>
				<Button
					onclick={go}
					disabled={!!missing}
					title={missing ? `${missing.title} is needed` : undefined}>Update and restart</Button
				>
			</Dialog.Footer>
		{:else if preview}
			<ChangeProgress
				label="Replace {u.id} with {preview.version} at {preview.commit.slice(0, 7)}"
				phase={step === 'saving' || step === 'restarting' || step === 'done' || step === 'slow'
					? step
					: 'saving'}
			/>
			{#if step === 'done'}
				<p>{name} {preview.version} is installed and loaded.</p>
			{/if}
			<Dialog.Footer>
				<Dialog.Close>
					{#snippet child({ props })}<Button
							{...props}
							disabled={step === 'saving' || step === 'restarting'}>Done</Button
						>{/snippet}
				</Dialog.Close>
			</Dialog.Footer>
		{/if}
	</Dialog.Content>
</Dialog.Root>
