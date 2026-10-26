<script lang="ts">
	import { CalendarCheck, CalendarClock, CalendarOff } from '@lucide/svelte';
	import type { HarnessView } from './types';

	/** Whether a harness review is due, as one badge; the full reason is its tooltip. */
	let { review }: { review: HarnessView['review'] } = $props();
	const b = $derived(
		review.due === true
			? {
					icon: CalendarClock,
					label: 'Review due',
					cls: 'border-sea bg-sea text-white dark:text-slate-950'
				}
			: review.due === false
				? {
						icon: CalendarCheck,
						label: 'No review due',
						cls: 'border-success/40 bg-success/10 text-success'
					}
				: { icon: CalendarOff, label: 'Not scheduled', cls: 'border-hair text-muted-foreground' }
	);
	const Icon = $derived(b.icon);
</script>

<span
	class="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap {b.cls}"
	title={review.headline}
>
	<Icon class="size-3.5" aria-hidden="true" />{b.label}
</span>
