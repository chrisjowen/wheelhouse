<script lang="ts">
	import {
		agentName,
		authOptions,
		defaultChoice,
		SETUP_AGENTS,
		type AgentChoice,
		type SetupAgent
	} from '$lib/agent';
	import type { HelperChoice, HelperSetting } from '$lib/helperchoice';

	/**
	 * The setup wizard's agent choice: which agent Firstmate runs in, then how it
	 * is paid for. A way that is not ready shows as coming soon and cannot be
	 * chosen. Paying through the cloud product shows only on a machine it made
	 * (`cloud`). Below that, Wheelhouse's own helper: the preview helper and
	 * feedback summaries. `only="helper"` is that choice on its own.
	 */
	let {
		choice,
		cloud = false,
		disabled = false,
		helperDisabled = false,
		helper = null,
		only = 'all',
		onchoose,
		onhelper
	}: {
		choice: AgentChoice;
		cloud?: boolean;
		disabled?: boolean;
		/** The helper can change while the agent is locked by --harness. */
		helperDisabled?: boolean;
		helper?: HelperSetting | null;
		only?: 'all' | 'helper';
		onchoose: (c: AgentChoice) => void;
		onhelper?: (choice: HelperChoice) => void;
	} = $props();

	const options = $derived(authOptions(choice.agent, cloud));
	const pick = (agent: SetupAgent) => agent !== choice.agent && onchoose(defaultChoice(agent));
	const isChosen = (o: AgentChoice) => o.auth === choice.auth && o.provider === choice.provider;
	const helperOn = $derived(helper?.choice === 'same' ? 'same' : 'claude');
	const sameDetail = $derived(
		helper?.fallback ??
			(helper?.runs === 'grok'
				? 'Follows Firstmate’s agent, so this runs on Grok.'
				: 'Follows Firstmate’s agent. Codex, Pi and OpenCode use Claude Code.')
	);
</script>

{#if only !== 'helper'}
	<div class="grid gap-2 sm:grid-cols-4" role="radiogroup" aria-label="Agent">
		{#each SETUP_AGENTS as agent (agent)}
			<button
				type="button"
				role="radio"
				aria-checked={choice.agent === agent}
				data-agent={agent}
				class="rounded-lg border px-4 py-3 text-left text-sm disabled:cursor-not-allowed disabled:opacity-60 {choice.agent ===
				agent
					? 'border-sea ring-1 ring-sea'
					: 'hover:bg-muted/50'}"
				{disabled}
				onclick={() => pick(agent)}
			>
				<span class="block font-medium">{agentName(agent)}</span>
			</button>
		{/each}
	</div>

	<p class="mt-5 text-xs font-medium">Paid with</p>
	<ul class="mt-2 divide-y rounded-lg border bg-card" role="radiogroup" aria-label="Paid with">
		{#each options as o (`${o.auth}/${o.provider}`)}
			<li>
				<button
					type="button"
					role="radio"
					aria-checked={isChosen(o)}
					aria-disabled={!o.ready}
					data-auth={o.auth}
					data-provider={o.provider ?? ''}
					data-ready={String(o.ready)}
					class="flex w-full items-start gap-3 px-4 py-3 text-left text-sm disabled:cursor-not-allowed {o.ready
						? 'hover:bg-muted/50'
						: 'opacity-60'}"
					disabled={disabled || !o.ready}
					onclick={() => !isChosen(o) && onchoose(o)}
				>
					<span
						class="mt-0.5 size-3.5 shrink-0 rounded-full border {isChosen(o)
							? 'border-sea bg-sea'
							: ''}"
						aria-hidden="true"
					></span>
					<span class="min-w-0 flex-1">
						<span class="block font-medium">{o.label}</span>
						<span class="block text-xs text-muted-foreground">{o.detail}</span>
					</span>
					{#if !o.ready}
						<span class="shrink-0 rounded-full border px-2 py-0.5 text-xs text-muted-foreground"
							>Coming soon</span
						>
					{/if}
				</button>
			</li>
		{/each}
	</ul>
{/if}

{#if helper}
	<p class="{only === 'helper' ? 'mt-0' : 'mt-5'} text-xs font-medium">Wheelhouse’s own helper</p>
	<p class="mt-1 max-w-prose text-xs text-muted-foreground">
		The preview helper and feedback summaries. Same as Firstmate’s agent follows Grok when that is
		the agent. Choosing it does not restart Wheelhouse.
	</p>
	<ul
		class="mt-2 divide-y rounded-lg border bg-card"
		role="radiogroup"
		aria-label="Wheelhouse’s own helper"
	>
		<li>
			<button
				type="button"
				role="radio"
				aria-checked={helperOn === 'same'}
				data-helper="same"
				class="flex w-full items-start gap-3 px-4 py-3 text-left text-sm hover:bg-muted/50 disabled:cursor-not-allowed"
				disabled={helperDisabled}
				onclick={() => helperOn !== 'same' && onhelper?.('same')}
			>
				<span
					class="mt-0.5 size-3.5 shrink-0 rounded-full border {helperOn === 'same'
						? 'border-sea bg-sea'
						: ''}"
					aria-hidden="true"
				></span>
				<span class="min-w-0 flex-1">
					<span class="block font-medium">Same as Firstmate’s agent</span>
					<span class="block text-xs text-muted-foreground">{sameDetail}</span>
				</span>
			</button>
		</li>
		<li>
			<button
				type="button"
				role="radio"
				aria-checked={helperOn === 'claude'}
				data-helper="claude"
				class="flex w-full items-start gap-3 px-4 py-3 text-left text-sm hover:bg-muted/50 disabled:cursor-not-allowed"
				disabled={helperDisabled}
				onclick={() => helperOn !== 'claude' && onhelper?.('claude')}
			>
				<span
					class="mt-0.5 size-3.5 shrink-0 rounded-full border {helperOn === 'claude'
						? 'border-sea bg-sea'
						: ''}"
					aria-hidden="true"
				></span>
				<span class="min-w-0 flex-1">
					<span class="block font-medium">Claude Code</span>
					<span class="block text-xs text-muted-foreground">
						Always Claude Code, including when Firstmate runs in Grok.
						{#if helper.choice === null}This install has not chosen, so it stays here.{/if}
					</span>
				</span>
			</button>
		</li>
	</ul>
{/if}
