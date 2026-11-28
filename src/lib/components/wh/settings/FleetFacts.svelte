<script lang="ts">
	import type { FleetView } from '$lib/fleet';
	import { ago } from '$lib/format';

	/**
	 * The fleet this ship is in, in rows: which fleet and its plan, the captain's role and
	 * teams there, this ship, the gateway and when it was last asked (Settings → Fleet, and
	 * Fleet → Overview while Fleet is on).
	 */
	let { view, now }: { view: FleetView; now: number } = $props();

	const current = $derived(view.gateways.find((g) => g.active) ?? null);
	const host = (url: string) => URL.parse(url)?.host ?? url;
	const ROLES: Record<string, string> = {
		owner: 'Owner',
		admin: 'Admin',
		billing: 'Billing',
		member: 'Member'
	};
</script>

<dl class="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-[10rem_1fr]">
	{#if view.fleet}
		<dt class="text-muted-foreground">Fleet</dt>
		<dd data-testid="fleet-name">
			{view.fleet.kind === 'personal'
				? 'Your own fleet'
				: 'Company fleet'}{#if view.fleet.plan}<span class="ml-1.5 text-muted-foreground"
					>· {view.fleet.plan} plan</span
				>{/if}
		</dd>
		<dt class="text-muted-foreground">Your role</dt>
		<dd>
			{view.fleet.role
				? (ROLES[view.fleet.role] ?? view.fleet.role)
				: 'Not a member'}{#if view.fleet.person}<span class="ml-1.5 text-muted-foreground"
					>· {view.fleet.person}</span
				>{/if}
		</dd>
		{#if view.fleet.teams.length}
			<dt class="text-muted-foreground">Teams</dt>
			<dd>
				{view.fleet.teams
					.map((t) => `${t.name}${t.role === 'member' ? '' : ` (${ROLES[t.role] ?? t.role})`}`)
					.join(', ')}
			</dd>
		{/if}
	{/if}
	{#if view.ship}
		<dt class="text-muted-foreground">This ship</dt>
		<dd>
			{view.ship.name}
			<span class="tabular text-muted-foreground">· {view.ship.fingerprint}</span>
		</dd>
	{/if}
	<dt class="text-muted-foreground">Gateway</dt>
	<dd>
		{current?.name ?? (view.fleetyard ? 'Fleetyard' : host(view.gateway))}<span
			class="ml-1.5 text-muted-foreground">· {host(view.gateway)}</span
		>
	</dd>
	<dt class="text-muted-foreground">Last checked</dt>
	<dd data-testid="fleet-checked">
		{view.checkedAt ? ago(view.checkedAt, now) : 'Asking the gateway…'}
	</dd>
</dl>
