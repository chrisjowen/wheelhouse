<script lang="ts">
	import { dev } from '$app/environment';
	import { page } from '$app/state';
	import { currentFleet, currentHealth, live } from '$lib/client/live.svelte';
	import { notices, sampleNoticeInput } from '$lib/notices';
	import NoticeStrip from './NoticeStrip.svelte';

	// In development, `?notices=lost,watch,stale` shows made-up conditions to try the strip.
	const sample = $derived(dev ? page.url.searchParams.get('notices') : null);
	const items = $derived(
		notices(
			sample !== null
				? sampleNoticeInput(sample, live.now)
				: {
						connectionLost: live.connection === 'lost',
						health: currentHealth(),
						fleet: currentFleet(),
						now: live.now
					}
		)
	);
</script>

<NoticeStrip {items} />
