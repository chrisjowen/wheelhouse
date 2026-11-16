<script lang="ts">
	import { untrack } from 'svelte';
	import { page } from '$app/state';
	import { Lock } from '@lucide/svelte';
	import { SESSION_HEADER } from '$lib/client/messages';
	import SettingsNav from '$lib/components/wh/settings/SettingsNav.svelte';
	import type { CrewSettings, CrewToolsView } from '$lib/live/tools';

	/**
	 * Settings → Discussion: what the discussion crew in Live mode may use.
	 * Tools (web search, web fetch, read-only files in Firstmate's home and its
	 * project clones) are on by default; the MCP servers Firstmate's Claude Code
	 * has are listed as they are found, each on unless it fails to connect; the
	 * captain's installed skills are off until picked. Changing the fleet is not
	 * a choice here: the crew suggests, and hands it to Firstmate.
	 */
	let { data } = $props();

	let view = $state<CrewToolsView>(untrack(() => data.tools));
	let busy = $state(false);
	let problem = $state('');

	async function save(next: CrewSettings) {
		busy = true;
		problem = '';
		try {
			const r = await fetch('/api/live/settings', {
				method: 'POST',
				headers: {
					'content-type': 'application/json',
					[SESSION_HEADER]: page.data.sessionToken as string
				},
				body: JSON.stringify(next)
			});
			if (!r.ok) throw new Error('Could not save this setting.');
			view = (await r.json()) as CrewToolsView;
		} catch (error) {
			problem = (error as Error).message;
		} finally {
			busy = false;
		}
	}

	const TOOLS: { id: keyof CrewSettings['tools']; title: string; detail: string }[] = [
		{ id: 'webSearch', title: 'Web search', detail: 'Look things up on the web.' },
		{ id: 'webFetch', title: 'Web fetch', detail: 'Read a web page it was given or found.' },
		{
			id: 'files',
			title: 'Read files',
			detail:
				'Read reports and project files in Firstmate’s home and its project clones. Read only.'
		}
	];
	const setTool = (id: keyof CrewSettings['tools'], on: boolean) =>
		save({ ...view.settings, tools: { ...view.settings.tools, [id]: on } });
	const setServer = (name: string, on: boolean) =>
		save({ ...view.settings, mcp: { ...view.settings.mcp, [name]: on } });
	const setSkill = (name: string, on: boolean) =>
		save({
			...view.settings,
			skills: on ? [...view.settings.skills, name] : view.settings.skills.filter((s) => s !== name)
		});
</script>

<svelte:head><title>Discussion · Wheelhouse</title></svelte:head>

{#snippet row(
	title: string,
	detail: string,
	checked: boolean,
	onchange: (on: boolean) => void,
	note = ''
)}
	<label class="flex cursor-pointer items-start gap-4 p-4">
		<input
			class="mt-1 size-4 accent-primary"
			type="checkbox"
			{checked}
			disabled={busy}
			onchange={(e) => onchange(e.currentTarget.checked)}
		/>
		<span class="min-w-0">
			<span class="block font-medium"
				>{title}{#if note}<span class="ml-2 text-xs font-normal text-muted-foreground">{note}</span
					>{/if}</span
			>
			{#if detail}<span class="mt-1 block text-sm text-muted-foreground">{detail}</span>{/if}
		</span>
	</label>
{/snippet}

<main class="px-4 py-6 sm:px-6 lg:px-10">
	<div class="surface px-5 py-6 sm:px-8 sm:py-8">
		<SettingsNav />
		<h1 class="mt-6 text-2xl">Discussion</h1>
		<p class="mt-1 max-w-prose text-sm text-muted-foreground">
			What the discussion crew may use in Live mode. A discussion starts with exactly what is on
			here; changes apply to the next one.
		</p>

		<h2 class="mt-8 text-sm font-medium tracking-wider text-muted-foreground uppercase">Tools</h2>
		<div class="mt-3 divide-y rounded-lg border">
			{#each TOOLS as t (t.id)}
				{@render row(t.title, t.detail, view.settings.tools[t.id], (on) => setTool(t.id, on))}
			{/each}
		</div>

		<h2 class="mt-8 text-sm font-medium tracking-wider text-muted-foreground uppercase">
			MCP servers
		</h2>
		<p class="mt-1 max-w-prose text-sm text-muted-foreground">
			The servers Firstmate’s Claude Code has, found as they are added. Each is on unless it fails
			to connect.
		</p>
		<div class="mt-3 divide-y rounded-lg border">
			{#each view.mcp as s (s.name)}
				{@render row(
					s.name,
					'',
					s.on,
					(on) => setServer(s.name, on),
					s.connects === false ? 'did not connect' : s.connects ? 'connects' : ''
				)}
			{:else}
				<p class="p-4 text-sm text-muted-foreground">Firstmate’s Claude Code has no MCP servers.</p>
			{/each}
		</div>

		<h2 class="mt-8 text-sm font-medium tracking-wider text-muted-foreground uppercase">Skills</h2>
		<p class="mt-1 max-w-prose text-sm text-muted-foreground">
			Your installed skills the crew may use. None unless you pick them; Firstmate’s own skills are
			never offered.
		</p>
		<div class="mt-3 divide-y rounded-lg border">
			{#each view.skills as s (s.name)}
				{@render row(s.name, s.description, s.on, (on) => setSkill(s.name, on))}
			{:else}
				<p class="p-4 text-sm text-muted-foreground">
					No skills are installed in ~/.claude/skills.
				</p>
			{/each}
		</div>

		<p
			class="mt-8 flex max-w-prose items-start gap-2 rounded-lg border bg-muted/40 p-4 text-sm text-muted-foreground"
		>
			<Lock class="mt-0.5 size-4 shrink-0" aria-hidden="true" />
			<span>
				Always off: a shell, writing files, and anything that changes the fleet (starting or
				steering workers, merging, tearing down, writing to projects). The crew suggests those, and
				passes them on to Firstmate.
			</span>
		</p>
		{#if problem}<p class="mt-4 text-sm text-danger" role="alert">{problem}</p>{/if}
	</div>
</main>
