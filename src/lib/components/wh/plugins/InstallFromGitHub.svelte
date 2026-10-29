<script lang="ts">
	import { page } from '$app/state';
	import { AlertTriangle, LoaderCircle, Plus } from '@lucide/svelte';
	import * as Dialog from '$lib/components/ui/dialog';
	import { Button } from '$lib/components/ui/button';
	import { afterRestart, installPlugin, lookUp } from '$lib/client/plugins';
	import type { PluginPreview } from '$lib/updates';
	import ChangeProgress from './ChangeProgress.svelte';
	import PluginReview, {
		filledAnswers,
		initialAnswers,
		missingSetting
	} from './PluginReview.svelte';

	/**
	 * Install a plugin from a GitHub repository: name it (org/repo, and a tag,
	 * branch or commit if wanted), look it up, review what it is and answer its
	 * settings, then install it at exactly the commit shown and restart
	 * Wheelhouse to load it.
	 */
	let { busy = [] }: { busy?: string[] } = $props();

	type Step = 'form' | 'looking' | 'review' | 'saving' | 'restarting' | 'done' | 'slow';
	let open = $state(false);
	let step = $state<Step>('form');
	let repo = $state('');
	let ref = $state('');
	let error = $state<string | null>(null);
	let preview = $state<PluginPreview | null>(null);
	let answers = $state<Record<string, string>>({});

	const valid = $derived(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo.trim()));
	const missing = $derived(preview ? missingSetting(preview, answers) : null);
	const token = () => page.data.sessionToken as string;
	const field =
		'h-9 rounded-md border border-input bg-background px-2.5 font-mono text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring';

	function reset() {
		step = 'form';
		error = null;
		preview = null;
	}

	async function look(e: Event) {
		e.preventDefault();
		if (!valid || step === 'looking') return;
		step = 'looking';
		error = null;
		const r = await lookUp({ repo: repo.trim(), ref: ref.trim() || null }, token());
		if (!r.ok) {
			error = r.error;
			step = 'form';
			return;
		}
		preview = r.value;
		answers = initialAnswers(r.value);
		step = 'review';
	}

	async function install() {
		if (!preview || missing) return;
		step = 'saving';
		error = null;
		const back = afterRestart();
		const r = await installPlugin(preview, filledAnswers(answers), token());
		if (!r.ok) {
			error = r.error;
			step = 'review';
			return;
		}
		step = 'restarting';
		step = (await back) ? 'done' : 'slow';
	}
</script>

<Dialog.Root
	bind:open
	onOpenChange={(o) => {
		if (o && (step === 'done' || step === 'slow')) {
			repo = '';
			ref = '';
			reset();
		}
	}}
>
	<Dialog.Trigger>
		{#snippet child({ props })}
			<Button {...props} variant="outline" size="sm"><Plus />Install plugin</Button>
		{/snippet}
	</Dialog.Trigger>
	<Dialog.Content
		class="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-lg"
		interactOutsideBehavior={step === 'saving' || step === 'restarting' ? 'ignore' : 'close'}
	>
		<Dialog.Header>
			<Dialog.Title class="font-display text-lg">Install a plugin from GitHub</Dialog.Title>
			<Dialog.Description>
				{#if step === 'review'}
					Check what it is and where it comes from before you install it.
				{:else}
					Wheelhouse fetches the repository, pins the exact commit and shows you its manifest first.
					Nothing runs until you install it.
				{/if}
			</Dialog.Description>
		</Dialog.Header>

		{#if step === 'form' || step === 'looking'}
			<form class="grid gap-4" onsubmit={look} id="install-plugin-form">
				<label class="grid gap-1">
					<span class="text-xs font-medium">Repository</span>
					<input
						class={field}
						name="repository"
						placeholder="org/repo"
						autocomplete="off"
						spellcheck="false"
						bind:value={repo}
						oninput={() => (error = null)}
					/>
					<span class="text-xs text-muted-foreground"
						>On github.com, such as chrisjowen/improve.</span
					>
				</label>
				<label class="grid gap-1">
					<span class="text-xs font-medium"
						>Version <span class="font-normal text-muted-foreground">(optional)</span></span
					>
					<input
						class={field}
						name="ref"
						placeholder="tag, branch or commit"
						autocomplete="off"
						spellcheck="false"
						bind:value={ref}
					/>
					<span class="text-xs text-muted-foreground"
						>Leave it empty for the default branch. A tag keeps it on that release.</span
					>
				</label>
				{#if error}
					<p
						class="flex items-start gap-2 rounded-md border border-danger/40 px-3 py-2 text-xs text-danger"
						role="alert"
					>
						<AlertTriangle class="mt-0.5 size-3.5 shrink-0" />{error}
					</p>
				{/if}
			</form>
			<Dialog.Footer>
				<Dialog.Close>
					{#snippet child({ props })}<Button {...props} variant="ghost">Cancel</Button>{/snippet}
				</Dialog.Close>
				<Button type="submit" form="install-plugin-form" disabled={!valid || step === 'looking'}>
					{#if step === 'looking'}<LoaderCircle class="animate-spin" />Fetching…{:else}Look it up{/if}
				</Button>
			</Dialog.Footer>
		{:else if step === 'review' && preview}
			<PluginReview {preview} bind:answers {busy} />
			{#if error}
				<p class="text-xs text-danger" role="alert">{error}</p>
			{/if}
			<Dialog.Footer>
				<Button variant="ghost" onclick={reset}>Back</Button>
				<Button
					onclick={install}
					disabled={!!missing}
					title={missing ? `${missing.title} is needed` : undefined}>Install and restart</Button
				>
			</Dialog.Footer>
		{:else if preview}
			<ChangeProgress
				label="Install {preview.id} at {preview.commit.slice(0, 7)}"
				phase={step === 'saving' || step === 'restarting' || step === 'done' || step === 'slow'
					? step
					: 'saving'}
			/>
			{#if step === 'done'}
				<p>
					{preview.name}
					{preview.version} is installed and Wheelhouse restarted. Its row shows whether it loaded.
				</p>
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
