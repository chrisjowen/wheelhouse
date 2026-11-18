<script lang="ts">
	/**
	 * The Documents page's one search box: plain words for titles and metadata,
	 * `#tag`, and `key:value` filters (docsearch.ts), with autocomplete that
	 * says how many documents each choice would leave. Enter, Tab or Space
	 * turns a finished filter into a chip; Backspace in an empty box removes the
	 * last chip. A filter still being typed waits until it names a real value.
	 */
	import { Search, X } from '@lucide/svelte';
	import {
		currentWord,
		filterValues,
		knownToken,
		parseQuery,
		suggestions,
		tokText,
		type Facts,
		type SearchTab,
		type Suggestion,
		type Token
	} from '$lib/docsearch';

	let {
		tab,
		facts,
		toks = $bindable(),
		text = $bindable(),
		placeholder,
		quick = []
	}: {
		tab: SearchTab;
		facts: Facts[];
		toks: Token[];
		text: string;
		placeholder: string;
		quick?: string[];
	} = $props();

	let input = $state<HTMLInputElement | null>(null);
	let focused = $state(false);
	let sel = $state(0);
	const values = $derived(filterValues(tab, facts));
	const list = $derived(
		focused ? suggestions(tab, currentWord(text), facts, toks) : ([] as Suggestion[])
	);
	const at = $derived(Math.max(0, Math.min(sel, list.length - 1)));

	function add(tok: Token, rest: string) {
		if (!toks.some((t) => t.k === tok.k && t.v === tok.v)) toks = [...toks, tok];
		text = rest;
		sel = 0;
		input?.focus();
	}
	function pick(s: Suggestion) {
		const w = currentWord(text);
		const base = text.slice(0, text.length - w.length);
		if (s.tok) add(s.tok, base);
		else if (s.insert) {
			text = base + s.insert;
			sel = 0;
			input?.focus();
		}
	}
	function keydown(e: KeyboardEvent) {
		const open = list.length > 0;
		const w = currentWord(text);
		if (e.key === 'ArrowDown' && open) {
			e.preventDefault();
			sel = (at + 1) % list.length;
		} else if (e.key === 'ArrowUp' && open) {
			e.preventDefault();
			sel = (at - 1 + list.length) % list.length;
		} else if ((e.key === 'Enter' || (e.key === 'Tab' && w)) && open && w) {
			e.preventDefault();
			pick(list[at]);
		} else if (e.key === ' ' || e.key === 'Enter') {
			// A finished filter becomes a chip.
			const p = parseQuery(w, tab);
			const t = p.toks[0];
			if (p.toks.length === 1 && (t.k === 'tag' || t.k === 'kind' || knownToken(t, values))) {
				e.preventDefault();
				add(t, text.slice(0, text.length - w.length));
			}
		} else if (e.key === 'Backspace' && !text && toks.length) {
			e.preventDefault();
			toks = toks.slice(0, -1);
		} else if (e.key === 'Escape') {
			focused = false;
		}
	}
	function useQuick(q: string) {
		const p = parseQuery(q, tab);
		toks = p.toks;
		text = p.words.join(' ');
	}
</script>

<div class="relative">
	<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
	<div
		class="flex min-h-11 flex-wrap items-center gap-1.5 rounded-lg border border-input bg-card px-3 py-1.5 focus-within:ring-3 focus-within:ring-ring/40"
		onclick={() => input?.focus()}
		data-doc-search
	>
		<Search class="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
		{#each toks as t, i (tokText(t))}
			<span
				class="inline-flex items-center gap-1 rounded-md border border-hair bg-muted px-2 py-0.5 text-sm"
				data-token={tokText(t)}
				>{#if t.k === 'tag' || t.k === 'kind'}<b class="font-semibold text-gold">#{t.v}</b
					>{:else}<span class="text-muted-foreground">{t.k}:</span><b class="font-semibold">{t.v}</b
					>{/if}<button
					type="button"
					class="-mr-1 ml-0.5 grid size-4 cursor-pointer place-items-center rounded text-muted-foreground hover:text-foreground"
					aria-label="Remove {tokText(t)}"
					onclick={(e) => {
						e.stopPropagation();
						toks = toks.filter((_, j) => j !== i);
					}}><X class="size-3" /></button
				></span
			>
		{/each}
		<input
			bind:this={input}
			bind:value={text}
			class="min-w-[12rem] flex-1 bg-transparent py-1 text-[0.95rem] outline-none placeholder:text-muted-foreground"
			placeholder={toks.length ? 'Add words or more filters…' : placeholder}
			aria-label="Search documents"
			autocomplete="off"
			spellcheck="false"
			role="combobox"
			aria-expanded={list.length > 0}
			aria-controls="doc-suggest"
			onfocus={() => (focused = true)}
			onblur={() => setTimeout(() => (focused = false), 120)}
			oninput={() => (sel = 0)}
			onkeydown={keydown}
		/>
	</div>
	{#if list.length}
		<div
			id="doc-suggest"
			role="listbox"
			class="absolute top-full right-0 left-0 z-30 mt-1 max-w-xl overflow-hidden rounded-lg border bg-popover shadow-lg"
		>
			{#each list as s, i (s.label)}
				<button
					type="button"
					role="option"
					aria-selected={i === at}
					class="flex w-full cursor-pointer items-center gap-3 px-3 py-2 text-left text-sm {i === at
						? 'bg-accent'
						: 'hover:bg-accent/60'}"
					onmousedown={(e) => {
						e.preventDefault();
						pick(s);
					}}
					data-suggestion={s.label}
					><span class="font-mono font-medium"
						>{s.label}{#if s.insert}<span class="text-muted-foreground">…</span>{/if}</span
					><span class="min-w-0 flex-1 truncate text-muted-foreground">{s.note}</span
					>{#if s.count !== null}<span class="tabular text-xs text-muted-foreground">{s.count}</span
						>{/if}</button
				>
			{/each}
			<p class="border-t border-hair px-3 py-1.5 text-xs text-muted-foreground">
				↑ ↓ choose · Enter or Tab adds it · Backspace removes the last chip
			</p>
		</div>
	{/if}
</div>
{#if quick.length}
	<div class="mt-2 flex flex-wrap items-center gap-1.5 text-sm">
		<span class="text-muted-foreground">Try</span>
		{#each quick as q (q)}
			<button
				type="button"
				class="cursor-pointer rounded-md border border-hair bg-card px-2 py-0.5 font-mono text-xs hover:bg-accent"
				onclick={() => useQuick(q)}>{q}</button
			>
		{/each}
		<span class="ml-auto text-xs text-muted-foreground"
			>Titles and metadata only; full-text search comes later.</span
		>
	</div>
{/if}
