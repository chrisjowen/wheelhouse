import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { EMPTY_CONFIG } from '../../server/plugins/config';
import { PluginRegistry } from '../../server/plugins/registry';
import type { Project, TaskSummary } from '../../types';
import type { BridgeCard, SlotEntry } from '../types';
import { projectLinks, webUrl } from './plugin.server';

describe('webUrl', () => {
	it('turns GitHub-style remotes into browser URLs without credentials', () => {
		expect(webUrl('git@github.com:chrisjowen/wheelhouse.git\n')).toBe(
			'https://github.com/chrisjowen/wheelhouse'
		);
		expect(webUrl('https://github.com/o/r.git')).toBe('https://github.com/o/r');
		expect(webUrl('https://user:token@github.com/o/r')).toBe('https://github.com/o/r');
		expect(webUrl('ssh://git@github.com/o/r.git')).toBe('https://github.com/o/r');
		expect(webUrl('/srv/git/r.git')).toBeNull();
		expect(webUrl('file:///srv/git/r.git')).toBeNull();
		expect(webUrl('https://github.com/o/r/extra')).toBeNull();
	});
});

describe('Project links, through every slot', () => {
	let dir: string;
	let reg: PluginRegistry;
	const ids = () => ({ projects: [] as Project[], tasks: [] as TaskSummary[] });
	const fleet = ids();

	beforeAll(() => {
		dir = mkdtempSync(path.join(tmpdir(), 'wh-project-links-'));
		execFileSync('git', ['init', '-q', dir]);
		execFileSync('git', ['-C', dir, 'remote', 'add', 'origin', 'git@github.com:o/r.git']);
		writeFileSync(path.join(dir, 'README.md'), '# Harbour Docs\n\nText.\n');
		fleet.projects.push({
			id: 'docs',
			name: 'Harbour docs',
			description: 'The docs site',
			path: dir
		});
		fleet.tasks.push({
			id: 'd-1',
			projectId: 'docs',
			title: 'Fix links',
			status: 'needs-review',
			branch: 'fm/d-1',
			pr: { url: 'https://github.com/o/r/pull/3', number: 3 },
			preview: null
		} as TaskSummary);
		reg = new PluginRegistry([projectLinks], {
			fleet: () => fleet,
			worktree: () => null,
			config: async () => ({ config: EMPTY_CONFIG, error: null })
		});
	});
	afterAll(() => rmSync(dir, { recursive: true, force: true }));

	const by = (entries: SlotEntry[]) => Object.fromEntries(entries.map((e) => [e.slot, e]));

	it('loads, on by default', () => {
		expect(reg.status()).toEqual([
			expect.objectContaining({
				id: 'project-links',
				state: 'loaded',
				enabledByDefault: true,
				slots: ['project.tab', 'harbour.card', 'task.section', 'step.evidence', 'bridge.card']
			})
		]);
	});

	it('fills the project tab and Harbour card', async () => {
		const s = by((await reg.slots({ scope: 'project', projectId: 'docs' })).entries);
		expect(s['project.tab'].content).toMatchObject({
			available: true,
			value: [
				{
					block: 'links.v1',
					links: [
						{ label: 'Repository', href: 'https://github.com/o/r' },
						{
							label: 'README',
							href: 'https://github.com/o/r/blob/HEAD/README.md',
							note: 'Harbour Docs'
						},
						{ label: 'Pull requests', href: 'https://github.com/o/r/pulls' }
					]
				},
				{ block: 'kv.v1' },
				{
					block: 'table.v1',
					rows: [['Fix links', { text: '#3', href: 'https://github.com/o/r/pull/3' }, 'Open']]
				}
			]
		});
		expect(s['harbour.card']).toMatchObject({
			render: { component: 'project-links/summary' },
			content: {
				available: true,
				value: { repoUrl: 'https://github.com/o/r', readme: { title: 'Harbour Docs' } }
			}
		});
	});

	it('fills the task section and the Pull request step evidence', async () => {
		const s = by((await reg.slots({ scope: 'task', taskId: 'd-1' })).entries);
		expect(s['task.section'].content).toMatchObject({
			value: [
				{ block: 'status.v1', label: 'Pull request open' },
				{
					block: 'links.v1',
					links: expect.arrayContaining([
						{ label: 'Branch', href: 'https://github.com/o/r/tree/fm/d-1', note: 'fm/d-1' }
					])
				}
			]
		});
		expect(s['step.evidence']).toMatchObject({
			step: 'pr',
			content: {
				value: [{ block: 'links.v1', links: [{ href: 'https://github.com/o/r/compare/fm/d-1' }] }]
			}
		});
	});

	it('offers a Bridge card for a reply that links the repository', async () => {
		const [e] = (await reg.slots({ scope: 'fleet' })).entries;
		const cards = (e.content as { value: BridgeCard[] }).value;
		expect(cards).toMatchObject([
			{ key: 'docs', title: 'Harbour docs', mentions: ['https://github.com/o/r'] }
		]);
	});
});
