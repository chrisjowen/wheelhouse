import { chmod, mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
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

async function roleReport(line: string): Promise<void> {
	await put('bin/fm-role.sh', `#!/bin/sh\nprintf '%s\\n' '${line}'\n`);
	await chmod(path.join(root, 'bin/fm-role.sh'), 0o755);
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
		expect(setting('backend', view).value).toBe(
			'Not set; Firstmate picks the backend from your terminal (tmux if none detected)'
		);
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

	it('reads documented comments, defaults and permission modes as configured values', async () => {
		await put(
			'config/lane-capacity',
			'# lanes\n\n12                     # the cap: lanes this home runs at once\nmin-avail-gb 5         # keep this much memory available\n'
		);
		await roleReport('fm-role: maintainer github.com/example/firstmate (local)');
		await put('config/backend', '\n  herdr  \n');
		await put('config/crew-harness', ' default\n');
		await put('config/secondmate-harness', 'codex\nmate test-mate: default\n');
		await put('config/claude-permission-mode', 'auto\n');
		await put('config/launch-env-allowlist', 'FIRST_NAME\nSECOND_NAME\n');
		const view = await readFirstmateSettings(install, { budgetReport: async () => null });

		expect(setting('lane-capacity', view).value).toBe('12 at once');
		expect(setting('role', view).value).toBe('Maintainer role');
		expect(setting('backend', view).value).toBe('herdr windows');
		expect(setting('crew-harness', view).value).toBe('Same agent as Firstmate');
		expect(setting('secondmate-harness', view).details[0].rows).toEqual([
			{ label: 'test-mate', value: 'Follows the worker agent' }
		]);
		expect(setting('permission-mode', view).value).toBe('A model reviewer checks actions');
		expect(setting('launch-env', view)).toMatchObject({
			value: '2 names',
			sub: 'FIRST_NAME, SECOND_NAME'
		});

		await put('config/lane-capacity', 'auto\nmin-avail-gb 5\n');
		const auto = await readFirstmateSettings(install, { budgetReport: async () => null });
		expect(setting('lane-capacity', auto).value).toBe('auto (measured budget)');
	});

	it('shows values Firstmate itself would reject as not recognized or fail closed', async () => {
		await put('config/backend', '# chosen backend\nherdr\n');
		await put('config/crew-harness', 'codex\npi\n');
		await put('config/lane-capacity', '12 34\n');
		await put('config/firstmate-role', 'maintainer github.com/example/firstmate\n');
		await roleReport(
			'fm-role: user - unverified inherited grant: a role file exists with no propagation receipt'
		);
		const view = await readFirstmateSettings(install, { budgetReport: async () => null });

		expect(setting('backend', view).value).toBe('Configured; value not recognized');
		expect(setting('crew-harness', view).value).toBe('codexpi');
		expect(setting('lane-capacity', view).value).toBe('Configured; value not recognized');
		expect(setting('role', view).value).toBe('User role (role file not accepted)');

		await put('config/crew-harness', '# mirror the primary\ndefault\n');
		const commented = await readFirstmateSettings(install, { budgetReport: async () => null });
		expect(setting('crew-harness', commented).value).toBe('Configured; value not recognized');

		await put('config/crew-harness', 'DEFAULT\n');
		await put('config/backend', ' \n\n');
		const literal = await readFirstmateSettings(install, { budgetReport: async () => null });
		expect(setting('crew-harness', literal).value).toBe('DEFAULT');
		expect(setting('backend', literal).value).toBe(
			'Not set; Firstmate picks the backend from your terminal (tmux if none detected)'
		);

		await put('config/crew-harness', '  \n');
		const empty = await readFirstmateSettings(install, { budgetReport: async () => null });
		expect(setting('crew-harness', empty).value).toBe('Same agent as Firstmate');

		for (const [lane, expected] of [
			['AUTO\n', 'Configured; value not recognized'],
			['1000000\n', '1000000 at once']
		]) {
			await put('config/lane-capacity', lane);
			const next = await readFirstmateSettings(install, { budgetReport: async () => null });
			expect(setting('lane-capacity', next).value).toBe(expected);
		}
		await rm(path.join(root, 'bin/fm-role.sh'));
		const unreported = await readFirstmateSettings(install, { budgetReport: async () => null });
		expect(setting('role', unreported).value).toBe('Could not check this setting');
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
