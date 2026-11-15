<script lang="ts">
	import type { MateLinkStatus } from '$lib/matelink';
	import type { MateHealth } from '$lib/types';

	/**
	 * A second mate's online state as a small pill: words and a dot, never colour
	 * alone. One on a Fleetyard machine says its link's state once it is known.
	 */
	let { health, link = null }: { health: MateHealth; link?: MateLinkStatus | null } = $props();
	const TONE = {
		online: 'bg-success/10 text-success',
		offline: 'bg-warning/10 text-warning',
		unknown: 'bg-danger/10 text-danger'
	} as const;
	const WORD = { online: 'Online', offline: 'Offline', unknown: 'Not readable' } as const;
	const LINK = {
		linked: { word: 'Linked', tone: TONE.online },
		down: { word: 'Can’t reach', tone: TONE.offline },
		pending: { word: 'Not linked yet', tone: TONE.offline }
	} as const;
	const shown = $derived(link && link.health !== 'unknown' ? LINK[link.health] : null);
	// A copy this read could not refresh is shown as such, not as a host that is down.
	const word = $derived(shown?.word ?? (health.cached ? 'Last report' : WORD[health.online]));
	const tone = $derived(shown?.tone ?? (health.cached ? TONE.offline : TONE[health.online]));
</script>

<span
	class="flex items-center gap-1 rounded px-1.5 text-xs leading-[1.15rem] font-medium {tone}"
	title={link?.problem?.text ?? health.reason ?? health.text}
	data-mate-online={health.online}
	data-link-health={link?.health}
	><span class="size-1.5 rounded-full bg-current" aria-hidden="true"></span>{word}</span
>
