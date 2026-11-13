import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { parseChange, VaultService } from './vault';

/**
 * The Vault page's changes, run through a stand-in for the bundled wh-vault:
 * a script that keeps names and grants in a JSON file and records each call's
 * arguments, standard input and environment names, so the tests can see
 * exactly what reached it. The values are plainly fake.
 */

const FAKE_VALUE = 'not-a-real-value';

const FAKE_CLI = `
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
const [flag, dir, cmd, name, ...projects] = process.argv.slice(2);
if (flag !== '--config-dir') process.exit(2);
const file = dir + '/state.json';
const vault = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {};
let stdin = '';
if (cmd === 'set') for await (const c of process.stdin) stdin += c;
appendFileSync(dir + '/calls.jsonl', JSON.stringify({ argv: process.argv.slice(2), stdin, env: Object.keys(process.env).sort() }) + '\\n');
if (existsSync(dir + '/fail-' + cmd)) {
	process.stderr.write(readFileSync(dir + '/fail-' + cmd, 'utf8'));
	process.exit(1);
}
const at = '2026-10-30T12:00:00.000Z';
if (cmd === 'backend') {
	console.log(readFileSync(dir + '/backend.json', 'utf8'));
} else if (cmd === 'list') {
	const secrets = Object.entries(vault).sort(([a], [b]) => a.localeCompare(b)).map(([n, s]) => ({ name: n, ...s, lastUsedAt: null }));
	console.log(JSON.stringify({ schema: 'wh-vault.list.v1', initialized: true, backend: 'keychain', secrets }));
} else if (cmd === 'set') {
	vault[name] = vault[name] ? { ...vault[name], updatedAt: at } : { projects: [], createdAt: at, updatedAt: at };
	console.log('Stored ' + name + '.');
} else if (cmd === 'grant' || cmd === 'revoke') {
	const set = new Set(vault[name].projects);
	for (const p of projects) cmd === 'grant' ? set.add(p) : set.delete(p);
	vault[name].projects = [...set].sort();
} else if (cmd === 'remove') {
	delete vault[name];
}
writeFileSync(file, JSON.stringify(vault));
`;

let root: string;
let dir: string;
let cli: string;
beforeEach(() => {
	root ??= mkdtempSync(path.join(tmpdir(), 'wh-vault-service-'));
	dir = mkdtempSync(path.join(root, 'config-'));
	cli = path.join(root, 'wh-vault.mjs');
	writeFileSync(cli, FAKE_CLI);
});
afterAll(() => rmSync(root, { recursive: true, force: true }));

const service = (o: { cli?: string; platform?: NodeJS.Platform } = {}) =>
	new VaultService({
		cli: o.cli ?? cli,
		configDir: dir,
		platform: o.platform ?? 'darwin',
		env: {
			PATH: process.env.PATH,
			HOME: dir,
			LANG: 'C.UTF-8',
			FM_TASK_ID: 'some-task',
			FM_TASK_INBOX: '/elsewhere',
			SECRET_FROM_ELSEWHERE: 'x',
			DBUS_SESSION_BUS_ADDRESS: 'unix:path=/run/user/1000/bus',
			XDG_RUNTIME_DIR: '/run/user/1000'
		}
	});
const calls = () =>
	readFileSync(path.join(dir, 'calls.jsonl'), 'utf8')
		.trim()
		.split('\n')
		.map((l) => JSON.parse(l) as { argv: string[]; stdin: string; env: string[] });

describe('the Vault page’s changes', () => {
	it('hands a value to wh-vault set on its standard input only, and never sends it back', async () => {
		const r = await service().change({
			action: 'set',
			name: 'DEPLOY_TOKEN',
			value: FAKE_VALUE,
			projects: ['lumen', 'atlas']
		});
		expect(r).toEqual({
			ok: true,
			message: 'Stored DEPLOY_TOKEN in your Mac’s login Keychain. atlas and lumen can use it.',
			secrets: [
				{
					name: 'DEPLOY_TOKEN',
					projects: ['atlas', 'lumen'],
					updatedAt: '2026-10-30T12:00:00.000Z',
					lastUsedAt: null
				}
			],
			observedAt: expect.any(String)
		});
		expect(JSON.stringify(r)).not.toContain(FAKE_VALUE);
		const ran = calls();
		expect(ran.map((c) => c.argv.slice(2))).toEqual([
			['list', '--all', '--json'],
			['set', 'DEPLOY_TOKEN'],
			['grant', 'DEPLOY_TOKEN', 'lumen', 'atlas'],
			['list', '--all', '--json']
		]);
		expect(ran.map((c) => c.argv[1])).toEqual(Array(4).fill(dir));
		expect(ran[1].stdin).toBe(FAKE_VALUE);
		expect(ran.filter((c) => c.stdin).length).toBe(1);
		expect(ran.some((c) => c.argv.includes(FAKE_VALUE))).toBe(false);
		// Never a task's variables: the change is the captain's, not a task's.
		for (const c of ran) {
			expect(c.env.filter((k) => !k.startsWith('__CF') && k !== 'PWD' && k !== 'SHLVL')).toEqual([
				'HOME',
				'LANG',
				'PATH'
			]);
		}
	});

	it('says when a value was replaced, and grants only projects that were not granted', async () => {
		const s = service();
		await s.change({ action: 'set', name: 'DEPLOY_TOKEN', value: FAKE_VALUE, projects: ['atlas'] });
		const again = await s.change({
			action: 'set',
			name: 'DEPLOY_TOKEN',
			value: 'another-fake-value',
			projects: []
		});
		expect(again).toMatchObject({ ok: true, message: 'Replaced the value of DEPLOY_TOKEN.' });
		const more = await s.change({
			action: 'set',
			name: 'DEPLOY_TOKEN',
			value: 'a-third-fake-value',
			projects: ['atlas', 'lumen']
		});
		expect(more).toMatchObject({
			ok: true,
			message: 'Replaced the value of DEPLOY_TOKEN. atlas and lumen can use it.'
		});
		expect(
			calls()
				.filter((c) => c.argv[2] === 'grant')
				.map((c) => c.argv.slice(3))
		).toEqual([
			['DEPLOY_TOKEN', 'atlas'],
			['DEPLOY_TOKEN', 'lumen']
		]);
	});

	it('grants, revokes and removes, in plain words', async () => {
		const s = service();
		await s.change({ action: 'set', name: 'DEPLOY_TOKEN', value: FAKE_VALUE, projects: [] });
		expect(
			await s.change({ action: 'grant', name: 'DEPLOY_TOKEN', projects: ['atlas', 'lumen'] })
		).toMatchObject({
			ok: true,
			message: 'atlas and lumen can now use DEPLOY_TOKEN.',
			secrets: [{ name: 'DEPLOY_TOKEN', projects: ['atlas', 'lumen'] }]
		});
		expect(
			await s.change({ action: 'revoke', name: 'DEPLOY_TOKEN', projects: ['atlas'] })
		).toMatchObject({
			ok: true,
			message: 'atlas can no longer use DEPLOY_TOKEN.',
			secrets: [{ name: 'DEPLOY_TOKEN', projects: ['lumen'] }]
		});
		expect(await s.change({ action: 'remove', name: 'DEPLOY_TOKEN' })).toMatchObject({
			ok: true,
			message:
				'Removed DEPLOY_TOKEN. Its value is deleted from the Keychain and no project can use it.',
			secrets: []
		});
	});

	it('refuses to change a secret the vault does not have', async () => {
		expect(await service().change({ action: 'remove', name: 'NOPE' })).toEqual({
			ok: false,
			status: 404,
			message: 'The vault has no secret named NOPE.'
		});
		expect(calls().map((c) => c.argv[2])).toEqual(['list']);
	});

	it('passes on why wh-vault failed, but never anything holding the value', async () => {
		writeFileSync(
			path.join(dir, 'fail-set'),
			'wh-vault: the Keychain would not answer here ("User interaction is not allowed").\n'
		);
		expect(
			await service().change({ action: 'set', name: 'A', value: FAKE_VALUE, projects: [] })
		).toEqual({
			ok: false,
			status: 502,
			message:
				'Could not store it: the Keychain would not answer here ("User interaction is not allowed").'
		});
		const hex = Buffer.from(FAKE_VALUE).toString('hex');
		for (const said of [`security: bad line ${FAKE_VALUE}`, `could not store (${hex})`]) {
			writeFileSync(path.join(dir, 'fail-set'), `wh-vault: ${said}.\n`);
			const r = await service().change({
				action: 'set',
				name: 'A',
				value: FAKE_VALUE,
				projects: []
			});
			expect(r).toEqual({
				ok: false,
				status: 502,
				message: 'Could not store it: wh-vault exited 1.'
			});
		}
	});

	it('with replace: false, refuses a name the vault already has and stores nothing', async () => {
		const s = service();
		await s.change({ action: 'set', name: 'DEPLOY_TOKEN', value: FAKE_VALUE, projects: [] });
		const r = await s.change({
			action: 'set',
			name: 'DEPLOY_TOKEN',
			value: 'another-fake-value',
			projects: ['atlas'],
			replace: false
		});
		expect(r).toEqual({
			ok: false,
			status: 409,
			message: 'The vault already has a secret named DEPLOY_TOKEN. Storing this replaces its value.'
		});
		expect(JSON.stringify(r)).not.toContain('another-fake-value');
		expect(calls().filter((c) => c.argv[2] === 'set').length).toBe(1);
		// A new name stores as usual.
		expect(
			await s.change({
				action: 'set',
				name: 'OTHER',
				value: FAKE_VALUE,
				projects: [],
				replace: false
			})
		).toMatchObject({ ok: true });
	});

	it('stores nothing, and says why, on a computer that is neither a Mac nor Linux', async () => {
		const s = service({ platform: 'win32' });
		expect(await s.cannotStore()).toMatch(/not a Mac/);
		const r = await s.change({ action: 'set', name: 'A', value: FAKE_VALUE, projects: [] });
		expect(r).toMatchObject({
			ok: false,
			status: 503,
			message: expect.stringMatching(/not a Mac/)
		});
		expect(JSON.stringify(r)).not.toContain(FAKE_VALUE);
		expect(existsSync(path.join(dir, 'calls.jsonl'))).toBe(false);
		expect(await service({ platform: 'darwin' }).cannotStore()).toBeNull();
	});

	describe('on Linux', () => {
		const backendSays = (o: object) =>
			writeFileSync(
				path.join(dir, 'backend.json'),
				JSON.stringify({
					schema: 'wh-vault.backend.v1',
					backend: 'secret-service',
					where: 'the login keyring (Secret Service)',
					canStore: true,
					reason: null,
					choices: ['secret-service', 'env-file'],
					...o
				})
			);

		it('stores where wh-vault backend says, reaching the session bus the keyring answers on', async () => {
			backendSays({});
			const s = service({ platform: 'linux' });
			expect(await s.status()).toEqual({
				canStore: true,
				reason: null,
				where: 'the login keyring (Secret Service)'
			});
			const r = await s.change({ action: 'set', name: 'A', value: FAKE_VALUE, projects: [] });
			expect(r).toMatchObject({
				ok: true,
				message: 'Stored A in the login keyring (Secret Service). No project can use it yet.'
			});
			expect(await s.change({ action: 'remove', name: 'A' })).toMatchObject({
				ok: true,
				message: 'Removed A. Its value is deleted and no project can use it.'
			});
			const ran = calls();
			expect(ran.map((c) => c.argv[2])).toEqual([
				'backend',
				'backend',
				'list',
				'set',
				'list',
				'list',
				'remove',
				'list'
			]);
			for (const c of ran) {
				expect(c.env.filter((k) => !k.startsWith('__CF') && k !== 'PWD' && k !== 'SHLVL')).toEqual([
					'DBUS_SESSION_BUS_ADDRESS',
					'HOME',
					'LANG',
					'PATH',
					'XDG_RUNTIME_DIR'
				]);
			}
		});

		it('stores nothing, and says why and how to change that, when wh-vault cannot', async () => {
			backendSays({
				canStore: false,
				reason: 'there is no D-Bus session here; opt in with `wh-vault backend env-file`'
			});
			const s = service({ platform: 'linux' });
			const r = await s.change({ action: 'set', name: 'A', value: FAKE_VALUE, projects: [] });
			expect(r).toEqual({
				ok: false,
				status: 503,
				message:
					'This computer cannot store a secret now: there is no D-Bus session here; opt in with `wh-vault backend env-file`.'
			});
			expect(calls().map((c) => c.argv[2])).toEqual(['backend']);
		});

		it('says the bundled wh-vault is missing, naming no Mac', async () => {
			expect(
				await service({ platform: 'linux', cli: path.join(dir, 'gone.mjs') }).status()
			).toEqual({
				canStore: false,
				reason: 'The wh-vault bundled with Wheelhouse is missing (npm run build makes it).',
				where: null
			});
		});

		it('says so when wh-vault backend gives an answer it does not know', async () => {
			writeFileSync(path.join(dir, 'backend.json'), '{"schema":"other"}');
			expect(await service({ platform: 'linux' }).status()).toEqual({
				canStore: false,
				reason: 'wh-vault gave an answer Wheelhouse does not know.',
				where: null
			});
		});
	});

	it('runs changes one at a time', async () => {
		const s = service();
		const all = await Promise.all(
			['A', 'B', 'C'].map((name) =>
				s.change({ action: 'set', name, value: FAKE_VALUE, projects: ['atlas'] })
			)
		);
		expect(all.every((r) => r.ok)).toBe(true);
		// Each change's list, set, grant and list come together, in order.
		expect(calls().map((c) => `${c.argv[2]} ${c.argv[3] ?? ''}`.trim())).toEqual(
			['A', 'B', 'C'].flatMap((n) => ['list --all', `set ${n}`, `grant ${n}`, 'list --all'])
		);
	});

	it('says so, and runs nothing, when the bundled wh-vault is missing', async () => {
		const s = service({ cli: path.join(root, 'missing.js') });
		expect(s.unavailable()).toMatch(/wh-vault bundled with Wheelhouse is missing/);
		expect(await s.change({ action: 'remove', name: 'A' })).toMatchObject({
			ok: false,
			status: 503
		});
		expect(existsSync(path.join(dir, 'calls.jsonl'))).toBe(false);
	});
});

describe('reading a change from the page', () => {
	const known = new Set(['atlas', 'lumen']);
	const err = (body: Record<string, unknown>) => {
		const r = parseChange(body, known);
		return r.ok ? null : r.message;
	};

	it('takes the four changes', () => {
		expect(
			parseChange(
				{ action: 'set', name: 'A_1', value: FAKE_VALUE, projects: ['lumen', 'atlas'] },
				known
			)
		).toEqual({
			ok: true,
			change: { action: 'set', name: 'A_1', value: FAKE_VALUE, projects: ['atlas', 'lumen'] }
		});
		expect(parseChange({ action: 'set', name: 'A', value: FAKE_VALUE }, known)).toMatchObject({
			ok: true,
			change: { projects: [] }
		});
		expect(parseChange({ action: 'grant', name: 'A', projects: ['atlas'] }, known)).toMatchObject({
			ok: true
		});
		// A grant to a project Wheelhouse no longer knows can still be revoked.
		expect(parseChange({ action: 'revoke', name: 'A', projects: ['gone'] }, known)).toMatchObject({
			ok: true
		});
		expect(
			parseChange({ action: 'set', name: 'A', value: FAKE_VALUE, replace: false }, known)
		).toMatchObject({ ok: true, change: { replace: false } });
		expect(parseChange({ action: 'remove', name: 'A' }, known)).toEqual({
			ok: true,
			change: { action: 'remove', name: 'A' }
		});
	});

	it('refuses anything else, without repeating the value', () => {
		expect(err({ action: 'get', name: 'A' })).toMatch(/action must be/);
		expect(err({ action: 'set', name: '1A', value: FAKE_VALUE })).toMatch(/environment variable/);
		expect(err({ action: 'set', name: 'A', value: '' })).toBe('Give the secret a value.');
		expect(err({ action: 'set', name: 'A', value: 7 })).toBe('Give the secret a value.');
		expect(err({ action: 'set', name: 'A', value: 'x'.repeat(20_000) })).toBe(
			'That value is far too long.'
		);
		expect(err({ action: 'grant', name: 'A', projects: ['nowhere'] })).toBe(
			'Wheelhouse does not know the project nowhere.'
		);
		expect(err({ action: 'set', name: 'A', value: FAKE_VALUE, projects: ['nowhere'] })).toMatch(
			/does not know/
		);
		expect(err({ action: 'grant', name: 'A', projects: [] })).toBe('Name at least one project.');
		expect(err({ action: 'set', name: 'A', value: FAKE_VALUE, replace: 'no' })).toBe(
			'replace must be true or false.'
		);
		expect(err({ action: 'revoke', name: 'A', projects: ['../x'] })).toMatch(/project names/);
	});
});
