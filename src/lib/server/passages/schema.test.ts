import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { BUILTIN } from './builtin';
import { resolvePassage, type Layer } from './resolve';
import { describeCond, parsePassage, type ValidateOptions } from './schema';

const fixture = (name: string) =>
	readFileSync(path.join(import.meta.dirname, 'testdata', name), 'utf8');
const overlay: ValidateOptions = { kind: 'overlay' };

function errors(text: string, opts: ValidateOptions = overlay): string[] {
	const r = parsePassage(text, opts);
	return r.ok ? [] : r.errors;
}

/** Parse and resolve one overlay on the ship passage; returns the layer's errors. */
function resolveErrors(text: string, opts: ValidateOptions = overlay): string[] {
	const r = parsePassage(text, opts);
	if (!r.ok) return r.errors;
	return (
		resolvePassage(BUILTIN.ship, [{ origin: 'project', file: r.value }]).errors.get('project') ?? []
	);
}

describe('passage file validation: good files', () => {
	it('accepts the example files and resolves their steps', () => {
		const web = parsePassage(fixture('web-app.wheelhouse.yaml'), overlay);
		const lib = parsePassage(fixture('cli-library.wheelhouse.yaml'), overlay);
		const fm = parsePassage(fixture('firstmate.captain.yaml'), {
			kind: 'overlay',
			captain: true,
			project: 'firstmate'
		});
		expect([web, lib, fm].map((r) => (r.ok ? 'ok' : r.errors))).toEqual(['ok', 'ok', 'ok']);
		if (!web.ok || !lib.ok || !fm.ok) return;

		const steps = (layers: Layer[]) => {
			const r = resolvePassage(BUILTIN.ship, layers);
			expect([...r.errors.values()].flat()).toEqual([]);
			return r.passage.steps.map((s) => s.id);
		};
		const ship = ['queued', 'building', 'checks', 'pr', 'review', 'landed'];
		expect(steps([{ origin: 'project', file: web.value }])).toEqual([...ship, 'deployed']);
		expect(steps([{ origin: 'project', file: lib.value }])).toEqual([
			...ship,
			'released',
			'published'
		]);
		expect(steps([{ origin: 'captain', file: fm.value }])).toEqual([...ship, 'aboard']);
	});

	it('accepts a minimal file and every check type', () => {
		expect(errors('version: 1\n')).toEqual([]);
		expect(
			resolveErrors(`
version: 1
checks:
  a: { type: github.deployment, environment: Production, ref: merge.commit, repo: acme/app }
  b: { type: github.workflow, workflow: deploy.yml, ref: merge.commit, event: push }
  c: { type: github.release, contains: merge.commit, tag_pattern: "v*" }
  d: { type: npm.published, package: left-pad, version_from: c }
  e: { type: http, url: "https://x.dev/v", method: HEAD, expect: { status: 204 } }
  f: { type: git.contains, repo: project-clone, commit: merge.commit }
  g: { type: status.note, prefix: preview }
stages:
  - id: shipped
    label: Shipped
    reached_when: { any: [a.success, b.success, c.included, d.latest, e.ok, f.yes, g.present] }
`)
		).toEqual([]);
	});

	it('reads conditions as plain words', () => {
		expect(
			describeCond({
				all: ['task.live', { not: { yolo: 'on' } }, { any: ['a.ok', { mode: 'direct-PR' }] }]
			})
		).toBe('task.live and (not yolo is on) and (a.ok or mode is direct-PR)');
	});
});

describe('passage file validation: bad files', () => {
	it('rejects a misspelled outcome or evidence block with a precise message', () => {
		const bad = fixture('web-app.wheelhouse.yaml')
			.replace('production.success', 'production.succes')
			.replace("'check:production'", "'check:staging'");
		expect(resolveErrors(bad)).toEqual([
			"deployed.reached_when: unknown reference 'production.succes' (production is a github.deployment check: success, failure, in_progress, inactive, absent)",
			"deployed.evidence: unknown 'check:staging' (use queue, progress, files, validation, pr, report, screenshots, preview, decision, landed, or check:<check>)"
		]);
	});

	it('rejects unknown fields, types and values', () => {
		expect(errors('version: 2\nstagez: []\n')).toEqual([
			"unknown field 'stagez'",
			'version: must be 1'
		]);
		expect(errors('version: 1\nchecks:\n  x: { type: ftp.get }\n')).toEqual([
			"checks.x.type: unknown check type 'ftp.get' (use github.deployment, github.workflow, github.release, npm.published, http, git.contains, status.note)"
		]);
		expect(
			errors('version: 1\nchecks:\n  x: { type: http, url: "https://a.b", colour: red }\n')
		).toEqual(["checks.x: unknown field 'colour'"]);
		expect(
			errors('version: 1\nchecks:\n  x: { type: github.deployment, environment: P, ref: main }\n')
		).toEqual(['checks.x.ref: must be one of merge.commit, pr.head']);
		expect(
			errors('version: 1\nstages:\n  - { id: Deployed, label: D, reached_when: merged }\n')
		).toEqual([
			"stages[0].id: 'Deployed' is not a valid step id (lower-case letters, digits and -)"
		]);
		expect(
			errors(
				'version: 1\nstages:\n  - { id: d, label: D, reached_when: merged, give_up_after: soon }\n'
			)
		).toEqual(['d.give_up_after: must be a duration such as 30s, 5m, 2h or 7d']);
		expect(
			errors('version: 1\nchecks:\n  x: { type: http, url: "https://a.b", interval: 5s }\n')
		).toEqual(['checks.x.interval: must be between 30 s and 1 days']);
	});

	it('refuses command checks: they are not supported yet', () => {
		expect(
			errors('version: 1\nchecks:\n  c: { type: command, argv: [x] }\n', {
				kind: 'overlay',
				captain: true
			})
		).toEqual(['checks.c.type: command checks are not supported yet']);
	});

	it('allows http credentials only in the captain-owned config', () => {
		const text =
			'version: 1\nchecks:\n  h:\n    type: http\n    url: "https://a.b/v"\n    headers_from_env: { Authorization: STATUS_TOKEN }\n';
		expect(errors(text)).toEqual([
			'checks.h.headers_from_env: is allowed only in the captain-owned Wheelhouse config'
		]);
		expect(errors(text, { kind: 'overlay', captain: true })).toEqual([]);
	});

	it('refuses URLs that are not http(s) or carry credentials', () => {
		expect(errors('version: 1\nchecks:\n  h: { type: http, url: "file:///etc/passwd" }\n')).toEqual(
			['checks.h.url: must be an http(s) URL without credentials']
		);
		expect(errors('version: 1\nchecks:\n  h: { type: http, url: "https://u:p@a.b/" }\n')).toEqual([
			'checks.h.url: must be an http(s) URL without credentials'
		]);
	});

	it('reserves fact prefixes as check ids', () => {
		expect(errors('version: 1\nchecks:\n  pr: { type: status.note, prefix: preview }\n')).toEqual([
			"checks.pr: 'pr' is reserved for Firstmate facts"
		]);
	});

	it('does not let a file change when a built-in step is reached', () => {
		expect(
			resolveErrors('version: 1\nstages:\n  - id: landed\n    reached_when: crew.done\n')
		).toEqual(["landed.reached_when: a built-in step's reached_when cannot be changed"]);
	});

	it('requires new steps to say when they are reached, and where they go', () => {
		expect(resolveErrors('version: 1\nstages:\n  - id: deployed\n    after: shipped\n')).toEqual([
			'deployed.label: a new step needs a label',
			'deployed.reached_when: a new step needs reached_when',
			"deployed.after: unknown step 'shipped'"
		]);
	});

	it('checks npm versions come from a release check, and the live step exists', () => {
		expect(
			resolveErrors(`
version: 1
checks:
  n: { type: npm.published, package: x, version_from: nope }
headline: { live: deployed }
`)
		).toEqual([
			"checks.n.version_from: 'nope' is not a github.release check",
			"headline.live: unknown step 'deployed'"
		]);
	});

	it('refuses YAML aliases, duplicate keys and oversized files', () => {
		expect(
			errors('version: 1\nchecks:\n  a: &x { type: status.note, prefix: preview }\n  b: *x\n')[0]
		).toMatch(/^YAML: /);
		expect(errors('version: 1\nversion: 1\n')[0]).toMatch(/^YAML: .*unique/i);
		expect(errors(`version: 1\n# ${'x'.repeat(70 * 1024)}\n`)).toEqual([
			'the file is larger than 64 KiB'
		]);
		expect(errors('- a list\n')).toEqual(['the file must be a YAML mapping']);
	});

	it('keeps a captain file to its own project', () => {
		expect(
			errors('version: 1\nproject: other\n', { kind: 'overlay', captain: true, project: 'mine' })
		).toEqual(["project: names 'other', but this file is for 'mine'"]);
	});
});

describe('precedence: built-ins, then the project file, then the captain config', () => {
	const parse = (text: string, captain = false) => {
		const r = parsePassage(text, { kind: 'overlay', captain });
		if (!r.ok) throw new Error(r.errors.join('; '));
		return r.value;
	};
	const project = parse(`
version: 1
checks:
  prod: { type: github.deployment, environment: Production, ref: merge.commit }
stages:
  - id: deployed
    label: Deployed
    after: landed
    reached_when: prod.success
headline: { live: deployed }
`);

	it('layers the captain config over the project file', () => {
		const captain = parse(
			`
version: 1
checks:
  prod: { type: github.deployment, environment: Live, ref: merge.commit }
stages:
  - id: deployed
    label: In production
    give_up_after: 2d
  - id: landed
    label: Merged
`,
			true
		);
		const { passage, errors } = resolvePassage(BUILTIN.ship, [
			{ origin: 'project', file: project },
			{ origin: 'captain', file: captain }
		]);
		expect(errors.size).toBe(0);
		const deployed = passage.steps.find((s) => s.id === 'deployed')!;
		expect(deployed).toMatchObject({
			label: 'In production',
			origin: 'project',
			changedBy: ['captain']
		});
		expect(deployed.giveUpAfter).toEqual({ text: '2d', ms: 2 * 86_400_000 });
		expect(passage.checks.get('prod')).toMatchObject({
			origin: 'captain',
			spec: { environment: 'Live' }
		});
		expect(passage.steps.find((s) => s.id === 'landed')).toMatchObject({
			label: 'Merged',
			short: 'Merged',
			origin: 'builtin'
		});
		expect(passage.liveStep).toBe('deployed');
	});

	it('leaves out a captain file that does not fit, keeping the project file', () => {
		const captain = parse(
			'version: 1\nstages:\n  - id: verified\n    label: Verified\n    reached_when: nope.ok\n',
			true
		);
		const { passage, errors } = resolvePassage(BUILTIN.ship, [
			{ origin: 'project', file: project },
			{ origin: 'captain', file: captain }
		]);
		expect(errors.get('captain')).toEqual(["verified.reached_when: unknown reference 'nope.ok'"]);
		expect(passage.steps.map((s) => s.id).at(-1)).toBe('deployed');
	});

	it('falls back to the built-in passage when the project file does not fit', () => {
		const broken = parse(
			'version: 1\nstages:\n  - id: deployed\n    label: Deployed\n    reached_when: prod.success\n'
		);
		const { passage, errors } = resolvePassage(BUILTIN.ship, [{ origin: 'project', file: broken }]);
		expect(errors.get('project')).toEqual([
			"deployed.reached_when: unknown reference 'prod.success'"
		]);
		expect(passage.steps.map((s) => s.id)).toEqual([
			'queued',
			'building',
			'checks',
			'pr',
			'review',
			'landed'
		]);
	});

	it('keeps several new steps placed after the same step in file order', () => {
		const f = parse(`
version: 1
stages:
  - { id: deployed, label: Deployed, after: landed, reached_when: merged }
  - { id: verified, label: Verified, after: landed, reached_when: merged }
`);
		const { passage } = resolvePassage(BUILTIN.ship, [{ origin: 'project', file: f }]);
		expect(passage.steps.map((s) => s.id).slice(-3)).toEqual(['landed', 'deployed', 'verified']);
	});
});
