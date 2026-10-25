<script lang="ts">
	import {
		Bot,
		Brain,
		ChevronRight,
		CircleAlert,
		FilePen,
		FileText,
		Globe,
		Info,
		ListTodo,
		LoaderCircle,
		Search,
		Sparkles,
		SquareTerminal,
		Wrench
	} from '@lucide/svelte';
	import { activitySummary, duration, type Step } from '$lib/chat/fold';

	/**
	 * One run of Firstmate's work between two replies, collapsed to a single
	 * plain line ("3 commands, 1 skill"). It opens to one row per step, and each
	 * row opens to the step's input and result. While it is the live step it
	 * says what Firstmate is doing now.
	 */
	let { steps, live = false }: { steps: Step[]; live?: boolean } = $props();

	let open = $state(false);
	let openStep = $state<Record<string, boolean>>({});
	let full = $state<Record<string, boolean>>({});

	const ICONS: Record<string, typeof Wrench> = {
		Bash: SquareTerminal,
		Read: FileText,
		Edit: FilePen,
		MultiEdit: FilePen,
		Write: FilePen,
		Grep: Search,
		Glob: Search,
		WebSearch: Globe,
		WebFetch: Globe,
		Skill: Sparkles,
		ToolSearch: Wrench,
		Agent: Bot,
		Task: Bot,
		TodoWrite: ListTodo
	};
	const iconFor = (s: Step) =>
		s.kind === 'thinking' ? Brain : s.kind === 'context' ? Info : (ICONS[s.name] ?? Wrench);

	function label(s: Step): { verb: string; summary: string } {
		if (s.kind === 'thinking') {
			return {
				verb: s.ms != null && s.ms >= 1000 ? `Thought for ${duration(s.ms)}` : 'Thought',
				summary: ''
			};
		}
		if (s.kind === 'context') return { verb: s.label, summary: '' };
		return { verb: s.verb, summary: s.summary };
	}
	const latest = $derived(label(steps[steps.length - 1]));

	const LIMIT = 1600;
	const clip = (id: string, text: string) =>
		full[id] || text.length <= LIMIT ? text : text.slice(0, LIMIT);

	/* eslint-disable @typescript-eslint/no-explicit-any */
	function inputView(s: Extract<Step, { kind: 'tool' }>): { code: string; mono: boolean } {
		const i = (s.input ?? {}) as Record<string, any>;
		if (s.name === 'Bash' && typeof i.command === 'string') return { code: i.command, mono: true };
		if ((s.name === 'Agent' || s.name === 'Task') && typeof i.prompt === 'string') {
			return { code: i.prompt, mono: false };
		}
		return { code: JSON.stringify(i, null, 2), mono: true };
	}
</script>

<div>
	<button
		class="flex max-w-full cursor-pointer items-center gap-2 rounded-md py-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
		aria-expanded={open}
		onclick={() => (open = !open)}
	>
		{#if live}
			<LoaderCircle class="size-4 shrink-0 animate-spin text-sea" aria-hidden="true" />
			<span class="truncate">{latest.verb} {latest.summary}</span>
		{:else}
			<span class="truncate">{activitySummary(steps)}</span>
		{/if}
		<ChevronRight
			class="size-4 shrink-0 transition-transform {open ? 'rotate-90' : ''}"
			aria-hidden="true"
		/>
	</button>

	{#if open}
		<ol class="mt-1 ml-2 flex max-w-[80ch] flex-col border-l pl-4">
			{#each steps as s (s.id)}
				{@const Icon = iconFor(s)}
				{@const l = label(s)}
				<li class="py-0.5">
					<button
						class="flex w-full min-w-0 cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-muted"
						aria-expanded={!!openStep[s.id]}
						onclick={() => (openStep[s.id] = !openStep[s.id])}
					>
						<Icon class="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
						<span class="shrink-0 text-foreground/80">{l.verb}</span>
						{#if l.summary}<span class="min-w-0 truncate text-muted-foreground">{l.summary}</span
							>{/if}
						{#if s.kind === 'tool' && s.isError}
							<span class="flex shrink-0 items-center gap-1 text-xs text-danger"
								><CircleAlert class="size-3.5" aria-hidden="true" />failed</span
							>
						{:else if s.kind === 'tool' && s.result == null}
							<LoaderCircle
								class="size-3.5 shrink-0 animate-spin text-muted-foreground"
								aria-label="Running"
							/>
						{/if}
						<ChevronRight
							class="ml-auto size-3.5 shrink-0 text-muted-foreground transition-transform {openStep[
								s.id
							]
								? 'rotate-90'
								: ''}"
							aria-hidden="true"
						/>
					</button>

					{#if openStep[s.id]}
						<div class="mt-1 mb-2 ml-8 flex flex-col gap-2 text-xs">
							{#if s.kind === 'thinking'}
								<p class="text-muted-foreground">
									Claude Code keeps only a sealed signature for its thinking, not the words.
								</p>
							{:else if s.kind === 'context'}
								<pre
									class="no-scrollbar max-h-72 overflow-auto rounded-md bg-muted p-3 font-mono whitespace-pre-wrap text-muted-foreground">{clip(
										s.id,
										s.detail
									)}</pre>
								{#if s.detail.length > LIMIT && !full[s.id]}
									<button
										class="self-start text-sea hover:underline"
										onclick={() => (full[s.id] = true)}>Show all</button
									>
								{/if}
							{:else}
								{@const iv = inputView(s)}
								<div>
									<div class="mb-1 text-muted-foreground">Input</div>
									<pre
										class="no-scrollbar max-h-60 overflow-auto rounded-md bg-muted p-3 whitespace-pre-wrap {iv.mono
											? 'font-mono'
											: 'font-sans'}">{iv.code}</pre>
								</div>
								<div>
									<div class="mb-1 text-muted-foreground">{s.isError ? 'Error' : 'Result'}</div>
									{#if s.result == null}
										<p class="text-muted-foreground">Still running…</p>
									{:else if !s.result.trim()}
										<p class="text-muted-foreground">No output.</p>
									{:else}
										<pre
											class="no-scrollbar max-h-72 overflow-auto rounded-md bg-muted p-3 font-mono whitespace-pre-wrap {s.isError
												? 'text-danger'
												: ''}">{clip(s.id, s.result)}</pre>
										{#if s.result.length > LIMIT && !full[s.id]}
											<button
												class="mt-1 text-sea hover:underline"
												onclick={() => (full[s.id] = true)}
												>Show all ({Math.round(s.result.length / 1000)}k characters)</button
											>
										{/if}
									{/if}
								</div>
							{/if}
						</div>
					{/if}
				</li>
			{/each}
		</ol>
	{/if}
</div>
