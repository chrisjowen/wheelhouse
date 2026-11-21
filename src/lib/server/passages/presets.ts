import { addStage, edit, model, setCheck, type StageLike } from '../../passage-edit';

/**
 * The steps `wheelhouse passage add-step` adds to a passage file, so an agent
 * never hand-writes YAML for the common cases: Released and On npm mirror the
 * built-in release steps (builtin.ts shipWithNpm), and Deployed follows the
 * `github.deployment` and `github.workflow` examples in docs/passages.md. The
 * result is plain passage-file text; the server validates it (passage/draft)
 * before it is saved.
 */

export const STEP_PRESETS = ['released', 'on-npm', 'deployed'] as const;
export type StepPreset = (typeof STEP_PRESETS)[number];

export interface PresetOptions {
	preset: StepPreset;
	/** on-npm: the npm package the project publishes. */
	package?: string;
	/** deployed: the GitHub deployment environment that marks it live… */
	environment?: string;
	/** …or the GitHub Actions workflow (file name or id) that deploys it. */
	workflow?: string;
	/** The step the new one follows (default: landed, or released for on-npm). */
	after?: string;
}

interface Addition {
	checks: Record<string, Record<string, unknown>>;
	stages: StageLike[];
}

const RELEASE_CHECK = {
	type: 'github.release',
	label: 'GitHub release',
	contains: 'merge.commit',
	tag_pattern: 'v*'
};

const released = (after: string): StageLike => ({
	id: 'released',
	label: 'Released',
	after,
	reached_when: 'release.included',
	evidence: ['check:release'],
	primary_link: 'release.url',
	give_up_after: '14d'
});

/** What a preset adds, or why it cannot. */
export function presetAddition(
	o: PresetOptions
): { ok: true; value: Addition } | { ok: false; error: string } {
	switch (o.preset) {
		case 'released':
			return {
				ok: true,
				value: { checks: { release: RELEASE_CHECK }, stages: [released(o.after ?? 'landed')] }
			};
		case 'on-npm': {
			if (!o.package) return { ok: false, error: 'name the npm package with --package' };
			return {
				ok: true,
				value: {
					checks: {
						release: RELEASE_CHECK,
						npm: {
							type: 'npm.published',
							label: 'npm package',
							package: o.package,
							version_from: 'release'
						}
					},
					stages: [
						released('landed'),
						{
							id: 'on-npm',
							label: 'On npm',
							after: o.after ?? 'released',
							reached_when: 'npm.published',
							evidence: ['check:npm'],
							primary_link: 'npm.url',
							give_up_after: '14d'
						}
					]
				}
			};
		}
		case 'deployed': {
			if (!o.environment === !o.workflow) {
				return {
					ok: false,
					error: 'name either the deployment --environment or the deploy --workflow'
				};
			}
			const deploy = o.environment
				? {
						type: 'github.deployment',
						label: `${o.environment} deployment`,
						environment: o.environment,
						ref: 'merge.commit'
					}
				: {
						type: 'github.workflow',
						label: 'Deploy workflow',
						workflow: o.workflow,
						ref: 'merge.commit'
					};
			return {
				ok: true,
				value: {
					checks: { deploy },
					stages: [
						{
							id: 'deployed',
							label: 'Deployed',
							after: o.after ?? 'landed',
							reached_when: 'deploy.success',
							failed_when: 'deploy.failure',
							evidence: ['check:deploy'],
							primary_link: 'deploy.url',
							give_up_after: '24h'
						}
					]
				}
			};
		}
	}
}

/** JSON with object keys sorted, so the same entry written in another order still matches. */
const canonical = (v: unknown): string =>
	JSON.stringify(v, (_k, x: unknown) =>
		x && typeof x === 'object' && !Array.isArray(x)
			? Object.fromEntries(Object.entries(x).sort(([a], [b]) => a.localeCompare(b)))
			: x
	);
const same = (a: unknown, b: unknown) => canonical(a) === canonical(b);

/**
 * `text` (a passage file, or '' for none yet) with the preset's checks and
 * steps added, keeping its comments and layout; or why not. A check or step
 * the file already has exactly as the preset would write it is left alone,
 * and one it has differently is refused rather than overwritten.
 */
export function addPresetStep(
	text: string,
	o: PresetOptions
): { ok: true; text: string; added: string[] } | { ok: false; error: string } {
	const add = presetAddition(o);
	if (!add.ok) return add;
	const file = model(text);
	if (!file) return { ok: false, error: 'the passage file is not valid YAML; fix it first' };
	if (file.extends !== 'ship')
		return { ok: false, error: 'add-step adds to the ship passage only' };
	const added: string[] = [];
	for (const [id, spec] of Object.entries(add.value.checks)) {
		const have = file.checks[id];
		if (have === undefined) added.push(`check ${id}`);
		else if (!same(have, spec)) {
			return { ok: false, error: `the file already has a different check named "${id}"` };
		}
	}
	for (const s of add.value.stages) {
		const have = file.stages.find((x) => x.id === s.id);
		if (have === undefined) added.push(`step ${s.id}`);
		else if (!same(have, s)) {
			return { ok: false, error: `the file already has a different step "${s.id}"` };
		}
	}
	if (!added.length) return { ok: true, text, added };
	const out = edit(text, (doc) => {
		for (const [id, spec] of Object.entries(add.value.checks)) {
			if (file.checks[id] === undefined) setCheck(doc, id, spec);
		}
		for (const s of add.value.stages) {
			if (file.stages.some((x) => x.id === s.id)) continue;
			const { after, ...rest } = s;
			addStage(doc, rest, typeof after === 'string' ? after : null);
		}
	});
	return { ok: true, text: out, added };
}
