import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { materialDir } from './manifest';
import type { SkillsCli } from './ops';
import { materialView, setGroup } from './settings';
import { MaterialSync, syncMaterial, type SyncInputs } from './sync';

let root: string;
let c: SkillsCli;
let synced: MaterialSync;
const brief = () => path.join(root, 'home/config/brief-include.md');
const contextFile = () => path.join(root, 'state/session-context.json');

function setUp(inputs: SyncInputs) {
	c = {
		ctx: {
			install: { firstmateDir: path.join(root, 'code'), homeDir: path.join(root, 'home') },
			env: { HOME: path.join(root, 'user') },
			configDir: path.join(root, 'config'),
			skillsRoot: path.join(root, 'skills'),
			version: '1.0.0',
			commit: async () => null,
			briefInclude: brief(),
			contextFile: contextFile(),
			url: 'http://127.0.0.1:4310/'
		},
		inputs,
		dir: materialDir(path.join(root, 'config'))
	};
	synced = new MaterialSync(
		async () => ({ ...inputs, firstmateCommit: null }),
		(i) => syncMaterial(c.ctx, i)
	);
}

beforeEach(async () => {
	root = await mkdtemp(path.join(tmpdir(), 'wh-material-settings-'));
	for (const name of ['manage-wheelhouse', 'wheelhouse-preview', 'wheelhouse-passage']) {
		await mkdir(path.join(root, 'skills', name), { recursive: true });
		await writeFile(path.join(root, 'skills', name, 'SKILL.md'), `${name}\n`);
	}
	setUp({ reviewSurface: null, harness: 'claude' });
});
afterEach(async () => {
	await rm(root, { recursive: true, force: true });
});

describe('Settings → Agent material', () => {
	it('lists each skill, the worker block and the session context as they were installed', async () => {
		await synced.sync();
		const view = await materialView(c, synced);
		expect(view.rows.map((r) => [r.group, r.on, r.items.map((i) => i.state)])).toEqual([
			['manage-wheelhouse', true, ['installed']],
			['wheelhouse-preview', true, ['installed']],
			['wheelhouse-passage', true, ['installed']],
			['brief', true, ['installed']],
			['context', true, ['installed']]
		]);
		expect(JSON.parse(await readFile(contextFile(), 'utf8')).hookSpecificOutput).toMatchObject({
			hookEventName: 'SessionStart'
		});
	});

	it('turns the worker block and the session context off, and on again', async () => {
		await mkdir(path.dirname(brief()), { recursive: true });
		await writeFile(brief(), 'Captain’s rule.\n');
		await synced.sync();
		expect(await setGroup(c, synced, 'brief', false)).toMatchObject({ ok: true });
		expect(await readFile(brief(), 'utf8')).toBe('Captain’s rule.\n');
		expect(await setGroup(c, synced, 'context', false)).toMatchObject({ ok: true });
		await expect(readFile(contextFile(), 'utf8')).rejects.toThrow();
		let view = await materialView(c, synced);
		expect(view.rows.filter((r) => !r.on).map((r) => [r.group, r.items[0].state])).toEqual([
			['brief', 'off'],
			['context', 'off']
		]);
		await setGroup(c, synced, 'brief', true);
		await setGroup(c, synced, 'context', true);
		expect(await readFile(brief(), 'utf8')).toContain('## Wheelhouse');
		expect(await readFile(contextFile(), 'utf8')).toContain('additionalContext');
		view = await materialView(c, synced);
		expect(view.rows.every((r) => r.on)).toBe(true);
	});

	it('turns a skill off in every skills folder it went to', async () => {
		setUp({ reviewSurface: null, harness: 'codex' });
		await synced.sync();
		expect(await setGroup(c, synced, 'wheelhouse-passage', false)).toMatchObject({ ok: true });
		const row = (await materialView(c, synced)).rows.find((r) => r.group === 'wheelhouse-passage')!;
		expect(row.on).toBe(false);
		expect(row.items.map((i) => [i.id, i.state])).toEqual([
			['skill:wheelhouse-passage@claude', 'off'],
			['skill:wheelhouse-passage@agents', 'off']
		]);
	});

	it('says the session context is not available on a harness that does not take it yet', async () => {
		setUp({ reviewSurface: null, harness: 'codex' });
		await synced.sync();
		const row = (await materialView(c, synced)).rows.find((r) => r.group === 'context')!;
		expect(row.unavailable).toContain('codex');
		expect(row.items).toEqual([]);
	});
});
