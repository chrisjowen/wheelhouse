<!-- PROTOTYPE: the Passage tab (how work moves, and where each piece is), and a stand-in for
     a plugin's own tab, which shows its page exactly as it does today. -->
<script lang="ts">
	import { STAGES, type FakeProject } from './prototype-data';

	let { project: p, tab }: { project: FakeProject; tab: string } = $props();

	const at = (i: number) => p.tasks.filter((t) => t.stage === i && (i < 5 || t.since < 7 * 1440));
</script>

{#if tab === 'Passage'}
	<section class="surface p-5 sm:p-6" aria-labelledby="pa">
		<h2 id="pa" class="section-label mb-1">Passage</h2>
		<p class="mb-5 text-sm text-muted-foreground">{p.ships}</p>
		<ol class="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
			{#each STAGES as s, i (s)}
				<li
					class="rounded-md border border-hair px-4 py-3 {at(i).length
						? 'bg-card'
						: 'bg-transparent'}"
				>
					<p class="text-xs text-muted-foreground">Step {i + 1}</p>
					<p class="font-medium">{s}</p>
					<p
						class="tabular mt-2 font-display text-[1.6rem] leading-none {at(i).length
							? ''
							: 'text-muted-foreground/50'}"
					>
						{at(i).length}
					</p>
					{#each at(i) as t (t.id)}<p class="mt-1 truncate text-xs text-muted-foreground">
							{t.title}
						</p>{/each}
				</li>
			{/each}
		</ol>
		{#if p.passageProblem}<p class="mt-4 text-sm text-danger">{p.passageProblem}</p>{/if}
		<a
			href="#top"
			class="mt-4 inline-block text-sm text-muted-foreground hover:text-foreground hover:underline"
			>Change how it ships</a
		>
	</section>
{:else}
	<div class="surface p-6">
		<h2 class="font-display text-xl">{tab}</h2>
		<p class="mt-2 max-w-2xl text-muted-foreground">
			The {tab} plugin's own page shows here, unchanged, inside the project. Every plugin tab a project
			has sits in this row, so the project is one place to look.
		</p>
	</div>
{/if}
