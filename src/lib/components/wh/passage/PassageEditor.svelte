<script lang="ts">
	import { beforeNavigate } from '$app/navigation';
	import { SvelteSet } from 'svelte/reactivity';
	import { page } from '$app/state';
	import { Button } from '$lib/components/ui/button';
	import { SESSION_HEADER } from '$lib/client/messages';
	import {
		addStage,
		edit,
		entryFor,
		listSteps,
		model,
		moveStage,
		placeStage,
		renameCheck,
		renameStage,
		summarize,
		refsTo,
		removeStage,
		setCheck,
		setStageField,
		setTop,
		slug,
		starterText,
		toBuilder,
		fromBuilder,
		type Cond,
		type StageLike
	} from '$lib/passage-edit';
	import {
		CHECK_WORDS,
		EVIDENCE_WORDS,
		FACT_WORDS,
		OUTCOMES,
		outcomeWords,
		type CheckTypeName
	} from '$lib/passage-meta';
	import type {
		PassageCommand,
		PassageDraft,
		PassageEditorFile,
		PassageTestTask,
		Track
	} from '$lib/types';
	import CheckForm from './CheckForm.svelte';
	import ReviewDialog from './ReviewDialog.svelte';
	import StepForm from './StepForm.svelte';
	import TestPanel from './TestPanel.svelte';
	import { ArrowDown, ArrowUp, CircleAlert, CircleCheck, FlaskConical, Plus } from '@lucide/svelte';

	let {
		editor,
		tasks,
		onsaved
	}: {
		editor: PassageEditorFile;
		tasks: PassageTestTask[];
		onsaved: (e: PassageEditorFile, tasks: PassageTestTask[]) => void;
	} = $props();

	// The editor works on the file's text; the form edits its YAML document in place.
	// svelte-ignore state_referenced_locally
	const loadedText = editor.file.exists ? editor.file.text : starterText();
	let text = $state(loadedText);
	let view = $state<'form' | 'yaml'>('form');
	let selected = $state<{ kind: 'step' | 'check'; id: string } | null>(null);
	let testing = $state(false);
	let reviewing = $state(false);
	let saving = $state(false);
	let saveError = $state<string | null>(null);
	let savedNote = $state<string | null>(null);
	let draft = $state<PassageDraft | null>(null);
	let checking = $state(false);
	let showProblems = $state(false);

	const m = $derived(model(text));
	const track: Track = $derived(m?.extends ?? 'ship');
	const base = $derived(editor.below[track]);
	const steps = $derived(m ? listSteps(base, m.stages) : []);
	const fileChecks = $derived(m?.checks ?? {});
	const dirty = $derived(text !== loadedText);
	const yamlBroken = $derived(m === null);
	const problems = $derived(yamlBroken ? ['The YAML could not be read.'] : (draft?.errors ?? []));
	const commands: PassageCommand[] = $derived(draft?.commands ?? []);
	const project = $derived(editor.target === 'project');
	const branch = $derived(editor.defaultRef?.replace(/^origin\//, '') ?? 'the default branch');

	/** Every check the passage can reference: those below the file, then the file's own. */
	const allChecks = $derived.by(() => {
		const out: Record<string, { id: string; label: string; type: string; mine: boolean }> = {};
		for (const c of base.checks) out[c.id] = { ...c, mine: false };
		for (const [id, spec] of Object.entries(fileChecks)) {
			out[id] = {
				id,
				label: typeof spec?.label === 'string' && spec.label ? spec.label : id,
				type: String(spec?.type ?? ''),
				mine: true
			};
		}
		return Object.values(out);
	});

	const refs = $derived([
		{
			group: 'Firstmate',
			options: Object.entries(FACT_WORDS).map(([value, label]) => ({
				value,
				label: label.charAt(0).toUpperCase() + label.slice(1)
			}))
		},
		...allChecks.map((c) => ({
			group: c.label,
			options: (OUTCOMES[c.type as CheckTypeName] ?? []).map((o) => ({
				value: `${c.id}.${o}`,
				label: `${c.label} ${outcomeWords(o)}`
			}))
		}))
	]);
	const evidence = $derived([
		...Object.entries(EVIDENCE_WORDS).map(([value, label]) => ({ value, label })),
		...allChecks.map((c) => ({ value: `check:${c.id}`, label: `${c.label} result` }))
	]);

	// Live validation with the server's strict validator, a moment after typing stops.
	$effect(() => {
		const t = text;
		if (yamlBroken) return;
		checking = true;
		const timer = setTimeout(async () => {
			try {
				const res = await fetch(
					`/api/projects/${encodeURIComponent(editor.projectId)}/passage/draft`,
					{
						method: 'POST',
						headers: {
							'content-type': 'application/json',
							[SESSION_HEADER]: page.data.sessionToken as string
						},
						body: JSON.stringify({ target: editor.target, text: t })
					}
				);
				const body = await res.json().catch(() => null);
				if (t === text && body && Array.isArray(body.errors)) draft = body;
			} catch {
				// Keep the last result; saving re-validates on the server anyway.
			} finally {
				if (t === text) checking = false;
			}
		}, 300);
		return () => clearTimeout(timer);
	});

	beforeNavigate(({ cancel, willUnload }) => {
		if (dirty && !saving && !willUnload && !confirm('Leave without saving your changes?')) cancel();
	});

	const change = (fn: Parameters<typeof edit>[1]) => {
		text = edit(text, fn);
		savedNote = null;
	};

	const sel = $derived(
		selected?.kind === 'step' ? steps.find((s) => s.id === selected!.id) : undefined
	);
	const entry = $derived(sel && sel.fileIndex !== null ? (m?.stages[sel.fileIndex] ?? null) : null);
	const declared = $derived.by(() => {
		if (!sel) return 'builtin' as const;
		if (sel.added) return 'file' as const;
		return base.steps.find((s) => s.id === sel.id)?.origin ?? 'builtin';
	});
	const selIndex = $derived(sel ? steps.indexOf(sel) : -1);

	// Steps and checks added since the page opened take their id from their name until saved.
	const fresh = new SvelteSet<string>();
	const freshChecks = new SvelteSet<string>();
	// Step ids and check ids are separate: each only has to be unique among its own kind.
	const taken = (except: string) => steps.map((s) => s.id).filter((x) => x !== except);
	const takenChecks = (except: string) => allChecks.map((c) => c.id).filter((x) => x !== except);

	function stageField(key: string, value: unknown) {
		if (!sel) return;
		const id = sel.id;
		change((d) => {
			const i = sel!.fileIndex ?? entryFor(d, id);
			setStageField(d, i, key, value);
		});
	}

	/** A new step's name is finished: its id follows the name. */
	function stepNamed() {
		if (!sel || !fresh.has(sel.id)) return;
		const id = sel.id;
		const name = typeof entry?.label === 'string' ? entry.label.trim() : '';
		if (!name) return;
		const to = slug(name, taken(id));
		if (to === id) return;
		change((d) => renameStage(d, id, to));
		fresh.delete(id);
		fresh.add(to);
		selected = { kind: 'step', id: to };
	}

	/** A new check's name is finished: its id follows the name. */
	function checkNamed(id: string) {
		if (!freshChecks.has(id)) return;
		const label = fileChecks[id]?.label;
		if (typeof label !== 'string' || !label.trim()) return;
		const to = slug(label, takenChecks(id), 'check');
		if (to === id) return;
		change((d) => renameCheck(d, id, to));
		freshChecks.delete(id);
		freshChecks.add(to);
		selected = { kind: 'check', id: to };
	}

	/** Select a step or check; on narrow screens, bring its form into view. */
	function pick(kind: 'step' | 'check', id: string) {
		selected = { kind, id };
		if (typeof window !== 'undefined' && window.innerWidth < 1024) {
			requestAnimationFrame(() =>
				document
					.getElementById('passage-detail')
					?.scrollIntoView({ behavior: 'smooth', block: 'start' })
			);
		}
	}

	function addStep() {
		const id = slug('New step', taken(''));
		const after = sel?.id ?? steps.at(-1)?.id ?? null;
		const at = sel ? steps.indexOf(sel) + 1 : steps.length;
		change((d) => {
			addStage(d, { id, label: 'New step', reached_when: 'merged' }, after);
			placeStage(d, base, id, at);
		});
		fresh.add(id);
		pick('step', id);
	}

	function removeStep() {
		if (!sel || sel.fileIndex === null) return;
		if (!confirm(`Remove the step “${sel.label}” from this file?`)) return;
		const i = sel.fileIndex;
		change((d) => removeStage(d, i));
		selected = null;
	}

	function resetStep() {
		if (!sel || sel.fileIndex === null) return;
		const i = sel.fileIndex;
		change((d) => removeStage(d, i));
	}

	const SUCCESS: Record<CheckTypeName, string> = {
		'github.deployment': 'success',
		'github.workflow': 'success',
		'github.release': 'included',
		'npm.published': 'published',
		http: 'ok',
		'git.contains': 'yes',
		'status.note': 'present',
		command: 'passed'
	};
	const FAILURE: Partial<Record<CheckTypeName, string>> = {
		'github.deployment': 'failure',
		'github.workflow': 'failure',
		command: 'failed'
	};
	const STARTER: Record<CheckTypeName, Record<string, unknown>> = {
		'github.deployment': { ref: 'merge.commit' },
		'github.workflow': { ref: 'pr.head' },
		'github.release': { contains: 'merge.commit' },
		'npm.published': {},
		http: {},
		'git.contains': { repo: 'project-clone', commit: 'merge.commit' },
		'status.note': { prefix: 'preview' },
		command: { timeout: '5m' }
	};

	/** Add a check of this type to the selected step: it reaches (and fails) the step, and shows. */
	function addCheck(type: CheckTypeName) {
		if (!sel) return;
		const step = sel;
		// Named after its step, so the step and its check read together.
		const name = allChecks.some((c) => c.label === step.label)
			? `${step.label}: ${CHECK_WORDS[type].name.toLowerCase()}`
			: step.label;
		const id = slug(name, takenChecks(''), 'check');
		// A command on a step after the merge runs only after the merge.
		const landed = steps.findIndex((s) => s.id === 'landed');
		const afterMerge = landed >= 0 && steps.indexOf(step) > landed;
		change((d) => {
			setCheck(d, id, {
				type,
				label: name,
				...STARTER[type],
				...(type === 'command' && afterMerge ? { when: 'merged' } : {})
			});
			const i = step.fileIndex ?? entryFor(d, step.id);
			const st = (d.toJS() as { stages: StageLike[] }).stages[i];
			if (declared !== 'builtin') {
				const add = (cur: Cond | undefined, ref: string) => {
					const b = toBuilder(cur);
					if (!b) return cur;
					// A placeholder "merged" from a new step gives way to the check.
					const items = b.items.filter((x) => !(x.ref === 'merged' && !x.not && step.added));
					return fromBuilder({ ...b, items: [...items, { not: false, ref }] });
				};
				setStageField(d, i, 'reached_when', add(st.reached_when, `${id}.${SUCCESS[type]}`));
				if (FAILURE[type])
					setStageField(d, i, 'failed_when', add(st.failed_when, `${id}.${FAILURE[type]}`));
			}
			const ev = Array.isArray(st.evidence) ? (st.evidence as string[]) : [];
			setStageField(d, i, 'evidence', [...ev, `check:${id}`]);
		});
		freshChecks.add(id);
		backTo = step.id;
		pick('check', id);
	}

	/** The step a check was opened from, for its Back link. */
	let backTo = $state<string | null>(null);

	const usesOf = (stageId: string) => {
		const s = m?.stages.find((x) => x.id === stageId);
		if (!s) return [];
		return allChecks.filter((c) => refsTo([s], c.id).length > 0);
	};

	const selCheck = $derived(
		selected?.kind === 'check' ? allChecks.find((c) => c.id === selected!.id) : undefined
	);

	function removeCheck(id: string) {
		if (!confirm('Remove this check? Steps that use it stop using it.')) return;
		change((d) => {
			setCheck(d, id, null);
			const stages = ((d.toJS() as { stages?: StageLike[] }).stages ?? []) as StageLike[];
			stages.forEach((s, i) => {
				for (const k of ['reached_when', 'failed_when', 'skip_when'] as const) {
					const b = toBuilder(s[k]);
					if (b && s[k] !== undefined)
						setStageField(
							d,
							i,
							k,
							fromBuilder({ ...b, items: b.items.filter((x) => !x.ref.startsWith(`${id}.`)) })
						);
				}
				if (Array.isArray(s.evidence))
					setStageField(
						d,
						i,
						'evidence',
						(s.evidence as string[]).filter((e) => e !== `check:${id}`)
					);
				if (s.primary_link === `${id}.url`) setStageField(d, i, 'primary_link', undefined);
			});
		});
		selected = null;
	}

	async function save() {
		saving = true;
		saveError = null;
		try {
			const res = await fetch(
				`/api/projects/${encodeURIComponent(editor.projectId)}/passage/file`,
				{
					method: 'PUT',
					headers: {
						'content-type': 'application/json',
						[SESSION_HEADER]: page.data.sessionToken as string
					},
					body: JSON.stringify({ target: editor.target, text, baseDigest: editor.file.digest })
				}
			);
			const body = await res.json().catch(() => null);
			if (res.ok && body?.schema === 'wheelhouse-passage-editor.v1') {
				reviewing = false;
				const { tasks: t, ...e } = body;
				onsaved(e, t);
			} else {
				saveError =
					(typeof body?.message === 'string'
						? body.message
						: `Wheelhouse answered ${res.status}.`) +
					(Array.isArray(body?.errors) && body.errors.length ? ` ${body.errors[0]}` : '');
			}
		} catch {
			saveError = 'Could not reach the Wheelhouse server.';
		} finally {
			saving = false;
		}
	}

	const tabClass = (on: boolean) =>
		`inline-flex items-center rounded-sm px-3 py-1.5 text-sm ${on ? 'bg-card font-medium shadow-xs' : 'text-muted-foreground hover:text-foreground'}`;
</script>

<div class="mt-6 flex flex-wrap items-center gap-x-4 gap-y-3 border-y py-3">
	<div class="inline-flex rounded-md bg-muted p-0.5" role="tablist" aria-label="Edit as">
		<button
			type="button"
			role="tab"
			aria-selected={view === 'form'}
			class={tabClass(view === 'form')}
			onclick={() => (view = 'form')}>Form</button
		>
		<button
			type="button"
			role="tab"
			aria-selected={view === 'yaml'}
			class={tabClass(view === 'yaml')}
			onclick={() => (view = 'yaml')}>YAML</button
		>
	</div>
	<label class="inline-flex items-center gap-2 text-sm">
		<span class="text-muted-foreground">Builds on</span>
		<select
			class="rounded-md border border-input bg-card px-2 py-1 text-sm"
			value={track}
			disabled={yamlBroken}
			onchange={(e) => {
				const v = (e.currentTarget as HTMLSelectElement).value;
				change((d) => setTop(d, 'extends', v));
				selected = null;
			}}
		>
			<option value="ship">Ship work</option>
			<option value="scout">Scout work</option>
		</select>
	</label>
	<div class="min-w-0 flex-1 text-sm" aria-live="polite">
		{#if problems.length}
			<button
				type="button"
				class="inline-flex items-center gap-1.5 text-danger hover:underline"
				aria-expanded={showProblems}
				onclick={() => (showProblems = !showProblems)}
				><CircleAlert class="size-4" aria-hidden="true" />{problems.length === 1
					? '1 problem'
					: `${problems.length} problems`}; it can’t be saved yet</button
			>
		{:else if checking || !draft}
			<span class="text-muted-foreground">Checking…</span>
		{:else}
			<span class="inline-flex items-center gap-1.5 whitespace-nowrap text-success"
				><CircleCheck class="size-4" aria-hidden="true" />No problems</span
			>
		{/if}
	</div>
	<div class="flex gap-2">
		<Button variant="outline" onclick={() => (testing = !testing)} aria-expanded={testing}
			><FlaskConical aria-hidden="true" />Test</Button
		>
		<Button
			disabled={!dirty || problems.length > 0 || checking}
			onclick={() => {
				saveError = null;
				reviewing = true;
			}}>Review and save</Button
		>
	</div>
</div>

{#if showProblems && problems.length}
	<ul
		class="mt-3 space-y-1 rounded-lg border border-danger/40 bg-danger/5 px-4 py-3 text-sm text-danger"
		role="alert"
	>
		{#each problems as p, i (i)}<li class="font-mono text-xs leading-5 break-words">{p}</li>{/each}
	</ul>
{/if}
{#if savedNote}<p class="mt-3 text-sm text-success" role="status">{savedNote}</p>{/if}

{#if testing}
	<div class="mt-5">
		<TestPanel
			projectId={editor.projectId}
			target={editor.target}
			{text}
			{track}
			{tasks}
			{commands}
			blocked={problems.length > 0}
			onclose={() => (testing = false)}
		/>
	</div>
{/if}

{#if view === 'yaml' || yamlBroken}
	<div class="mt-6">
		{#if yamlBroken && view === 'form'}
			<p class="mb-3 text-sm text-danger">
				The YAML could not be read, so the form is unavailable. Fix it here.
			</p>
		{/if}
		<label for="yaml" class="sr-only">The passage file as YAML</label>
		<textarea
			id="yaml"
			class="min-h-[60vh] w-full rounded-lg border border-input bg-card p-4 font-mono text-sm leading-6"
			spellcheck="false"
			bind:value={text}></textarea>
	</div>
{:else}
	<div class="mt-6 grid gap-8 lg:grid-cols-[minmax(17rem,24rem)_minmax(0,1fr)]">
		<div class="min-w-0 space-y-8">
			<section aria-labelledby="steps-title">
				<h2 id="steps-title" class="text-sm font-medium">Steps, in order</h2>
				<ol class="mt-2 divide-y rounded-xl border bg-card" data-step-list>
					{#each steps as s, i (s.id)}
						{@const on = selected?.kind === 'step' && selected.id === s.id}
						<li>
							<button
								type="button"
								class="flex w-full items-baseline gap-2 px-3 py-2.5 text-left text-sm hover:bg-muted/60 {on
									? 'bg-sea/10'
									: ''}"
								aria-current={on ? 'true' : undefined}
								data-step={s.id}
								onclick={() => {
									backTo = null;
									pick('step', s.id);
								}}
							>
								<span class="tabular w-5 shrink-0 text-muted-foreground">{i + 1}.</span>
								<span class="min-w-0 flex-1 {on ? 'font-medium' : ''}">{s.label}</span>
								<span class="text-xs {s.lost ? 'text-danger' : 'text-muted-foreground'}"
									>{s.lost
										? 'misplaced'
										: s.added
											? 'added here'
											: s.restyled
												? 'changed here'
												: ''}</span
								>
							</button>
							{#if on && s.added}
								<div class="flex gap-1 px-3 pb-2" role="group" aria-label="Move {s.label}">
									<Button
										variant="ghost"
										size="xs"
										disabled={i <= 1}
										onclick={() => change((d) => moveStage(d, base, s.id, -1))}
										><ArrowUp aria-hidden="true" />Up</Button
									>
									<Button
										variant="ghost"
										size="xs"
										disabled={i >= steps.length - 1}
										onclick={() => change((d) => moveStage(d, base, s.id, 1))}
										><ArrowDown aria-hidden="true" />Down</Button
									>
								</div>
							{/if}
						</li>
					{/each}
				</ol>
				<Button variant="outline" size="sm" class="mt-3" onclick={addStep}
					><Plus aria-hidden="true" />Add a step{sel ? ` after ${sel.label}` : ''}</Button
				>
			</section>

			<section aria-labelledby="checks-title">
				<h2 id="checks-title" class="text-sm font-medium">Checks</h2>
				{#if allChecks.length}
					<ul class="mt-2 divide-y rounded-xl border bg-card">
						{#each allChecks as c (c.id)}
							{@const on = selected?.kind === 'check' && selected.id === c.id}
							<li>
								<button
									type="button"
									class="flex w-full items-baseline justify-between gap-3 px-3 py-2.5 text-left text-sm hover:bg-muted/60 {on
										? 'bg-sea/10'
										: ''}"
									aria-current={on ? 'true' : undefined}
									onclick={() => {
										backTo = null;
										pick('check', c.id);
									}}
								>
									<span class="min-w-0 {on ? 'font-medium' : ''}">{c.label}</span>
									<span class="text-xs text-muted-foreground"
										>{CHECK_WORDS[c.type as CheckTypeName]?.name ?? c.type}{c.mine
											? ''
											: ', below'}</span
									>
								</button>
							</li>
						{/each}
					</ul>
				{:else}
					<p class="mt-1 text-sm text-muted-foreground">
						None yet. Choose a step and add a check to it.
					</p>
				{/if}
			</section>
		</div>

		<div id="passage-detail" class="min-w-0 scroll-mt-20 rounded-xl border bg-card p-5 lg:p-6">
			{#if sel}
				{#key sel.id}
					<StepForm
						step={sel}
						{entry}
						{declared}
						{refs}
						{evidence}
						links={allChecks}
						uses={usesOf(sel.id)}
						canUp={sel.added && selIndex > 1}
						canDown={sel.added && selIndex < steps.length - 1}
						onfield={stageField}
						onlabeldone={stepNamed}
						belowName={project
							? 'the built-in passage'
							: 'the repository file or the built-in passage'}
						onmove={(delta) => change((d) => moveStage(d, base, sel!.id, delta))}
						onremove={removeStep}
						onreset={resetStep}
						onopencheck={(id) => {
							backTo = sel!.id;
							pick('check', id);
						}}
						onaddcheck={addCheck}
					/>
				{/key}
			{:else if selCheck}
				{#key selCheck.id}
					<CheckForm
						checkId={selCheck.id}
						spec={selCheck.mine
							? fileChecks[selCheck.id]
							: { type: selCheck.type, label: selCheck.label }}
						readonly={!selCheck.mine}
						readonlyWhy={selCheck.mine
							? null
							: 'Declared in the project’s repository file; change it there.'}
						captain={!project}
						releaseChecks={allChecks.filter((c) => c.type === 'github.release')}
						usedBy={steps
							.filter((s) => usesOf(s.id).some((c) => c.id === selCheck.id))
							.map((s) => s.label)}
						onchange={(spec) => change((d) => setCheck(d, selCheck.id, spec))}
						onlabeldone={() => checkNamed(selCheck.id)}
						back={backTo && steps.some((s) => s.id === backTo)
							? {
									label: steps.find((s) => s.id === backTo)!.label,
									go: () => pick('step', backTo!)
								}
							: null}
						onremove={() => removeCheck(selCheck.id)}
					/>
				{/key}
			{:else}
				<div class="py-6 text-sm text-muted-foreground">
					<p>Choose a step or a check to edit it.</p>
					<p class="mt-1">Or add a step, such as a local deploy after the merge.</p>
				</div>
			{/if}
		</div>
	</div>
{/if}

<ReviewDialog
	bind:open={reviewing}
	before={editor.file.text}
	after={text}
	summary={reviewing ? summarize(editor.file.text, text, base) : []}
	target={editor.target}
	defaultRef={editor.defaultRef}
	busy={saving}
	error={saveError}
	onsave={save}
/>

<p class="mt-8 text-xs text-muted-foreground">
	{#if project}
		Saving writes the file in the project’s repository; Wheelhouse uses it once it is on {branch}.
	{:else}
		Saving writes your own file for this project; Wheelhouse uses it within a minute.
	{/if}
</p>
