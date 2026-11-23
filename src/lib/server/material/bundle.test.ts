import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { readTree } from './files';
import {
	briefBlock,
	renderSkill,
	REVIEW_SURFACE_MARKER,
	SKILLS,
	type ReviewSurface
} from './bundle';

// The package's own skills folder, as it is published.
const skillsRoot = path.resolve(__dirname, '../../../../skills');
const plugin: ReviewSurface = {
	id: 'human-review',
	name: 'Human Review',
	repository: 'org/human-review'
};

describe('the bundled skills', () => {
	it('are every folder in skills/, each with a SKILL.md named for its folder', async () => {
		const folders = (await readdir(skillsRoot, { withFileTypes: true }))
			.filter((e) => e.isDirectory())
			.map((e) => e.name)
			.sort();
		expect(SKILLS.map((s) => s.name).sort()).toEqual(folders);
		for (const skill of SKILLS) {
			const tree = await renderSkill(skillsRoot, skill, { reviewSurface: null });
			expect(tree['SKILL.md']).toMatch(new RegExp(`^---\\nname: ${skill.name}\\ndescription: `));
		}
	});

	it('name no host, person or private path: every captain gets them', async () => {
		for (const skill of SKILLS) {
			for (const [file, text] of Object.entries(
				await readTree(path.join(skillsRoot, skill.name))
			)) {
				expect(text, `${skill.name}/${file}`).not.toMatch(/\/Users\/|\/home\/|~\/Dev\b|chrisowen/);
			}
		}
	});

	it('render the review surface into the preview skill, for the built-in and for a plugin', async () => {
		const preview = SKILLS.find((s) => s.name === 'wheelhouse-preview')!;
		const builtin = (await renderSkill(skillsRoot, preview, { reviewSurface: null }))['SKILL.md'];
		expect(builtin).toContain('Active review surface: **built-in**');
		expect(builtin).not.toContain(REVIEW_SURFACE_MARKER);
		const chosen = (await renderSkill(skillsRoot, preview, { reviewSurface: plugin }))['SKILL.md'];
		expect(chosen).toContain('Active review surface: **Human Review**');
		expect(chosen).toContain('https://github.com/org/human-review');
	});
});

describe('the worker block', () => {
	it.each([
		['the built-in', null],
		['a plugin', plugin]
	])(
		'with %s as review surface, carries the rules and never a delivery contract',
		(_name, surface) => {
			const block = briefBlock({ reviewSurface: surface });
			expect(block).toMatch(/^## Wheelhouse\n/);
			expect(block).not.toMatch(/^Delivery contract: mode=/m);
			expect(block).not.toMatch(/Delivery contract/);
			expect(block).toContain('note [at=<epoch>]: preview http://127.0.0.1:<port>/<path>');
			expect(block).toContain('wh-vault run --only <NAME> -- <command>');
			expect(block).toContain(
				surface ? 'Human Review (the `human-review` plugin)' : 'the built-in'
			);
		}
	);
});
