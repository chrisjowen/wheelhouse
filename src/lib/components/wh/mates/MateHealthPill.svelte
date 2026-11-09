<script lang="ts">
	import type { MateHealth } from '$lib/types';

	/** A second mate's online state as a small pill: words and a dot, never colour alone. */
	let { health }: { health: MateHealth } = $props();
	const TONE = {
		online: 'bg-success/10 text-success',
		offline: 'bg-warning/10 text-warning',
		unknown: 'bg-danger/10 text-danger'
	} as const;
	const WORD = { online: 'Online', offline: 'Offline', unknown: 'Not readable' } as const;
</script>

<span
	class="flex items-center gap-1 rounded px-1.5 text-xs leading-[1.15rem] font-medium {TONE[
		health.online
	]}"
	title={health.reason ?? health.text}
	data-mate-online={health.online}
	><span class="size-1.5 rounded-full bg-current" aria-hidden="true"></span>{WORD[
		health.online
	]}{health.cached ? ' (last report)' : ''}</span
>
