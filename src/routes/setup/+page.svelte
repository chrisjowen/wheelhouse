<script lang="ts">
	import { onMount } from 'svelte';
	import { goto, invalidateAll } from '$app/navigation';
	import { page } from '$app/state';
	import {
		Check,
		CircleAlert,
		FolderGit2,
		FolderOpen,
		LoaderCircle,
		Lock,
		RotateCw,
		Ship
	} from '@lucide/svelte';
	import { Button } from '$lib/components/ui/button';
	import Terminal from '$lib/components/firstmate/Terminal.svelte';
	import Switch from '$lib/components/wh/Switch.svelte';
	import DepRow from '$lib/components/wh/setup/DepRow.svelte';
	import InstallFromGitHub from '$lib/components/wh/plugins/InstallFromGitHub.svelte';
	import { afterRestart } from '$lib/client/plugins';
	import { live } from '$lib/client/live.svelte';
	import { setup } from '$lib/client/setup';
	import { TERMINAL_CLOSE } from '$lib/terminal';
	import { HARNESS_NAMES } from '$lib/harness';
	import {
		canFinish,
		claudeFact,
		firstOpenStep,
		isSetupStep,
		nextStep,
		NO_FACTS,
		SETUP_STEPS,
		SETUP_TERMINAL_PATH,
		STEP_TITLES,
		stepStates,
		toolsFact,
		type CheckReport,
		type ClaudeStatus,
		type FirstmateSessionViewLike,
		type LocationCheck,
		type SessionBackendName,
		type SetupFacts,
		type SetupPlugin,
		type SetupStep,
		type SetupView,
		type ToolsReport
	} from '$lib/setup';

	/**
	 * The setup wizard: where Firstmate lives, the tools it needs, Claude Code,
	 * Firstmate's own checks, plugins, then start Firstmate and open its chat.
	 * It opens by itself when Wheelhouse finds no Firstmate, and again from
	 * Settings → Setup. Every install is shown and agreed to first; sign-ins
	 * happen in your own terminal, or for Claude Code in a terminal on this page
	 * where you type yourself.
	 */
	let { data } = $props();

	let fresh = $state<SetupView | null>(null);
	const view = $derived(fresh ?? (data.setup as SetupView));
	const harness = $derived(view.tool?.harness ?? 'claude');
	const toolName = $derived(HARNESS_NAMES[harness]);
	// The page's data came again (Wheelhouse restarted, say): it is the newest.
	$effect(() => {
		void data.setup;
		fresh = null;
	});
	const token = () => page.data.sessionToken as string;

	let tools = $state<ToolsReport | null>(null);
	let claude = $state<ClaudeStatus | null>(null);
	let check = $state<CheckReport | null>(null);
	let plugins = $state<SetupPlugin[] | null>(null);
	let pluginsSeen = $state(false);

	const facts: SetupFacts = $derived({
		...NO_FACTS,
		home: view.install !== null,
		tools: toolsFact(tools),
		harness,
		claude: harness === 'claude' ? claudeFact(claude) : view.tool?.installed ? 'ok' : 'missing',
		check: check ? (check.ok ? 'ok' : 'problems') : 'unknown',
		plugins: pluginsSeen ? 'seen' : 'unknown',
		tmux: view.tmux,
		backend: view.session?.backend ?? 'tmux',
		herdr: view.session?.herdr.ok ?? false
	});
	const states = $derived(stepStates(facts));

	const asked = page.url.searchParams.get('step');
	let step = $state<SetupStep>('location');
	onMount(() => {
		enter(
			isSetupStep(asked) && stepStates(facts)[asked] !== 'locked' ? asked : firstOpenStep(facts)
		);
	});

	let error = $state<string | null>(null);
	let working = $state<string | null>(null);

	async function refreshView() {
		fresh = (await setup.view()) ?? fresh;
	}

	function open(s: SetupStep) {
		if (states[s] === 'locked') return;
		enter(s);
	}
	const next = () => open(nextStep(step, facts));

	/** Open a step, loading what it shows. */
	function enter(s: SetupStep) {
		error = null;
		step = s;
		const home = view.install !== null;
		if (s === 'tools' && !tools && home) void loadTools();
		if (s === 'claude' && harness === 'claude' && !claude) void loadClaude();
		if (s === 'check' && home) void runCheck();
		if (s === 'plugins') {
			pluginsSeen = true;
			if (!plugins) void loadPlugins();
		}
	}

	// ---- location -------------------------------------------------------------

	let mode = $state<'clone' | 'existing'>('clone');
	let dir = $state('');
	let at = $state<LocationCheck | null>(null);
	let changing = $state(false);
	let cloneOutput = $state<string | null>(null);
	// A plugin installed from the plugins step restarts Wheelhouse: show it installed.
	onMount(() =>
		live.onRestart(() => {
			plugins = null;
			if (step === 'plugins') void loadPlugins();
		})
	);
	onMount(() => {
		dir = view.found[0] && !view.install ? view.found[0] : view.defaultDir;
		if (view.found.length && !view.install) mode = 'existing';
	});

	let inspectTimer: ReturnType<typeof setTimeout> | null = null;
	$effect(() => {
		const d = dir;
		if (!d.trim()) {
			at = null;
			return;
		}
		if (inspectTimer) clearTimeout(inspectTimer);
		inspectTimer = setTimeout(async () => {
			const r = await setup.inspect(token(), d);
			if (r.ok && dir === d) at = r.value;
		}, 250);
	});

	async function connected(restarting: boolean) {
		if (restarting) {
			working = 'Restarting Wheelhouse to use it…';
			await afterRestart();
		}
		await invalidateAll();
		await refreshView();
		tools = null;
		check = null;
		plugins = null;
		changing = false;
		working = null;
		enter('tools');
	}

	async function cloneIt() {
		error = null;
		cloneOutput = null;
		working = `Cloning Firstmate to ${at?.dir ?? dir}…`;
		const r = await setup.clone(token(), dir);
		if (!r.ok) {
			working = null;
			error = r.error;
			return;
		}
		cloneOutput = r.value.output;
		await connected(r.value.restarting);
	}

	async function useIt(d = dir) {
		error = null;
		working = `Using ${d}…`;
		const r = await setup.use(token(), d);
		if (!r.ok) {
			working = null;
			error = r.error;
			return;
		}
		await connected(r.value.restarting);
	}

	// ---- tools ----------------------------------------------------------------

	let installing = $state<string | null>(null);

	async function loadTools() {
		working = 'Running Firstmate’s own check…';
		const r = await setup.tools(token());
		await refreshView();
		working = null;
		if (r.ok) tools = r.value;
		else error = r.error;
	}

	/** Keep where Firstmate's session runs (null: follow Firstmate); Wheelhouse restarts to switch. */
	async function chooseBackend(backend: SessionBackendName | null) {
		error = null;
		working = 'Saving…';
		const r = await setup.sessionBackend(token(), backend);
		if (!r.ok) {
			working = null;
			error = r.error;
			await refreshView();
			return;
		}
		if (r.value.restarting) {
			working = `Restarting Wheelhouse to run Firstmate in ${r.value.session.backend}…`;
			await afterRestart();
			await invalidateAll();
		}
		await refreshView();
		working = null;
		tools = null;
		check = null;
		void loadTools();
	}

	async function installTool(tool: string) {
		installing = tool;
		const r = await setup.install(token(), tool);
		installing = null;
		if (r.ok && !r.value.dryRun) await loadTools();
		return r.ok ? { ok: true, output: r.value.output } : { ok: false, error: r.error };
	}

	const toolCounts = $derived(
		tools
			? {
					missing: tools.items.filter((i) => i.required && i.status !== 'ok').length,
					ready: tools.items.filter((i) => i.status === 'ok').length
				}
			: null
	);

	// ---- claude ---------------------------------------------------------------

	let signingIn = $state(false);

	async function loadClaude() {
		const r = await setup.claude(token());
		if (r.ok) claude = r.value;
		else error = r.error;
	}

	async function installClaude() {
		const r = await setup.claudeInstall(token());
		if (r.ok) {
			claude = r.value.status;
			return { ok: true, output: r.value.outcome.output };
		}
		return { ok: false, error: r.error };
	}

	async function testClaude() {
		signingIn = false;
		working = 'Asking Claude Code for one word…';
		const r = await setup.claudeTest(token());
		working = null;
		if (r.ok) claude = r.value;
		else error = r.error;
	}

	// Claude Code exited in the sign-in terminal (/exit): test it straight away.
	function terminalClosed(code: number) {
		if (code === TERMINAL_CLOSE.detached && signingIn) void testClaude();
	}

	// ---- check ----------------------------------------------------------------

	async function runCheck() {
		working = 'Running the checks…';
		const r = await setup.check(token());
		working = null;
		if (r.ok) check = r.value;
		else error = r.error;
	}

	// ---- plugins --------------------------------------------------------------

	let switching = $state<string | null>(null);

	async function loadPlugins() {
		const r = await setup.plugins(token());
		if (r.ok) plugins = r.value;
		else error = r.error;
	}

	async function switchPlugin(id: string, on: boolean) {
		switching = id;
		const r = await setup.plugin(token(), id, on);
		switching = null;
		if (r.ok) plugins = r.value;
		else error = r.error;
	}

	// ---- finish ---------------------------------------------------------------

	let started = $state<FirstmateSessionViewLike | null>(null);
	const finishable = $derived(canFinish(facts));

	async function finish() {
		error = null;
		working = 'Starting Firstmate…';
		const r = await setup.finish(token());
		working = null;
		if (r.ok) started = r.value;
		else error = r.error;
	}

	const STATE_ICON = { done: Check, attention: CircleAlert, locked: Lock, todo: null } as const;
	const sourceWords = {
		flag: 'given with --firstmate',
		cwd: 'the folder Wheelhouse ran in',
		remembered: 'chosen in setup'
	};
</script>

<svelte:head><title>Set up Firstmate · Wheelhouse</title></svelte:head>

<div class="min-h-dvh bg-background">
	<header class="border-b bg-header">
		<div class="mx-auto flex max-w-5xl flex-wrap items-center gap-3 px-4 py-3 sm:px-6">
			<Ship class="size-5 text-brass" aria-hidden="true" />
			<p class="font-display text-lg">Wheelhouse</p>
			<span class="text-sm text-muted-foreground">Set up Firstmate</span>
			{#if view.dryRun}
				<span
					class="rounded-full border border-warning/50 bg-warning/10 px-2 py-0.5 text-xs text-warning"
					data-dry-run>Dry run: installs only say what they would run</span
				>
			{/if}
			{#if view.install}
				<a class="ml-auto text-sm text-sea hover:underline" href="/">Back to Wheelhouse</a>
			{/if}
		</div>
	</header>

	{#if view.skillMessage}
		<p class="mx-auto max-w-5xl px-4 pt-4 text-sm" role="status">{view.skillMessage}</p>
	{/if}

	<main class="mx-auto grid max-w-5xl gap-6 px-4 py-6 sm:px-6 md:grid-cols-[14rem_minmax(0,1fr)]">
		<nav aria-label="Setup steps">
			<ol class="no-scrollbar flex gap-1 overflow-x-auto md:flex-col">
				{#each SETUP_STEPS as s, i (s)}
					{@const st = states[s]}
					{@const Icon = STATE_ICON[st]}
					<li class="shrink-0">
						<button
							type="button"
							class="flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-sm transition-colors disabled:cursor-not-allowed {step ===
							s
								? 'bg-card font-medium shadow-sm ring-1 ring-border'
								: 'hover:bg-muted/60'} {st === 'locked' ? 'opacity-50' : ''}"
							aria-current={step === s ? 'step' : undefined}
							disabled={st === 'locked'}
							data-step={s}
							data-state={st}
							onclick={() => open(s)}
						>
							<span
								class="flex size-6 shrink-0 items-center justify-center rounded-full border text-xs {st ===
								'done'
									? 'border-success bg-success text-white'
									: st === 'attention'
										? 'border-warning text-warning'
										: 'text-muted-foreground'}"
							>
								{#if Icon}<Icon class="size-3.5" aria-hidden="true" />{:else}{i + 1}{/if}
							</span>
							<span class="whitespace-nowrap"
								>{s === 'claude' && harness !== 'claude' ? toolName : STEP_TITLES[s]}</span
							>
						</button>
					</li>
				{/each}
			</ol>
		</nav>

		<section class="surface min-w-0 px-5 py-6 sm:px-8" aria-labelledby="step-title">
			<h1 id="step-title" class="text-2xl">
				{step === 'claude' && harness !== 'claude' ? toolName : STEP_TITLES[step]}
			</h1>

			{#if step === 'location'}
				{#if view.install && !changing}
					<p class="mt-2 max-w-prose text-sm text-muted-foreground">
						Wheelhouse is using the Firstmate at <code class="text-xs break-all text-foreground"
							>{view.install.firstmateDir}</code
						>
						({sourceWords[view.install.source]}{view.install.homeDir !== view.install.firstmateDir
							? `; its home is ${view.install.homeDir}`
							: ''}).
					</p>
					<div class="mt-6 flex flex-wrap gap-2">
						<Button onclick={next}>Continue</Button>
						{#if view.canChoose}
							<Button variant="outline" onclick={() => (changing = true)}
								>Use a different Firstmate</Button
							>
						{/if}
					</div>
					{#if !view.canChoose}
						<p class="mt-3 text-xs text-muted-foreground">
							To use a different one, start <code>wheelhouse open --firstmate &lt;dir&gt;</code>, or
							run it outside a Firstmate checkout.
						</p>
					{/if}
				{:else}
					<p class="mt-2 max-w-prose text-sm text-muted-foreground">
						{#if view.problem && !view.install}
							Wheelhouse did not find Firstmate on this computer.
						{/if}
						Firstmate is a folder: its own scripts and skills, cloned from
						<a
							class="text-sea hover:underline"
							href={view.repository.replace(/\.git$/, '')}
							target="_blank"
							rel="noreferrer">{view.repository.replace(/^https:\/\//, '').replace(/\.git$/, '')}</a
						>, which also keeps its records. Wheelhouse remembers where it is, so
						<code>wheelhouse open</code> finds it from any folder.
					</p>

					<div
						class="mt-6 grid gap-2 sm:grid-cols-2"
						role="radiogroup"
						aria-label="How to get Firstmate"
					>
						<button
							type="button"
							role="radio"
							aria-checked={mode === 'clone'}
							class="rounded-lg border px-4 py-3 text-left text-sm {mode === 'clone'
								? 'border-sea ring-1 ring-sea'
								: 'hover:bg-muted/50'}"
							onclick={() => {
								mode = 'clone';
								dir = view.defaultDir;
							}}
						>
							<FolderGit2 class="mb-1 size-4 text-sea" aria-hidden="true" />
							<span class="block font-medium">Clone Firstmate</span>
							<span class="block text-xs text-muted-foreground">Into a new or empty folder</span>
						</button>
						<button
							type="button"
							role="radio"
							aria-checked={mode === 'existing'}
							class="rounded-lg border px-4 py-3 text-left text-sm {mode === 'existing'
								? 'border-sea ring-1 ring-sea'
								: 'hover:bg-muted/50'}"
							onclick={() => {
								mode = 'existing';
								dir = view.found[0] ?? '';
							}}
						>
							<FolderOpen class="mb-1 size-4 text-sea" aria-hidden="true" />
							<span class="block font-medium">Use one I already have</span>
							<span class="block text-xs text-muted-foreground"
								>A Firstmate folder on this computer</span
							>
						</button>
					</div>

					{#if mode === 'existing' && view.found.length}
						<div class="mt-4">
							<p class="text-xs font-medium">Found on this computer</p>
							<ul class="mt-1 flex flex-wrap gap-2">
								{#each view.found as f (f)}
									<li>
										<button
											type="button"
											class="rounded-md border px-2.5 py-1 font-mono text-xs hover:bg-muted/60 {dir ===
											f
												? 'border-sea'
												: ''}"
											onclick={() => (dir = f)}>{f}</button
										>
									</li>
								{/each}
							</ul>
						</div>
					{/if}

					<label class="mt-4 grid gap-1">
						<span class="text-xs font-medium"
							>{mode === 'clone' ? 'Clone it to' : 'Firstmate folder'}</span
						>
						<input
							class="h-9 rounded-md border border-input bg-background px-2.5 font-mono text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
							name="dir"
							autocomplete="off"
							spellcheck="false"
							bind:value={dir}
						/>
					</label>
					{#if at && dir.trim()}
						<p
							class="mt-1.5 text-xs {at.kind === 'occupied' || at.kind === 'invalid'
								? 'text-danger'
								: at.kind === 'firstmate'
									? 'text-success'
									: 'text-muted-foreground'}"
							data-location={at.kind}
						>
							{at.message}
						</p>
					{/if}

					{#if mode === 'clone' && view.git.status !== 'ok'}
						<ul class="mt-4 divide-y rounded-lg border bg-card">
							<DepRow item={view.git} dryRun={view.dryRun} />
						</ul>
					{/if}

					<div class="mt-6 flex flex-wrap items-center gap-2">
						{#if at?.kind === 'firstmate'}
							<Button disabled={working !== null} onclick={() => useIt(at?.dir)}
								>Use this Firstmate</Button
							>
						{:else if mode === 'clone'}
							<Button
								disabled={working !== null ||
									view.git.status !== 'ok' ||
									!(at?.kind === 'new' || at?.kind === 'empty')}
								onclick={cloneIt}>Clone Firstmate here</Button
							>
						{/if}
						{#if changing}
							<Button variant="ghost" onclick={() => (changing = false)}
								>Keep the current one</Button
							>
						{/if}
					</div>
					{#if cloneOutput}
						<pre
							class="mt-3 max-h-40 overflow-auto rounded-md border bg-muted/40 px-2.5 py-1.5 font-mono text-[11px] whitespace-pre-wrap text-muted-foreground">{cloneOutput}</pre>
					{/if}
				{/if}
			{:else if step === 'tools'}
				<p class="mt-2 max-w-prose text-sm text-muted-foreground">
					What Firstmate needs, as its own check (<code>bin/fm-bootstrap.sh</code>) reports it{tools?.backend
						? ` for its ${tools.backend} backend`
						: ''}, on {view.platform.label}. One-click installs use npm or Homebrew and show you the
					command first; anything that needs sudo, a script or a sign-in is for your own terminal.
				</p>
				{#if view.session}
					{@const s = view.session}
					{@const chosen = s.saved ?? 'firstmate'}
					<div class="mt-4 rounded-lg border bg-card px-4 py-3" data-session-backend={s.backend}>
						<p class="text-sm font-medium">Where Firstmate’s session runs</p>
						<p class="mt-1 max-w-prose text-xs text-muted-foreground">
							Wheelhouse runs Firstmate in its own tmux session, or, experimentally, in a herdr
							session named <code>{s.herdrSession}</code> (herdr {s.herdrMinVersion} or newer). It never
							stops or restarts your herdr server or sessions.
						</p>
						{#if s.source === 'env'}
							<p class="mt-2 text-sm">
								Runs in <strong>{s.backend}</strong>, set by <code>--session-backend</code> or
								<code>WHEELHOUSE_SESSION_BACKEND</code>.
							</p>
						{:else}
							<div class="mt-3 flex flex-wrap gap-2" role="group" aria-label="Session backend">
								{#each [{ value: 'firstmate', label: `Same as Firstmate (${s.firstmate === 'herdr' ? 'herdr' : 'tmux'})` }, { value: 'tmux', label: 'tmux' }, { value: 'herdr', label: 'herdr (experimental)' }] as option (option.value)}
									<Button
										size="sm"
										variant={chosen === option.value ? 'default' : 'outline'}
										aria-pressed={chosen === option.value}
										disabled={working !== null}
										onclick={() =>
											chosen !== option.value &&
											chooseBackend(
												option.value === 'firstmate' ? null : (option.value as SessionBackendName)
											)}>{option.label}</Button
									>
								{/each}
							</div>
						{/if}
						{#if s.backend === 'herdr'}
							<p class="mt-2 text-xs {s.herdr.ok ? 'text-muted-foreground' : 'text-warning'}">
								{s.herdr.ok ? `herdr ${s.herdr.version} is installed.` : s.herdr.problem}
							</p>
						{/if}
						{#if s.warning}
							<p class="mt-2 text-xs text-warning" data-session-warning>
								<CircleAlert class="mr-1 inline size-3.5" />{s.warning}
							</p>
						{/if}
						{#if s.error}
							<p class="mt-2 text-xs text-danger">{s.error}</p>
						{/if}
					</div>
				{/if}
				{#if tools}
					{#if tools.error}
						<p
							class="mt-6 rounded-lg border border-danger/40 bg-danger/5 px-4 py-3 text-sm text-danger"
						>
							{tools.error}
						</p>
					{:else}
						{#if toolCounts}
							<p class="mt-4 text-sm" data-tools-summary>
								{#if toolCounts.missing === 0}
									<span class="font-medium text-success">Everything Firstmate needs is here.</span>
								{:else}
									<span class="font-medium">{toolCounts.missing} still to install or fix</span>
									<span class="text-muted-foreground">· {toolCounts.ready} ready</span>
								{/if}
							</p>
						{/if}
						<ul class="mt-3 divide-y rounded-lg border bg-card">
							{#each tools.items as item (item.tool)}
								<DepRow
									{item}
									dryRun={view.dryRun}
									busy={installing !== null}
									oninstall={() => installTool(item.tool)}
								/>
							{/each}
						</ul>
						{#if tools.notes.length}
							<details class="mt-3 text-xs text-muted-foreground">
								<summary class="cursor-pointer"
									>What else Firstmate’s check said ({tools.notes.length})</summary
								>
								<ul class="mt-1 list-disc pl-5">
									{#each tools.notes as n, i (i)}<li class="break-words">{n}</li>{/each}
								</ul>
							</details>
						{/if}
					{/if}
				{/if}
				<div class="mt-6 flex flex-wrap gap-2">
					<Button onclick={next}>Continue</Button>
					<Button variant="outline" disabled={working !== null} onclick={loadTools}
						><RotateCw />Check again</Button
					>
				</div>
			{:else if step === 'claude'}
				{#if harness !== 'claude'}
					<p class="mt-2 max-w-prose text-sm text-muted-foreground">
						You selected {toolName}. {view.tool?.installed
							? 'It is installed.'
							: 'Install it and check again.'} Sign in using the tool’s own terminal. Wheelhouse keeps
						its permission settings and shows its conversation in chat.
					</p>
					<Button variant="outline" onclick={refreshView}>Check again</Button>
				{:else}
					<p class="mt-2 max-w-prose text-sm text-muted-foreground">
						Wheelhouse runs Firstmate in Claude Code. Install it, then sign in and accept its terms
						yourself, in Claude Code’s own screen below: Wheelhouse never answers for you and never
						keeps what you type there.
					</p>
					{#if claude}
						<ul class="mt-6 divide-y rounded-lg border bg-card">
							<DepRow
								item={claude.install}
								dryRun={view.dryRun}
								busy={working !== null}
								oninstall={installClaude}
							/>
						</ul>
						{#if claude.installed}
							<div class="mt-6" data-claude-signed-in={String(claude.signedIn)}>
								{#if claude.signedIn === true}
									<p class="flex items-center gap-2 text-sm font-medium text-success">
										<Check class="size-4" />Signed in: Claude Code answered.
									</p>
								{:else if signingIn}
									<p class="max-w-prose text-sm">
										Sign in and accept the terms in Claude Code below. When it shows its prompt,
										type
										<code>/exit</code> and Wheelhouse tests it; or test it now.
									</p>
									<div class="mt-3 flex h-[26rem] flex-col">
										<Terminal
											token={token()}
											path={SETUP_TERMINAL_PATH}
											label="Claude Code, for signing in"
											connecting="Starting Claude Code…"
											detached="Claude Code exited."
											onclosed={terminalClosed}
										/>
									</div>
									<div class="mt-3 flex flex-wrap gap-2">
										<Button disabled={working !== null} onclick={testClaude}
											>I’m signed in: test it</Button
										>
										<Button variant="ghost" onclick={() => (signingIn = false)}
											>Close Claude Code</Button
										>
									</div>
								{:else}
									{#if claude.signedIn === false}
										<p class="max-w-prose text-sm text-warning">
											<CircleAlert class="mr-1 inline size-4" />Claude Code did not answer: {claude.detail}
										</p>
									{/if}
									<div class="mt-3 flex flex-wrap gap-2">
										<Button onclick={() => (signingIn = true)}>Sign in to Claude Code</Button>
										<Button variant="outline" disabled={working !== null} onclick={testClaude}
											>Test it</Button
										>
									</div>
									<p class="mt-2 text-xs text-muted-foreground">
										The test asks Claude Code for one word, with <code>claude -p</code>, in a folder
										of Wheelhouse’s own.
									</p>
								{/if}
							</div>
						{/if}
					{/if}
				{/if}
				<div class="mt-6 flex flex-wrap gap-2">
					<Button onclick={next} disabled={!facts.home}>Continue</Button>
				</div>
			{:else if step === 'check'}
				<p class="mt-2 max-w-prose text-sm text-muted-foreground">
					Firstmate’s own checks against its home (its bootstrap check and its readiness check), and
					Wheelhouse’s: that it can read this Firstmate and run its session.
				</p>
				{#if check}
					<ul class="mt-6 divide-y rounded-lg border bg-card">
						{#each check.lines as l (l.label)}
							<li class="flex items-start gap-3 px-4 py-3 text-sm" data-ok={String(l.ok)}>
								{#if l.ok}<Check class="mt-0.5 size-4 shrink-0 text-success" />{:else}<CircleAlert
										class="mt-0.5 size-4 shrink-0 text-warning"
									/>{/if}
								<div class="min-w-0">
									<p>{l.label}</p>
									{#if l.detail}<p class="text-xs break-words text-muted-foreground">
											{l.detail}
										</p>{/if}
								</div>
							</li>
						{/each}
					</ul>
				{/if}
				<div class="mt-6 flex flex-wrap gap-2">
					<Button onclick={next}>Continue</Button>
					<Button variant="outline" disabled={working !== null} onclick={runCheck}
						><RotateCw />Run again</Button
					>
				</div>
			{:else if step === 'plugins'}
				<p class="mt-2 max-w-prose text-sm text-muted-foreground">
					Plugins add pages, tabs and cards. The ones bundled with Wheelhouse turn on or off here
					for every project (change it per project later in Settings → Plugins); the others install
					from GitHub after you review what they are.
				</p>
				{#if plugins}
					<h2 class="mt-6 text-sm font-medium">Bundled with Wheelhouse</h2>
					<ul class="mt-2 divide-y rounded-lg border bg-card">
						{#each plugins.filter((p) => p.source === 'bundled') as p (p.id)}
							<li class="flex items-start gap-4 px-4 py-3" data-plugin={p.id}>
								<div class="min-w-0 flex-1">
									<p class="text-sm font-medium">{p.name}</p>
									{#if p.description}<p class="text-xs text-muted-foreground">
											{p.description}
										</p>{/if}
								</div>
								<Switch
									checked={p.on}
									label="{p.name} for every project"
									disabled={switching !== null}
									onchange={(on) => switchPlugin(p.id, on)}
								/>
							</li>
						{/each}
					</ul>
					<h2 class="mt-6 text-sm font-medium">To install</h2>
					<ul class="mt-2 divide-y rounded-lg border bg-card">
						{#each plugins.filter((p) => p.source === 'installable') as p (p.id)}
							<li class="flex flex-wrap items-start gap-4 px-4 py-3" data-plugin={p.id}>
								<div class="min-w-0 flex-1">
									<p class="text-sm font-medium">
										{p.name}
										<span class="font-mono text-xs font-normal text-muted-foreground"
											>{p.repository}</span
										>
									</p>
									{#if p.description}<p class="text-xs text-muted-foreground">
											{p.description}
										</p>{/if}
								</div>
								{#if p.on}
									<span class="flex items-center gap-1 text-xs text-success"
										><Check class="size-3.5" />Installed</span
									>
								{:else}
									<InstallFromGitHub suggested={p.repository} label="Review and install" />
								{/if}
							</li>
						{/each}
					</ul>
				{/if}
				<div class="mt-6 flex flex-wrap gap-2">
					<Button onclick={next}>Continue</Button>
				</div>
			{:else if step === 'finish'}
				{#if started}
					{#if started.state === 'ours' || started.state === 'starting'}
						<p class="mt-2 flex items-center gap-2 text-sm font-medium text-success">
							<Check class="size-4" />Firstmate is starting.
						</p>
						<p class="mt-1 max-w-prose text-sm text-muted-foreground">
							If {toolName} asks you something first (trusting the Firstmate folder, or accepting its
							permissions mode), answer it here. Then go to the chat.
						</p>
						<div class="mt-3 flex h-[22rem] flex-col">
							<Terminal token={token()} label="Firstmate’s terminal" />
						</div>
					{:else}
						<p class="mt-2 max-w-prose text-sm">
							{started.reason ??
								'Firstmate is already running in another session; Wheelhouse shows it.'}
						</p>
					{/if}
					<div class="mt-6"><Button onclick={() => goto('/')}>Open the Firstmate chat</Button></div>
				{:else}
					<p class="mt-2 max-w-prose text-sm text-muted-foreground">
						Wheelhouse starts Firstmate in {toolName}, in its own {view.session?.backend === 'herdr'
							? `herdr session (${view.session.herdrSession})`
							: 'tmux session'} (never a second one if Firstmate is already running), and opens its chat.
						You can run this wizard again from Settings → Setup.
					</p>
					{#if !finishable.ok}
						<p class="mt-4 text-sm text-warning">
							<CircleAlert class="mr-1 inline size-4" />{finishable.why}
						</p>
					{/if}
					<div class="mt-6">
						<Button disabled={!finishable.ok || working !== null} onclick={finish}
							>Start Firstmate</Button
						>
					</div>
				{/if}
			{/if}

			{#if working}
				<p class="mt-4 flex items-center gap-2 text-sm text-muted-foreground" role="status">
					<LoaderCircle class="size-4 animate-spin" />{working}
				</p>
			{/if}
			{#if error}
				<p
					class="mt-4 rounded-md border border-danger/40 bg-danger/5 px-3 py-2 text-sm text-danger"
					role="alert"
				>
					{error}
				</p>
			{/if}
		</section>
	</main>
</div>
