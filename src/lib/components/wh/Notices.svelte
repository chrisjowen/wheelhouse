<script lang="ts">
	import { dev } from '$app/environment';
	import { page } from '$app/state';
	import { currentFleet, currentHealth, live } from '$lib/client/live.svelte';
	import { remoteSession } from '$lib/client/remote-session.svelte';
	import { notices, sampleNoticeInput } from '$lib/notices';
	import NoticeStrip from './NoticeStrip.svelte';

	// In development only, `?notices=server,watch,stale` shows made-up conditions to try the strip.
	const sample = $derived(dev ? page.url.searchParams.get('notices') : null);
	const items = $derived(
		notices(
			sample !== null
				? sampleNoticeInput(sample, live.now)
				: {
						// An offline machine or an ended remote session is said above, with what to do.
						connectionLost: live.connection === 'lost' && remoteSession.state === 'live',
						health: currentHealth(),
						fleet: currentFleet(),
						now: live.now
					}
		)
	);
</script>

<NoticeStrip {items} />
