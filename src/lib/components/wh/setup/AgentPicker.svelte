<script lang="ts">
	import {
		agentName,
		authOptions,
		defaultChoice,
		SETUP_AGENTS,
		type AgentChoice,
		type SetupAgent
	} from '$lib/agent';
	import type { HelperProgram, HelperSetting } from '$lib/helperchoice';

	/**
	 * The setup wizard's agent choice: which agent Firstmate runs in, then how it
	 * is paid for. A way that is not ready shows as coming soon and cannot be
	 * chosen. Paying through the cloud product shows only on a machine it made
	 * (`cloud`). Below that, Wheelhouse's own helper: the preview helper and
	 * feedback summaries, chosen apart from Firstmate's agent. `only="helper"`
	 * is that choice on its own.
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
		onhelper?: (program: HelperProgram) => void;
	} = $props();

	const options = $derived(authOptions(choice.agent, cloud));
	const pick = (agent: SetupAgent) => agent !== choice.agent && onchoose(defaultChoice(agent));
	const isChosen = (o: AgentChoice) => o.auth === choice.auth && o.provider === choice.provider;
	/** The radio follows the program that will run, including an older `same` save. */
	const helperOn = $derived(helper?.runs ?? 'claude');
	const pickHelper = (program: HelperProgram) => helper?.choice !== program && onhelper?.(program);
</script>

{#if only !== 'helper'}
	<p class="text-xs font-medium">Firstmate’s agent</p>
	<div class="mt-2 grid gap-2 sm:grid-cols-4" role="radiogroup" aria-label="Firstmate’s agent">
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
		Wheelhouse uses its own helper for preview help and feedback summaries. Choose which agent runs
		it. It does not have to match Firstmate’s agent, and changing it does not restart Wheelhouse.
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
				aria-checked={helperOn === 'claude'}
				data-helper="claude"
				class="flex w-full items-start gap-3 px-4 py-3 text-left text-sm hover:bg-muted/50 disabled:cursor-not-allowed"
				disabled={helperDisabled}
				onclick={() => pickHelper('claude')}
			>
				<span
					class="mt-0.5 size-3.5 shrink-0 rounded-full border {helperOn === 'claude'
						? 'border-sea bg-sea'
						: ''}"
					aria-hidden="true"
				></span>
				<span class="min-w-0 flex-1">
					<span class="block font-medium">Claude Code</span>
					<span class="block text-xs text-muted-foreground">The helper runs on Claude Code.</span>
				</span>
			</button>
		</li>
		<li>
			<button
				type="button"
				role="radio"
				aria-checked={helperOn === 'grok'}
				data-helper="grok"
				class="flex w-full items-start gap-3 px-4 py-3 text-left text-sm hover:bg-muted/50 disabled:cursor-not-allowed"
				disabled={helperDisabled}
				onclick={() => pickHelper('grok')}
			>
				<span
					class="mt-0.5 size-3.5 shrink-0 rounded-full border {helperOn === 'grok'
						? 'border-sea bg-sea'
						: ''}"
					aria-hidden="true"
				></span>
				<span class="min-w-0 flex-1">
					<span class="block font-medium">Grok</span>
					<span class="block text-xs text-muted-foreground">The helper runs on Grok.</span>
				</span>
			</button>
		</li>
	</ul>
	{#if helper.choice === 'same'}
		<p class="mt-2 max-w-prose text-xs text-muted-foreground" data-helper-saved-same>
			{helper.fallback ??
				`The helper was set to follow Firstmate’s agent, so it runs on ${helper.runs === 'grok' ? 'Grok' : 'Claude Code'} for now.`}
			Choose Claude Code or Grok to set it on its own.
		</p>
	{/if}
	{#if helper.notice}
		<p class="mt-2 max-w-prose text-xs text-warning" data-helper-notice>{helper.notice}</p>
	{/if}
{/if}
