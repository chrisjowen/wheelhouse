<script lang="ts">
	import {
		AudioLines,
		ChartColumn,
		ExternalLink,
		GitPullRequest,
		Hourglass,
		Image,
		Maximize2,
		Workflow,
		X
	} from '@lucide/svelte';
	import { SESSION_HEADER } from '$lib/client/messages';
	import type { Visual } from '$lib/live/reply';
	import type { TaskSummary } from '$lib/types';
	import ChatPreview from '../ChatPreview.svelte';

	/**
	 * Something the discussion crew put up in the chat: a Mermaid diagram, a
	 * chart, task and pull request cards (a task with a live preview shows the
	 * same preview card as Firstmate's replies), a picture the illustrator
	 * draws, or a note passed on to Firstmate. Diagrams, charts and pictures
	 * open full size. The drawing libraries load only when first needed, and
	 * take their colours from the theme.
	 */
	let {
		visual,
		tasks,
		token,
		now,
		projectName
	}: {
		visual: Visual;
		tasks: TaskSummary[];
		token: string;
		now: number;
		projectName: (id: string | null) => string | null;
	} = $props();

	let svg = $state<string | null>(null);
	let failed = $state<string | null>(null);
	let full = $state(false);
	let dialog = $state<HTMLDialogElement | null>(null);
	let canvas = $state<HTMLCanvasElement | null>(null);
	let bigCanvas = $state<HTMLCanvasElement | null>(null);

	const KIND = {
		diagram: ['Diagram', Workflow],
		chart: ['Chart', ChartColumn],
		picture: ['Picture', Image]
	} as const;
	const title = $derived(
		visual.kind === 'diagram'
			? visual.title
			: visual.kind === 'chart'
				? visual.spec.title
				: visual.kind === 'picture'
					? visual.title
					: ''
	);

	const css = (name: string) =>
		getComputedStyle(document.documentElement).getPropertyValue(name).trim() || undefined;
	const dark = () => document.documentElement.classList.contains('dark');
	// Categorical orders validated for each theme's card surface (all six palette checks pass).
	const series = () =>
		dark()
			? ['#c98500', '#199e70', '#3987e5', '#d95926', '#9085e9', '#d55181']
			: ['#c98500', '#2a78d6', '#eb6834', '#1baf7a', '#4a3aa7', '#e87ba4'];

	let seq = 0;
	async function drawDiagram(code: string) {
		const { default: mermaid } = await import('mermaid');
		mermaid.initialize({
			startOnLoad: false,
			securityLevel: 'strict',
			theme: 'base',
			fontFamily: 'DM Sans Variable, ui-sans-serif, sans-serif',
			themeVariables: {
				darkMode: dark(),
				background: css('--panel'),
				primaryColor: css('--muted'),
				primaryTextColor: css('--foreground'),
				primaryBorderColor: css('--brass'),
				secondaryColor: css('--accent'),
				tertiaryColor: css('--card'),
				lineColor: css('--muted-foreground'),
				textColor: css('--foreground'),
				clusterBkg: css('--card'),
				clusterBorder: css('--border'),
				edgeLabelBackground: css('--panel'),
				actorBkg: css('--muted'),
				actorBorder: css('--brass'),
				actorTextColor: css('--foreground'),
				signalColor: css('--muted-foreground'),
				signalTextColor: css('--foreground'),
				noteBkgColor: css('--accent'),
				noteTextColor: css('--foreground'),
				fontSize: '15px'
			}
		});
		const id = `live-diagram-${Date.now().toString(36)}-${seq++}`;
		try {
			svg = (await mermaid.render(id, code)).svg;
		} catch (error) {
			document.getElementById(`d${id}`)?.remove();
			failed = `The diagram did not draw: ${String((error as Error).message ?? error).split('\n')[0]}`;
		}
	}

	async function drawPicture(prompt: string, name: string) {
		try {
			const r = await fetch('/api/live/image', {
				method: 'POST',
				headers: { 'content-type': 'application/json', [SESSION_HEADER]: token },
				body: JSON.stringify({ prompt, title: name })
			});
			const body = (await r.json()) as { svg?: string; message?: string };
			if (!body.svg) throw new Error(body.message ?? 'no picture');
			svg = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(body.svg)}`;
		} catch (error) {
			failed = `The illustrator could not draw this: ${(error as Error).message}`;
		}
	}

	async function drawChart(target: HTMLCanvasElement) {
		if (visual.kind !== 'chart') return;
		const s = visual.spec;
		const { Chart, registerables } = await import('chart.js');
		Chart.register(...registerables);
		const colours = series();
		const ink = css('--muted-foreground') ?? '#8e9aa6';
		const surface = css('--card') ?? '#111b26';
		return new Chart(target, {
			type: s.type,
			data: {
				labels: s.labels,
				datasets:
					s.type === 'doughnut'
						? [
								{
									data: s.series[0]?.data ?? [],
									label: s.series[0]?.name,
									backgroundColor: colours,
									borderColor: surface,
									borderWidth: 2
								}
							]
						: s.series.map((x, i) => ({
								label: x.name,
								data: x.data,
								backgroundColor: colours[i],
								borderColor: colours[i],
								borderWidth: s.type === 'line' ? 2 : 0,
								borderRadius: 4,
								maxBarThickness: 34,
								pointRadius: 4,
								pointBorderColor: surface,
								pointBorderWidth: 2,
								tension: 0.25
							}))
			},
			options: {
				responsive: true,
				maintainAspectRatio: false,
				color: ink,
				plugins: {
					legend: {
						display: s.type === 'doughnut' || s.series.length > 1,
						position: 'bottom',
						labels: { usePointStyle: true, boxWidth: 8, color: ink }
					},
					tooltip: {
						callbacks: s.unit
							? { label: (c) => `${c.dataset.label ?? ''} ${c.formattedValue} ${s.unit}`.trim() }
							: {}
					}
				},
				scales:
					s.type === 'doughnut'
						? {}
						: {
								x: { grid: { display: false }, ticks: { color: ink } },
								y: {
									beginAtZero: true,
									grid: { color: css('--hair') },
									border: { display: false },
									ticks: { color: ink, precision: 0 },
									title: s.unit ? { display: true, text: s.unit, color: ink } : undefined
								}
							}
			}
		});
	}

	$effect(() => {
		if (visual.kind === 'diagram') void drawDiagram(visual.code);
		else if (visual.kind === 'picture') void drawPicture(visual.prompt, visual.title);
	});
	$effect(() => {
		if (!canvas) return;
		const made = drawChart(canvas);
		return () => void made.then((c) => c?.destroy());
	});
	$effect(() => {
		if (!full || !bigCanvas) return;
		const made = drawChart(bigCanvas);
		return () => void made.then((c) => c?.destroy());
	});
	$effect(() => {
		if (full) dialog?.showModal();
		else dialog?.close();
	});

	const prNumber = (url: string) => /\/pull\/(\d+)/.exec(url)?.[1] ?? null;
	const repo = (url: string) => /github\.com\/([^/]+\/[^/]+)\//.exec(url)?.[1] ?? null;
	const find = (id: string) => {
		const q = id.toLowerCase();
		return (
			tasks.find((t) => t.id.toLowerCase() === q) ??
			tasks.find((t) => t.id.toLowerCase().startsWith(q)) ??
			null
		);
	};
</script>

{#if visual.kind === 'passon'}
	<div
		class="flex max-w-[62ch] items-start gap-2.5 rounded-lg border border-sea/40 bg-sea/5 px-3.5 py-2.5 text-sm"
		data-live-passon
	>
		<Hourglass class="mt-0.5 size-4 shrink-0 text-sea" aria-hidden="true" />
		<div>
			<p class="font-semibold text-sea">Firstmate is busy right now · I’ll pass this on</p>
			<p class="mt-0.5">{visual.note}</p>
		</div>
	</div>
{:else if visual.kind === 'cards'}
	{#each visual.cards as card, i (i)}
		{@const task = card.kind === 'task' ? find(card.task) : null}
		{#if task?.preview}
			<ChatPreview
				preview={{ task, url: task.preview.url, board: false, landed: task.status === 'landed' }}
				project={projectName(task.projectId)}
				{now}
			/>
		{:else}
			<div
				class="w-full max-w-[min(100%,40rem)] overflow-hidden rounded-xl border border-hair bg-card text-sm"
				data-live-card={card.kind}
			>
				<header class="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 px-4 pt-2.5 pb-2">
					{#if card.kind === 'task'}
						<span
							class="rounded px-1.5 text-xs leading-[1.15rem] font-medium {task?.status === 'landed'
								? 'bg-success/10 text-success'
								: task?.status === 'blocked'
									? 'bg-danger/10 text-danger'
									: 'bg-sea/10 text-sea'}">{task?.statusLabel ?? 'Task'}</span
						>
						{#if task && projectName(task.projectId)}<span
								class="rounded-sm border px-1.5 text-[0.95rem] leading-[1.15rem] font-semibold tracking-[0.08em] text-muted-foreground [font-variant-caps:all-small-caps]"
								>{projectName(task.projectId)}</span
							>{/if}
						{#if task}<a
								href="/tasks/{encodeURIComponent(task.id)}"
								class="min-w-0 truncate font-medium hover:underline">{task.shortTitle}</a
							>{:else}<span class="font-mono text-xs text-muted-foreground">{card.task}</span>{/if}
					{:else if card.kind === 'pr'}
						<span
							class="flex items-center gap-1 rounded bg-sea/10 px-1.5 text-xs leading-[1.15rem] font-medium text-sea"
							><GitPullRequest class="size-3" aria-hidden="true" />Pull request</span
						>
						<span class="min-w-0 truncate font-medium"
							>{card.title ?? `#${prNumber(card.url) ?? ''}`}</span
						>
					{:else}
						<span
							class="rounded bg-muted px-1.5 text-xs leading-[1.15rem] font-medium text-muted-foreground"
							>Link</span
						>
						<span class="min-w-0 truncate font-medium">{card.title ?? card.url}</span>
					{/if}
				</header>
				{#if card.kind === 'task' && task?.summary}
					<p class="border-t border-hair px-4 py-2.5 text-muted-foreground">{task.summary}</p>
				{:else if card.kind === 'task' && !task}
					<p class="border-t border-hair px-4 py-2.5 text-muted-foreground">
						Not in the fleet right now.
					</p>
				{:else if card.kind === 'link' && card.note}
					<p class="border-t border-hair px-4 py-2.5 text-muted-foreground">{card.note}</p>
				{/if}
				<footer
					class="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-hair px-4 py-2 text-xs"
				>
					{#if card.kind === 'task' && task?.pr}
						<a
							href={task.pr.url}
							target="_blank"
							rel="noreferrer"
							class="inline-flex items-center gap-1 text-sea hover:underline"
							><GitPullRequest class="size-3.5" aria-hidden="true" />Pull request #{task.pr
								.number}</a
						>
					{:else if card.kind === 'pr'}
						<a
							href={card.url}
							target="_blank"
							rel="noreferrer"
							class="inline-flex items-center gap-1 text-sea hover:underline"
							><ExternalLink class="size-3.5" aria-hidden="true" />{repo(card.url) ??
								'Open'}{prNumber(card.url) ? `#${prNumber(card.url)}` : ''}</a
						>
					{:else if card.kind === 'link'}
						<a
							href={card.url}
							target="_blank"
							rel="noreferrer"
							class="inline-flex items-center gap-1 text-sea hover:underline"
							><ExternalLink class="size-3.5" aria-hidden="true" />{URL.parse(card.url)?.host ??
								card.url}</a
						>
					{/if}
					{#if card.kind === 'task'}<span class="font-mono text-muted-foreground">{card.task}</span
						>{/if}
				</footer>
			</div>
		{/if}
	{/each}
{:else if visual.kind === 'invalid'}
	<p class="text-xs text-muted-foreground" data-live-invalid>{visual.reason}</p>
{:else}
	{@const [label, Icon] = KIND[visual.kind]}
	<figure
		class="w-full max-w-[min(100%,44rem)] overflow-hidden rounded-xl border border-hair bg-card"
		data-live-visual={visual.kind}
	>
		<header class="flex min-w-0 items-center gap-2 px-4 pt-2.5 pb-2 text-sm">
			<span
				class="flex shrink-0 items-center gap-1 rounded bg-sea/10 px-1.5 text-xs leading-[1.15rem] font-medium text-sea"
				><Icon class="size-3" aria-hidden="true" />{label}</span
			>
			<span class="min-w-0 truncate font-medium">{title}</span>
		</header>
		<div class="border-y border-hair bg-panel">
			{#if visual.kind === 'chart'}
				<div class="relative h-64 p-3"><canvas bind:this={canvas} aria-label={title}></canvas></div>
			{:else if failed}
				<p class="px-4 py-3 text-sm text-danger">{failed}</p>
			{:else if !svg}
				<p class="flex items-center gap-2 px-4 py-5 text-sm text-muted-foreground" role="status">
					<AudioLines class="size-4 animate-pulse text-sea" aria-hidden="true" />{visual.kind ===
					'picture'
						? 'The illustrator is drawing it (about twenty seconds)…'
						: 'Drawing…'}
				</p>
			{:else}
				<button
					class="block w-full cursor-zoom-in p-3"
					aria-label="Open {title} full size"
					onclick={() => (full = true)}
				>
					{#if visual.kind === 'picture'}<img
							class="mx-auto max-h-96 rounded-md"
							src={svg}
							alt={title}
						/>{:else}<div class="live-diagram flex max-h-96 justify-center overflow-hidden">
							<!-- eslint-disable-next-line svelte/no-at-html-tags -- Mermaid renders with securityLevel strict -->
							{@html svg}
						</div>{/if}
				</button>
			{/if}
		</div>
		<footer class="flex items-center gap-3 px-4 py-2 text-xs text-muted-foreground">
			<span>From the discussion crew</span>
			{#if svg || visual.kind === 'chart'}
				<button
					class="ml-auto inline-flex cursor-pointer items-center gap-1 hover:text-foreground hover:underline"
					onclick={() => (full = true)}
					><Maximize2 class="size-3.5" aria-hidden="true" />Full size</button
				>
			{/if}
		</footer>
	</figure>
	<dialog
		bind:this={dialog}
		class="m-auto h-[88vh] w-[92vw] max-w-none rounded-xl border bg-panel p-0 text-foreground backdrop:bg-black/60"
		onclose={() => (full = false)}
	>
		<div class="flex items-center gap-2 border-b px-4 py-3 text-sm">
			<span class="font-medium">{title}</span>
			<button
				class="ml-auto flex size-8 cursor-pointer items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
				aria-label="Close"
				onclick={() => (full = false)}><X class="size-4" /></button
			>
		</div>
		<div class="flex h-[calc(88vh-3.5rem)] items-center justify-center overflow-auto p-6">
			{#if full}
				{#if visual.kind === 'chart'}
					<div class="relative h-full w-full">
						<canvas bind:this={bigCanvas} aria-label={title}></canvas>
					</div>
				{:else if visual.kind === 'picture' && svg}
					<img class="max-h-full max-w-full" src={svg} alt={title} />
				{:else if svg}
					<div
						class="live-diagram live-diagram-full flex h-full w-full items-center justify-center"
					>
						<!-- eslint-disable-next-line svelte/no-at-html-tags -- Mermaid renders with securityLevel strict -->
						{@html svg}
					</div>
				{/if}
			{/if}
		</div>
	</dialog>
{/if}

<style>
	.live-diagram :global(svg) {
		max-width: 100%;
		height: auto;
	}
	.live-diagram:not(.live-diagram-full) :global(svg) {
		max-height: 23rem;
	}
	.live-diagram-full :global(svg) {
		max-height: 100%;
	}
</style>
