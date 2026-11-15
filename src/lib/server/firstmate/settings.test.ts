import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { dispatchRuleLabel, readFirstmateSettings } from './settings';
import type { FirstmateInstall } from './install';

let root: string;
let install: FirstmateInstall;

async function put(relative: string, text: string): Promise<void> {
	const file = path.join(root, relative);
	await mkdir(path.dirname(file), { recursive: true });
	await writeFile(file, text, 'utf8');
}

function setting(id: string, view: Awaited<ReturnType<typeof readFirstmateSettings>>) {
	return view.settings.find((item) => item.id === id)!;
}

beforeEach(async () => {
	root = await mkdtemp(path.join(os.tmpdir(), 'wheelhouse-firstmate-settings-'));
	install = { firstmateDir: root, homeDir: root };
});

afterEach(async () => {
	await rm(root, { recursive: true, force: true });
});

describe('Firstmate settings reader', () => {
	it('uses documented defaults when optional files are absent', async () => {
		const view = await readFirstmateSettings(install, { budgetReport: async () => null });

		expect(view.available).toBe(true);
		expect(view.projects).toEqual([]);
		expect(view.mates).toEqual([]);
		expect(view.startupBudget).toEqual({ budget: 7500, used: null, overBy: null });
		expect(setting('backend', view).value).toContain('tmux');
		expect(setting('wait', view).value).toContain('Off');
		expect(setting('ledger', view).value).toContain('Off');
		expect(setting('permission-mode', view).value).toBe('Workers do not ask');
		expect(setting('role', view).value).toBe('User role (documented default)');
		expect(setting('accounts', view).value).toBe('No account pin is set');
	});

	it('derives dispatch labels, projects, second-mate routes and budget attention from this home', async () => {
		await put(
			'config/crew-dispatch.json',
			JSON.stringify({
				rules: [
					{
						when: 'Design work: prototypes, layouts and interface changes',
						use: [{ harness: 'claude', effort: 'high', floor: 20 }]
					}
				],
				fallback: [{ harness: 'pi', model: 'openrouter/example/model', effort: 'medium' }]
			})
		);
		await put(
			'data/projects.md',
			'- sample-app [no-mistakes +yolo branch=fm/] - Example project\n- scratch [local-only] - Temporary work\n'
		);
		await put('config/project-capacity', 'sample-app 3\n');
		await put(
			'config/secondmate-harness',
			'opencode model-id high\nmate test-mate: pi test-model medium\n'
		);
		await put(
			'data/secondmates.md',
			'# Second mates\n- test-mate - Example remit (host: example-host; root: /srv/firstmate; home: /srv/home; scope: test tasks; projects: sample-app, scratch; added: 2026-01-01)\n'
		);
		await put('config/startup-memory-budget', '100\n');
		const view = await readFirstmateSettings(install, {
			budgetReport: async () =>
				'effective_budget_tokens=100\ntotal_estimated_tokens=125\nbudget_status=over-budget\n'
		});

		expect(view.projectCount).toBe(2);
		expect(view.mateCount).toBe(1);
		expect(view.dispatchRuleCount).toBe(1);
		expect(setting('dispatch', view).details[0].rows[0]).toEqual({
			label: 'Design work',
			value: 'Claude Code · high effort · reserve 20% of allowance'
		});
		expect(view.projects[0]).toMatchObject({
			name: 'sample-app',
			modeShort: 'Always fully checked',
			autoMerge: true,
			capacity: 3
		});
		expect(setting('secondmate-harness', view)).toMatchObject({
			value: 'OpenCode · 1 mate-specific override',
			details: [{ rows: [{ label: 'test-mate', value: 'Pi' }] }]
		});
		expect(view.mates[0]).toEqual({
			id: 'test-mate',
			remote: true,
			projects: ['sample-app', 'scratch']
		});
		expect(view.startupBudget).toEqual({ budget: 100, used: 125, overBy: 25 });
	});

	it('does not return pin contents, arbitrary preference text, environment values, route paths or Vault data', async () => {
		await put('config/claude-account', 'private-account-pin-value');
		await put('config/launch-env-allowlist', 'API_TOKEN=private-environment-value\n');
		await put('data/captain.md', '- private preference text\n');
		await put(
			'data/secondmates.md',
			'- mate - private remit text (host: private-host; root: /private/root; home: /private/home; scope: private scope; projects: private-project; added: today)\n'
		);
		await put('vault/secret.txt', 'private-vault-secret-value');
		await symlink(path.join(root, 'vault/secret.txt'), path.join(root, 'config/brief-include.md'));

		const view = await readFirstmateSettings(install, { budgetReport: async () => null });
		const output = JSON.stringify(view);

		expect(output).not.toContain('private-account-pin-value');
		expect(output).not.toContain('private-environment-value');
		expect(setting('brief', view).value).toBe('Could not read these instructions');
		expect(output).not.toContain('private preference text');
		expect(output).not.toContain('private remit text');
		expect(output).not.toContain('/private/root');
		expect(output).not.toContain('/private/home');
		expect(output).not.toContain('private-vault-secret-value');
		expect(setting('accounts', view).value).toBe('An account pin is set');
		expect(setting('launch-env', view).value).toBe('Configured; names unavailable');
	});

	it('uses the dispatch rule description rather than adding a schema name', () => {
		expect(dispatchRuleLabel('Research scouts: read docs, compare options')).toBe(
			'Research scouts'
		);
		expect(dispatchRuleLabel('  ')).toBe('Unnamed work type');
	});
});
