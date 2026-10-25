<script lang="ts">
	import { Anchor, Flag, Sailboat } from '@lucide/svelte';
	import type { ChartLayout, LaidNode } from './layout';
	import type { Vessel } from './types';
	import { DASH, iconFor, MARKS, relLabel, surveyAge, typeLabel } from './words';

	/**
	 * The Chart itself, as one SVG: owners' waters as bands, landmarks in
	 * dependency columns, harbours on the coast, restricted waters hatched,
	 * link confidence as solid, dashed (PA) and dotted (ED) lines, and tasks
	 * under way as vessels on what they touch.
	 */
	let {
		layout,
		scale = 1,
		icons,
		vessels,
		selected,
		highlight,
		now,
		onselect
	}: {
		layout: ChartLayout;
		/** How large to draw it: 1 is the layout's own size in CSS pixels. */
		scale?: number;
		/** Lucide icon name per exhibit type, from the docket's ontology. */
		icons: Record<string, string | null>;
		vessels: Vessel[];
		selected: string | null;
		/** Exhibits to bring forward; the rest are dimmed. Empty: nothing dimmed. */
		highlight: Set<string>;
		now: number;
		onselect: (id: string | null) => void;
	} = $props();

	const uid = $props.id();
	const hatch = `docket-hatch-${uid}`;
	const arrow = `docket-arrow-${uid}`;

	const vesselsOn = $derived.by(() => {
		const m: Record<string, Vessel[]> = {};
		for (const v of vessels) for (const id of v.touched) (m[id] ??= []).push(v);
		return m;
	});
	const dimmed = (id: string) => highlight.size > 0 && !highlight.has(id);
	/** Harbours each landmark runs in, shown as an anchor on the landmark. */
	const berths = $derived.by(() => {
		const m: Record<string, string[]> = {};
		for (const e of layout.edges) if (e.quiet) (m[e.source] ??= []).push(titleOf(e.target));
		return m;
	});
	/** Lines into harbours show only for what is brought forward. */
	const shown = (e: ChartLayout['edges'][number]) =>
		!e.quiet || (highlight.size > 0 && highlight.has(e.source) && highlight.has(e.target));
	const titleOf = (id: string) => layout.nodes.find((n) => n.id === id)?.exhibit?.title ?? id;
	const trunc = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

	function subline(n: LaidNode): string {
		if (n.kind === 'ghost') return 'Unsurveyed';
		const x = n.exhibit!;
		if (n.kind === 'harbour') {
			const env = x.attributes.find((a) => a.key === 'environmentType')?.value;
			return env ? `Harbour · ${env}` : 'Harbour';
		}
		return typeLabel(x.type);
	}

	function key(e: KeyboardEvent, id: string) {
		if (e.key === 'Enter' || e.key === ' ') {
			e.preventDefault();
			onselect(selected === id ? null : id);
		}
	}
</script>

<svg
	viewBox="0 0 {layout.width} {layout.height}"
	width={Math.round(layout.width * scale)}
	height={Math.round(layout.height * scale)}
	class="block shrink-0 select-none"
	role="group"
	aria-label="Chart of the system: {layout.nodes.length} places, {layout.edges.length} routes"
>
	<defs>
		<pattern
			id={hatch}
			patternUnits="userSpaceOnUse"
			width="7"
			height="7"
			patternTransform="rotate(45)"
		>
			<line x1="0" y1="0" x2="0" y2="7" class="stroke-warning" stroke-width="1.6" opacity="0.45" />
		</pattern>
		<marker
			id={arrow}
			viewBox="0 0 8 8"
			refX="7.5"
			refY="4"
			markerWidth="7"
			markerHeight="7"
			orient="auto-start-reverse"
		>
			<path d="M0,0.5 L8,4 L0,7.5 z" class="fill-muted-foreground" />
		</marker>
	</defs>

	<!-- Owners' waters -->
	{#each layout.lanes as lane (lane.id ?? '')}
		<g>
			<rect
				x={lane.x}
				y={lane.y}
				width={lane.w}
				height={lane.h}
				rx="14"
				class="fill-sea/[0.04] stroke-sea/20"
				stroke-dasharray={lane.id === null ? '4 4' : undefined}
			/>
			{#if lane.id !== null}
				<Flag x={lane.x + 14} y={lane.y + 12} size={14} class="text-sea" aria-hidden="true" />
			{/if}
			<text
				x={lane.x + (lane.id === null ? 14 : 34)}
				y={lane.y + 24}
				class="fill-muted-foreground text-[13px] font-medium">{lane.title}</text
			>
		</g>
	{/each}

	<!-- The coast and its harbours -->
	{#if layout.coast}
		{@const c = layout.coast}
		<rect x={c.x} y={c.y} width={c.w} height={c.h} rx="14" class="fill-sea/[0.09] stroke-sea/25" />
		<Anchor x={c.x + 14} y={c.y + 12} size={14} class="text-sea" aria-hidden="true" />
		<text x={c.x + 34} y={c.y + 24} class="fill-muted-foreground text-[13px] font-medium"
			>Where code runs</text
		>
	{/if}

	<!-- Restricted waters -->
	{#each layout.halos as h (`${h.restriction}@${h.node}`)}
		<g opacity={dimmed(h.node) ? 0.25 : 1}>
			<rect
				x={h.x}
				y={h.y}
				width={h.w}
				height={h.h}
				rx="11"
				fill="url(#{hatch})"
				class="stroke-warning/60"
				stroke-dasharray="5 3"
			/>
			<circle cx={h.x + h.w - 3} cy={h.y + 3} r="7.5" class="fill-background stroke-warning/70" />
			<text
				x={h.x + h.w - 3}
				y={h.y + 6.2}
				text-anchor="middle"
				class="fill-warning text-[9px] font-semibold">{h.letter}</text
			>
		</g>
	{/each}

	<!-- Routes -->
	{#each layout.edges.filter(shown) as e (e.key)}
		{@const faint = dimmed(e.source) || dimmed(e.target)}
		<g opacity={faint ? 0.15 : 1}>
			<path
				d={e.d}
				fill="none"
				class="stroke-muted-foreground"
				stroke-width={e.quiet ? 1 : 1.4}
				stroke-opacity={e.quiet ? 0.55 : 0.8}
				stroke-dasharray={DASH[e.mark]}
				stroke-linecap="round"
				marker-end="url(#{arrow})"
			>
				<title
					>{titleOf(e.source)}
					{relLabel(e.rel)}
					{titleOf(e.target)}: {MARKS[e.mark].label.toLowerCase()}</title
				>
			</path>
			{#if MARKS[e.mark].short && !e.quiet}
				<text
					x={e.mid.x}
					y={e.mid.y + 3}
					text-anchor="middle"
					class="fill-muted-foreground stroke-background text-[9px] font-semibold"
					stroke-width="3"
					paint-order="stroke">{MARKS[e.mark].short}</text
				>
			{/if}
		</g>
	{/each}

	<!-- Landmarks and harbours -->
	{#each layout.nodes as n (n.id)}
		{@const Icon = n.kind === 'harbour' ? Anchor : iconFor(icons[n.exhibit?.type ?? ''])}
		{@const on = vesselsOn[n.id] ?? []}
		{@const surveyed = n.exhibit?.surveyed ?? null}
		{@const age = surveyAge(surveyed, now)}
		<g
			transform="translate({n.x},{n.y})"
			role="button"
			tabindex="0"
			aria-pressed={selected === n.id}
			aria-label="{n.exhibit?.title ?? n.id}, {subline(n)}{on.length
				? `, ${on.length} ${on.length === 1 ? 'task' : 'tasks'} under way`
				: ''}"
			class="cursor-pointer outline-none [&:focus-visible>rect:first-child]:stroke-ring"
			opacity={dimmed(n.id) ? 0.3 : 1}
			onclick={() => onselect(selected === n.id ? null : n.id)}
			onkeydown={(e) => key(e, n.id)}
		>
			<rect
				width={n.w}
				height={n.h}
				rx="9"
				class={n.kind === 'ghost'
					? 'fill-transparent stroke-muted-foreground/60'
					: selected === n.id
						? 'fill-card stroke-sea'
						: 'fill-card stroke-border hover:stroke-muted-foreground'}
				stroke-width={selected === n.id ? 2 : 1.2}
				stroke-dasharray={n.kind === 'ghost' ? '3 3' : undefined}
			/>
			<Icon
				x="11"
				y={(n.h - 16) / 2}
				size={16}
				class={n.kind === 'harbour' ? 'text-sea' : 'text-muted-foreground'}
				aria-hidden="true"
			/>
			<text x="36" y="24" class="fill-foreground text-[14px] font-medium"
				>{trunc(n.exhibit?.title ?? n.id, 19)}</text
			>
			<text x="36" y="41" class="fill-muted-foreground text-[13px]"
				>{trunc(subline(n), surveyed ? 13 : 24)}</text
			>
			{#if surveyed}
				<text
					x={n.w - 9}
					y="41"
					text-anchor="end"
					class="fill-muted-foreground text-[13px] italic"
					opacity={age === 'old' ? 0.45 : 0.9}
					>{surveyed}<title
						>Surveyed {surveyed}{age === 'old'
							? ', over six months ago; it may have changed since.'
							: ': when evidence for this was last observed.'}</title
					></text
				>
			{/if}
			{#if berths[n.id]}
				<g transform="translate({n.w - 20},6)">
					<title>Runs in {berths[n.id].join(', ')}</title>
					<Anchor size={11} class="text-sea/70" aria-hidden="true" />
				</g>
			{/if}
			{#if on.length}
				<g transform="translate(-7,-7)">
					<circle cx="9" cy="9" r="10" class="fill-sea" />
					<Sailboat x="3" y="3" size={12} class="text-background" aria-hidden="true" />
					{#if on.length > 1}
						<text x="20" y="5" class="fill-sea text-[9px] font-semibold">{on.length}</text>
					{/if}
				</g>
			{/if}
		</g>
	{/each}
</svg>
