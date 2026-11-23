import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { baseFor } from './builtin';
import { addPresetStep, type PresetOptions } from './presets';
import { resolvePassage } from './resolve';
import { parsePassage } from './schema';

/**
 * `wheelhouse passage add-step`'s YAML: each preset's file is byte-for-byte
 * the golden one under testdata/, and passes the same validation the server's
 * passage/draft runs (the strict schema, then resolving over the built-in).
 */

const golden = (name: string) =>
	readFileSync(path.join(import.meta.dirname, 'testdata', name), 'utf8');

/** What passage/draft answers for a captain-owned file, without a server. */
function draftErrors(text: string, npmPackage: string | null = null): string[] {
	const r = parsePassage(text, { kind: 'overlay', captain: true, project: 'demo' });
	if (!r.ok) return r.errors;
	const layers = [{ origin: 'captain' as const, file: r.value }];
	return (
		resolvePassage(
			baseFor(
				'ship',
				npmPackage,
				layers.map((l) => l.file)
			),
			layers
		).errors.get('captain') ?? []
	);
}

const CASES: [string, PresetOptions][] = [
	['add-step-released.yaml', { preset: 'released' }],
	['add-step-on-npm.yaml', { preset: 'on-npm', package: '@acme/tool' }],
	['add-step-deployed-environment.yaml', { preset: 'deployed', environment: 'Production' }],
	['add-step-deployed-workflow.yaml', { preset: 'deployed', workflow: 'deploy.yml' }]
];

describe('passage add-step presets', () => {
	for (const [file, o] of CASES) {
		it(`writes ${file}, which passes draft validation`, () => {
			const r = addPresetStep('', o);
			expect(r.ok).toBe(true);
			if (!r.ok) return;
			expect(r.text).toBe(golden(file));
			expect(draftErrors(r.text)).toEqual([]);
		});
	}

	it('adds Deployed after a project’s built-in release steps', () => {
		const r = addPresetStep('', { preset: 'deployed', environment: 'Production', after: 'on-npm' });
		expect(r.ok && draftErrors(r.text, '@acme/tool')).toEqual([]);
	});

	it('adds to an existing file, keeping its comments, and leaves a step it already has', () => {
		const start = '# ours\nversion: 1\nextends: ship\n';
		const once = addPresetStep(start, { preset: 'released' });
		expect(once).toMatchObject({ ok: true, added: ['check release', 'step released'] });
		if (!once.ok) return;
		expect(once.text.startsWith('# ours\n')).toBe(true);
		const npm = addPresetStep(once.text, { preset: 'on-npm', package: '@acme/tool' });
		expect(npm).toMatchObject({ ok: true, added: ['check npm', 'step on-npm'] });
		if (!npm.ok) return;
		expect(draftErrors(npm.text)).toEqual([]);
		expect(addPresetStep(npm.text, { preset: 'released' })).toEqual({
			ok: true,
			text: npm.text,
			added: []
		});
	});

	it('accepts an existing Released step at a custom position when adding On npm', () => {
		const start = '# ours\nversion: 1\nextends: ship\n';
		const released = addPresetStep(start, { preset: 'released', after: 'qa-gate' });
		expect(released).toMatchObject({ ok: true, added: ['check release', 'step released'] });
		if (!released.ok) return;
		const npm = addPresetStep(released.text, { preset: 'on-npm', package: '@acme/tool' });
		expect(npm).toMatchObject({ ok: true, added: ['check npm', 'step on-npm'] });
		if (!npm.ok) return;
		const file = npm.text.includes('after: qa-gate');
		expect(file).toBe(true);
	});

	it('refuses to overwrite a different step or check of the same name', () => {
		const mine =
			'version: 1\nextends: ship\nstages:\n  - id: deployed\n    label: Live\n    after: landed\n';
		expect(addPresetStep(mine, { preset: 'deployed', environment: 'Production' })).toEqual({
			ok: false,
			error: 'the file already has a different step "deployed"'
		});
	});

	it('says what it needs, and refuses a scout passage or broken YAML', () => {
		expect(addPresetStep('', { preset: 'on-npm' })).toMatchObject({ ok: false });
		expect(addPresetStep('', { preset: 'deployed' })).toMatchObject({ ok: false });
		expect(
			addPresetStep('', { preset: 'deployed', environment: 'Production', workflow: 'd.yml' })
		).toMatchObject({ ok: false });
		expect(addPresetStep('version: 1\nextends: scout\n', { preset: 'released' })).toEqual({
			ok: false,
			error: 'add-step adds to the ship passage only'
		});
		expect(addPresetStep('version: [1\n', { preset: 'released' })).toMatchObject({ ok: false });
	});
});
