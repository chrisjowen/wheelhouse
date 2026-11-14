<script lang="ts">
	import {
		agentName,
		authOptions,
		defaultChoice,
		SETUP_AGENTS,
		type AgentChoice,
		type SetupAgent
	} from '$lib/agent';

	/**
	 * The setup wizard's agent choice: which agent Firstmate runs in, then how it
	 * is paid for. A way that is not ready shows as coming soon and cannot be
	 * chosen. Paying through the cloud product shows only on a machine it made
	 * (`cloud`).
	 */
	let {
		choice,
		cloud = false,
		disabled = false,
		onchoose
	}: {
		choice: AgentChoice;
		cloud?: boolean;
		disabled?: boolean;
		onchoose: (c: AgentChoice) => void;
	} = $props();

	const options = $derived(authOptions(choice.agent, cloud));
	const pick = (agent: SetupAgent) => agent !== choice.agent && onchoose(defaultChoice(agent));
	const isChosen = (o: AgentChoice) => o.auth === choice.auth && o.provider === choice.provider;
</script>

<div class="grid gap-2 sm:grid-cols-3" role="radiogroup" aria-label="Agent">
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
