import { describe, expect, it } from 'vitest';
import {
	addStage,
	edit,
	entryFor,
	fromBuilder,
	listSteps,
	model,
	moveStage,
	placeStage,
	renameStage,
	renameCheck,
	summarize,
	refsTo,
	removeStage,
	setCheck,
	setStageField,
	slug,
	toBuilder
} from './passage-edit';
import type { PassageEditorBase } from './types';

const base: PassageEditorBase = {
	steps: ['queued', 'building', 'checks', 'pr', 'review', 'landed'].map((id) => ({
		id,
		label: id[0].toUpperCase() + id.slice(1),
		origin: 'builtin' as const
	})),
	checks: []
};

const FILE = `# Our passage
version: 1
extends: ship
checks:
  deploy:
    type: command # runs locally
    run: [pnpm, "deploy:local"]
stages:
  - id: review
    label: Looked at
  - { id: local, label: Local deploy, after: landed, reached_when: deploy.passed }
  - { id: smoke, label: Smoke test, after: local, reached_when: deploy.passed }
`;

const ids = (text: string) => listSteps(base, model(text)!.stages).map((s) => s.id);

describe('the passage editor model', () => {
	it('lists steps in passage order, with renames and added steps', () => {
		const list = listSteps(base, model(FILE)!.stages);
		expect(list.map((s) => [s.id, s.label, s.added, s.fileIndex])).toEqual([
			['queued', 'Queued', false, null],
			['building', 'Building', false, null],
			['checks', 'Checks', false, null],
			['pr', 'Pr', false, null],
			['review', 'Looked at', false, 0],
			['landed', 'Landed', false, null],
			['local', 'Local deploy', true, 1],
			['smoke', 'Smoke test', true, 2]
		]);
	});

	it('edits fields in place, keeping the file’s comments', () => {
		const out = edit(FILE, (d) => setStageField(d, 1, 'label', 'Deploy locally'));
		expect(out).toContain('# Our passage');
		expect(out).toContain('# runs locally');
		expect(model(out)!.stages[1].label).toBe('Deploy locally');
		const cleared = edit(out, (d) => setStageField(d, 0, 'label', ''));
		expect(model(cleared)!.stages[0]).toEqual({ id: 'review' });
	});

	it('moves an added step and writes where it goes', () => {
		const up = edit(FILE, (d) => moveStage(d, base, 'local', -1));
		expect(ids(up)).toEqual([
			'queued',
			'building',
			'checks',
			'pr',
			'review',
			'local',
			'landed',
			'smoke'
		]);
		expect(model(up)!.stages.map((s) => [s.id, s.after])).toEqual([
			['review', undefined],
			['local', 'review'],
			['smoke', 'landed']
		]);
		const down = edit(up, (d) => moveStage(d, base, 'local', 1));
		expect(ids(down)).toEqual([
			'queued',
			'building',
			'checks',
			'pr',
			'review',
			'landed',
			'local',
			'smoke'
		]);
		// Built-in steps do not move, and nothing goes before the first step.
		expect(edit(FILE, (d) => moveStage(d, base, 'review', -1))).toBe(FILE);
		const top = edit(FILE, (d) => {
			for (let i = 0; i < 10; i++) moveStage(d, base, 'local', -1);
		});
		expect(ids(top)[1]).toBe('local');
	});

	it('places a new step right where it was asked for', () => {
		const out = edit(FILE, (d) => {
			addStage(d, { id: 'k8s', label: 'Kubernetes', reached_when: 'merged' }, 'landed');
			placeStage(d, base, 'k8s', 6);
		});
		expect(ids(out).slice(5)).toEqual(['landed', 'k8s', 'local', 'smoke']);
	});

	it('writes new lists inline and renames a new step with what refers to it', () => {
		const out = edit(FILE, (d) => {
			addStage(d, { id: 'k8s', label: 'Kubernetes', evidence: ['check:deploy'] }, 'smoke');
			setStageField(d, 1, 'evidence', ['landed', 'check:deploy']);
			renameStage(d, 'local', 'local-deploy');
		});
		expect(out).toMatch(/evidence: \[ ?landed, check:deploy ?\]/);
		expect(out).not.toMatch(/^\s+- check:deploy$/m);
		expect(model(out)!.stages.map((s) => [s.id, s.after])).toEqual([
			['review', undefined],
			['local-deploy', 'landed'],
			['smoke', 'local-deploy'],
			['k8s', 'smoke']
		]);
	});

	it('adds, restyles and removes steps', () => {
		const added = edit(FILE, (d) =>
			addStage(d, { id: 'k8s', label: 'Kubernetes', reached_when: 'merged' }, 'smoke')
		);
		expect(ids(added).at(-1)).toBe('k8s');
		const styled = edit(added, (d) => setStageField(d, entryFor(d, 'landed'), 'label', 'Shipped'));
		expect(listSteps(base, model(styled)!.stages).find((s) => s.id === 'landed')!.label).toBe(
			'Shipped'
		);
		const removed = edit(styled, (d) => removeStage(d, 3));
		expect(ids(removed)).not.toContain('k8s');
	});

	it('sets and removes checks, adding the checks map before the stages', () => {
		const text = 'version: 1\nstages:\n  - { id: a, label: A, reached_when: merged }\n';
		const out = edit(text, (d) =>
			setCheck(d, 'up', {
				type: 'http',
				url: 'https://x.dev',
				expect: { status: 200, json_pointer: '' }
			})
		);
		expect(out.indexOf('checks:')).toBeLessThan(out.indexOf('stages:'));
		expect(model(out)!.checks.up).toEqual({
			type: 'http',
			url: 'https://x.dev',
			expect: { status: 200 }
		});
		const kept = edit(FILE, (d) =>
			setCheck(d, 'deploy', { type: 'command', run: ['pnpm', 'deploy:local'], timeout: '20m' })
		);
		expect(kept).toContain('# runs locally');
		expect(model(kept)!.checks.deploy.timeout).toBe('20m');
		expect(model(edit(out, (d) => setCheck(d, 'up', null)))!.checks).toEqual({});
		expect(refsTo(model(FILE)!.stages, 'deploy')).toEqual(['deploy.passed', 'deploy.passed']);
	});

	it('turns conditions into a builder and back, or says it needs YAML', () => {
		expect(toBuilder('merged')).toEqual({ join: 'all', items: [{ not: false, ref: 'merged' }] });
		const b = toBuilder({ any: ['a.passed', { not: 'b.failed' }] })!;
		expect(b).toEqual({
			join: 'any',
			items: [
				{ not: false, ref: 'a.passed' },
				{ not: true, ref: 'b.failed' }
			]
		});
		expect(fromBuilder(b)).toEqual({ any: ['a.passed', { not: 'b.failed' }] });
		expect(fromBuilder({ join: 'all', items: [{ not: true, ref: 'x.ok' }] })).toEqual({
			not: 'x.ok'
		});
		expect(fromBuilder({ join: 'all', items: [] })).toBeUndefined();
		expect(toBuilder({ all: [{ any: ['a.ok', 'b.ok'] }] })).toBeNull();
		expect(toBuilder({ mode: 'yolo' })).toBeNull();
	});

	it('renames a check and every reference to it', () => {
		const out = edit(FILE, (d) => renameCheck(d, 'deploy', 'local-deploy'));
		expect(out).toContain('# runs locally');
		const m = model(out)!;
		expect(Object.keys(m.checks)).toEqual(['local-deploy']);
		expect(m.stages[1].reached_when).toBe('local-deploy.passed');
	});

	it('says what an edit changes in plain sentences', () => {
		const out = edit(FILE, (d) => {
			addStage(d, { id: 'k8s', label: 'Kubernetes', reached_when: 'merged' }, 'smoke');
			setStageField(d, 0, 'label', 'Checked by you');
			setCheck(d, 'deploy', { type: 'command', run: ['pnpm', 'deploy:local', '--force'] });
		});
		expect(summarize(FILE, out, base)).toEqual([
			'Renames “Looked at” to “Checked by you”.',
			'Adds the step “Kubernetes” after Smoke test.',
			'Changes the check “deploy”.',
			'Command checks change, so they stay off until you allow them again on the passage page.'
		]);
	});

	it('makes step ids from names', () => {
		expect(slug('Local deploy', [])).toBe('local-deploy');
		expect(slug('Local deploy', ['local-deploy'])).toBe('local-deploy-2');
		expect(slug('3rd party', [])).toBe('step-3rd-party');
		expect(slug('', [], 'check')).toBe('check');
	});
});
