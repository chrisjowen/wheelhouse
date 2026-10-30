<!--
  PROTOTYPE (throwaway): three directions for one page that merges Projects and Harbour, with
  a redesigned project card and a drill-in to one project, on made-up data. Shown on
  /projects in development only, when the address has ?variant=A|B|C (switch with the
  floating bar, or ← →); &project=<name> opens a project, &tab= one of its tabs, &notes=off
  hides the numbered notes.
-->
<script lang="ts">
	import { page } from '$app/state';
	import { PROJECTS } from './prototype-data';
	import ProjectPage from './ProjectPage.svelte';
	import Switcher from './Switcher.svelte';
	import VariantBerths from './VariantBerths.svelte';
	import VariantLogbook from './VariantLogbook.svelte';
	import VariantWatch from './VariantWatch.svelte';

	const VARIANTS = [
		{ key: 'A', name: 'Berths: a card per project' },
		{ key: 'B', name: 'Logbook: a line per project' },
		{ key: 'C', name: 'Watch: what is happening, by project' }
	];
	const q = $derived(page.url.searchParams);
	const variant = $derived(
		VARIANTS.some((v) => v.key === q.get('variant')) ? q.get('variant')! : 'A'
	);
	const notes = $derived(q.get('notes') !== 'off');
	const project = $derived(PROJECTS.find((p) => p.id === q.get('project')) ?? null);

	/** A link to this page with some parameters changed (null removes one). */
	function link(changes: Record<string, string | null>): string {
		const url = new URL(page.url);
		if ('project' in changes) url.searchParams.delete('tab');
		for (const [k, v] of Object.entries(changes)) {
			if (v === null) url.searchParams.delete(k);
			else url.searchParams.set(k, v);
		}
		return `${url.pathname}${url.search}`;
	}
</script>

{#if variant === 'C'}
	<VariantWatch
		projects={PROJECTS}
		{project}
		tab={q.get('tab')}
		whole={q.get('log') === 'week'}
		{link}
		{notes}
	/>
{:else if project}
	<ProjectPage {project} tab={q.get('tab')} {link} {notes} />
{:else if variant === 'B'}
	<VariantLogbook projects={PROJECTS} open={q.get('open')} {link} {notes} />
{:else}
	<VariantBerths projects={PROJECTS} filter={q.get('filter')} {link} {notes} />
{/if}

<Switcher variants={VARIANTS} />
