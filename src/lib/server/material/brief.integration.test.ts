import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { briefBlock } from './bundle';
import { BRIEF_ID, syncMaterial, type MaterialContext } from './sync';

/**
 * The worker block as Firstmate reads it: Wheelhouse writes it into a scratch
 * home's config/brief-include.md, and a real Firstmate's bin/fm-brief.sh
 * scaffolds a brief from that home. Firstmate is a separate checkout, so this
 * runs only when WHEELHOUSE_TEST_FIRSTMATE names one.
 */
const firstmate = process.env.WHEELHOUSE_TEST_FIRSTMATE;
const runs = !!firstmate && existsSync(path.join(firstmate, 'bin/fm-brief.sh'));

describe.skipIf(!runs)('the worker block in a real Firstmate brief', () => {
	let root: string;
	let home: string;
	let ctx: MaterialContext;
	beforeEach(async () => {
		root = await mkdtemp(path.join(tmpdir(), 'wh-brief-include-'));
		home = path.join(root, 'home');
		await mkdir(path.join(home, 'config'), { recursive: true });
		await mkdir(path.join(home, 'projects/demo'), { recursive: true });
		execFileSync('git', ['init', '-q', path.join(home, 'projects/demo')]);
		// A home that is a git checkout ignores its config/, as Firstmate's does.
		execFileSync('git', ['init', '-q', home]);
		await writeFile(path.join(home, '.gitignore'), 'config/\nprojects/\ndata/\nstate/\n');
		await mkdir(path.join(root, 'skills/manage-wheelhouse'), { recursive: true });
		await writeFile(path.join(root, 'skills/manage-wheelhouse/SKILL.md'), 'skill\n');
		ctx = {
			install: { firstmateDir: firstmate!, homeDir: home },
			env: { HOME: path.join(root, 'user') },
			configDir: path.join(root, 'config'),
			skillsRoot: path.join(root, 'skills'),
			version: '1.0.0',
			commit: async () => null,
			skills: [{ name: 'manage-wheelhouse', assumptions: [] }],
			briefInclude: path.join(home, 'config/brief-include.md')
		};
	});
	afterEach(async () => {
		await rm(root, { recursive: true, force: true });
	});

	it('is appended to a ship brief after the captain’s own additions', async () => {
		await writeFile(ctx.briefInclude!, 'Captain’s own rule.\n');
		const r = await syncMaterial(ctx, { reviewSurface: null, harness: 'claude' });
		expect(r.items.find((i) => i.id === BRIEF_ID)?.state).toBe('installed');
		expect(r.drift).toEqual([]);
		execFileSync(
			path.join(firstmate!, 'bin/fm-brief.sh'),
			['t1', 'demo', '--mode', 'no-mistakes'],
			{
				env: { ...process.env, FM_HOME: home },
				stdio: 'pipe'
			}
		);
		const brief = await readFile(path.join(home, 'data/t1/brief.md'), 'utf8');
		const additions = brief.slice(brief.indexOf('# Home brief additions'));
		expect(additions).toContain('Captain’s own rule.');
		expect(additions).toContain(briefBlock({ reviewSurface: null }));
	});
});
