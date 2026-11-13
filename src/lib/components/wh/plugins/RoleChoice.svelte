<script lang="ts">
	import { ROLE_WORDS } from '$lib/plugins/words';
	import type { RoleView } from '$lib/plugins/types';

	/**
	 * Which plugin does one part of Wheelhouse a plugin can take over (a role,
	 * lib/plugins/types.ts ROLES), or Wheelhouse's own built-in: one choice
	 * among the built-in and every loaded plugin that provides it. A plugin that
	 * is off cannot be chosen until it is turned on; a chosen one that is off
	 * says the built-in is in use meanwhile.
	 */
	let {
		view,
		disabled = false,
		onchoose
	}: { view: RoleView; disabled?: boolean; onchoose: (id: string | null) => void } = $props();

	const words = $derived(ROLE_WORDS[view.role]);
	const chosenOff = $derived(
		view.chosen !== null && view.active === null
			? (view.providers.find((p) => p.id === view.chosen)?.name ?? view.chosen)
			: null
	);
	const option =
		'flex items-start gap-2 rounded-md px-2 py-1.5 text-sm has-[:disabled]:text-muted-foreground has-[:enabled]:cursor-pointer has-[:enabled]:hover:bg-accent';
</script>

<fieldset class="rounded-lg border bg-card px-4 py-3" data-role={view.role}>
	<legend class="px-1 text-sm font-medium">{words.title}</legend>
	<p class="text-xs text-muted-foreground">
		Where you review what the crew shows you. A plugin chosen here replaces Lavish and the preview
		helper while it is on; turning it off or removing it brings them back.
	</p>
	<div class="mt-2 grid gap-0.5">
		<label class={option}>
			<input
				type="radio"
				name="role-{view.role}"
				class="mt-1"
				checked={view.chosen === null}
				{disabled}
				onchange={() => onchoose(null)}
			/>
			<span>{words.builtin}</span>
		</label>
		{#each view.providers as p (p.id)}
			<label class={option} data-provider={p.id}>
				<input
					type="radio"
					name="role-{view.role}"
					class="mt-1"
					checked={view.chosen === p.id}
					disabled={disabled || (!p.on && view.chosen !== p.id)}
					onchange={() => onchoose(p.id)}
				/>
				<span
					>{p.name}{#if !p.on}<span class="text-xs text-muted-foreground">
							· off; turn it on below to choose it</span
						>{/if}</span
				>
			</label>
		{/each}
	</div>
	{#if chosenOff}
		<p class="mt-2 text-xs text-warning" data-role-off>
			{chosenOff} is chosen but off, so the built-in is in use until it is on again.
		</p>
	{/if}
</fieldset>
