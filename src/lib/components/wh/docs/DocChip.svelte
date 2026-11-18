<script lang="ts">
	/**
	 * One link to a document, the same wherever a document is mentioned (a
	 * Firstmate message, a task card, a decision card): what it is, its title,
	 * and Open. Teal for a task record, gold for a library document, blue for a
	 * live prototype with its state. It opens the document's permanent page,
	 * which still works after the task closed or the decision was answered.
	 */
	import { BookOpen, FileText, MonitorPlay, PackageCheck } from '@lucide/svelte';
	import {
		docDate,
		libraryHref,
		prototypeHref,
		recordHref,
		shelfName,
		STATE_WORDS,
		type ResolvedDoc
	} from '$lib/documents';

	let {
		doc,
		label = null,
		sub = null,
		size = 'block'
	}: {
		doc: ResolvedDoc;
		/** Shown instead of the title (e.g. "Report" on a card, with the title below). */
		label?: string | null;
		sub?: string | null;
		/** block: a full-width row (chat); sm: a compact one (cards). */
		size?: 'block' | 'sm';
	} = $props();

	const v = $derived.by(() => {
		if (doc.kind === 'record') {
			const r = doc.record;
			return {
				href: recordHref(r.key),
				title: r.title,
				what: `${r.kind === 'ship' ? 'Ship summary' : 'Report'} · ${shelfName(r.project)}${r.mate ? ` · @${r.mate}` : ''} · ${docDate(r.at, false)}`,
				tone: 'rec' as const,
				Icon: r.kind === 'ship' ? PackageCheck : FileText,
				state: null
			};
		}
		if (doc.kind === 'library') {
			const d = doc.doc;
			return {
				href: libraryHref(d.key),
				title: d.title,
				what: `Library · ${shelfName(d.shelf)} / ${d.folder} · ${d.status}`,
				tone: 'lib' as const,
				Icon: BookOpen,
				state: null
			};
		}
		const p = doc.prototype;
		return {
			href: prototypeHref(p.id),
			title: p.title,
			what: `Prototype · ${STATE_WORDS[p.state]}`,
			tone: 'proto' as const,
			Icon: MonitorPlay,
			state: p.state
		};
	});
</script>

<a
	href={v.href}
	class="dchip dchip-{v.tone} {size === 'sm' ? 'dchip-sm' : ''}"
	title="Opens {v.href}"
	data-doc-chip={doc.kind}
>
	<span class="dchip-icon"
		><v.Icon class={size === 'sm' ? 'size-3.5' : 'size-4'} aria-hidden="true" />{#if v.state}<span
				class="dchip-dot"
				data-state={v.state}
			></span>{/if}</span
	>
	<span class="min-w-0 flex-1">
		<span class="block truncate font-medium text-foreground">{label ?? v.title}</span>
		<span class="block truncate text-xs text-muted-foreground"
			>{sub ?? (label ? v.title : v.what)}</span
		>
	</span>
	{#if size === 'block'}<span class="dchip-open">Open</span>{/if}
</a>

<style>
	.dchip {
		--tone: var(--teal);
		position: relative;
		display: flex;
		align-items: center;
		gap: 0.65rem;
		min-width: 0;
		max-width: 100%;
		border: 1px solid color-mix(in oklab, var(--tone) 35%, var(--border));
		border-left: 3px solid var(--tone);
		border-radius: 0.375rem;
		background: color-mix(in oklab, var(--tone) 5%, var(--card));
		padding: 0.5rem 0.75rem;
		font-family: var(--font-sans);
		font-size: 0.875rem;
		line-height: 1.3;
		text-decoration: none;
		transition:
			background-color 120ms,
			border-color 120ms;
	}
	.dchip:hover {
		background: color-mix(in oklab, var(--tone) 11%, var(--card));
		border-color: color-mix(in oklab, var(--tone) 60%, var(--border));
	}
	.dchip:focus-visible {
		outline: 2px solid var(--ring);
		outline-offset: 2px;
	}
	.dchip-lib {
		--tone: var(--gold);
	}
	.dchip-proto {
		--tone: var(--working);
	}
	.dchip-sm {
		gap: 0.5rem;
		padding: 0.3rem 0.55rem;
		font-size: 0.8rem;
	}
	.dchip-icon {
		position: relative;
		display: grid;
		place-items: center;
		flex-shrink: 0;
		color: var(--tone);
	}
	.dchip-dot {
		position: absolute;
		right: -0.2rem;
		bottom: -0.15rem;
		width: 0.45rem;
		height: 0.45rem;
		border-radius: 999px;
		background: var(--muted-foreground);
		box-shadow: 0 0 0 2px var(--card);
	}
	.dchip-dot[data-state='running'] {
		background: var(--success);
	}
	.dchip-dot[data-state='gone'] {
		background: var(--danger);
	}
	.dchip-open {
		flex-shrink: 0;
		font-size: 0.75rem;
		font-weight: 600;
		color: var(--tone);
	}
</style>
