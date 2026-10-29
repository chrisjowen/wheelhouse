/**
 * Vault, bundled with Wheelhouse in the installed-plugin format: what wh-vault
 * holds, by name. It shows which secrets exist, which projects may use each,
 * and when each was set and used; it never sees a value. It reads only by
 * running `wh-vault list --all --json` and `wh-vault audit --json`, each in a
 * process of its own, and neither reads a value, so no secret ever enters
 * Wheelhouse's process, where every installed plugin runs too.
 *
 * It is read-only, like every plugin, and has no button that changes a grant
 * or releases a value: any process on this computer can read Wheelhouse's pages
 * and its session token, so such a button would let any of them grant itself
 * a secret. Grants change in a terminal, with `wh-vault grant` and `revoke`.
 * See docs/vault.md.
 *
 * @typedef {import('@chrisjowen/wheelhouse-plugin-sdk').WheelhousePlugin} WheelhousePlugin
 * @typedef {import('@chrisjowen/wheelhouse-plugin-sdk').ProviderContext} ProviderContext
 * @typedef {import('@chrisjowen/wheelhouse-plugin-sdk').Block} Block
 */

import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** The wh-vault bundled beside this plugin in Wheelhouse's package (dist/wh-vault.js). */
const BUNDLED_CLI = fileURLToPath(new URL('../../../../dist/wh-vault.js', import.meta.url));
const SOURCE = 'wh-vault’s vault file and usage log (names only)';
const LIST_TTL_MS = 10_000;

/** Wheelhouse's config directory, as Wheelhouse and wh-vault work it out. */
export function configDir(env = process.env) {
	if (env.WHEELHOUSE_CONFIG_DIR) return path.resolve(env.WHEELHOUSE_CONFIG_DIR);
	if (env.XDG_CONFIG_HOME) return path.join(env.XDG_CONFIG_HOME, 'wheelhouse');
	return path.join(homedir(), '.config', 'wheelhouse');
}

/** The command that runs wh-vault: the `bin` setting, else the bundled one, else wh-vault on PATH. */
function cli(ctx) {
	const bin = typeof ctx.settings.bin === 'string' ? ctx.settings.bin.trim() : '';
	if (bin) return [bin];
	return existsSync(BUNDLED_CLI) ? [process.execPath, BUNDLED_CLI] : ['wh-vault'];
}

/** wh-vault's JSON answer to `args`, or { error } in plain words. */
async function vault(ctx, args) {
	const dir = configDir();
	const r = await ctx.exec({
		argv: [...cli(ctx), '--config-dir', dir, ...args, '--json'],
		cwd: 'home',
		timeoutMs: 5_000,
		maxBytes: 2 * 1024 * 1024
	});
	if (!r.ok) {
		const said = r.stderr.trim().split('\n')[0];
		return { error: `wh-vault ${args[0]} did not answer: ${r.reason}${said ? ` (${said})` : ''}` };
	}
	try {
		return JSON.parse(r.stdout);
	} catch {
		return { error: `wh-vault ${args[0]} answered with something other than JSON` };
	}
}

/** `list --all`, shared by every provider for a few seconds. */
let listed = null;
function listAll(ctx) {
	const at = Date.now();
	const key = `${configDir()}\n${cli(ctx).join('\n')}`;
	if (listed && listed.key === key && at - listed.at < LIST_TTL_MS) return listed.value;
	const value = vault(ctx, ['list', '--all']).then((v) => {
		if (v.error || v.schema !== 'wh-vault.list.v1' || !Array.isArray(v.secrets)) {
			if (listed?.value === value) listed = null;
			return v.error ? v : { error: 'wh-vault list gave an answer this plugin does not know' };
		}
		return v;
	});
	listed = { key, at, value };
	return value;
}

/** Run entries from the usage log for `filter` (e.g. ['--task', id]), newest first. */
async function runs(ctx, filter, limit) {
	const v = await vault(ctx, ['audit', '--event', 'run', ...filter, '--limit', String(limit)]);
	if (v.error) return v;
	if (v.schema !== 'wh-vault.audit.v1' || !Array.isArray(v.entries)) {
		return { error: 'wh-vault audit gave an answer this plugin does not know' };
	}
	return v.entries;
}

/**
 * The vault, or why there is nothing to show. With no vault file yet,
 * wh-vault is not in use and nothing runs at all.
 */
async function secrets(ctx) {
	if (!existsSync(path.join(configDir(), 'vault', 'vault.json'))) {
		return { error: 'wh-vault holds no secrets yet' };
	}
	const v = await listAll(ctx);
	if (v.error) return v;
	if (!v.initialized) return { error: 'wh-vault holds no secrets yet' };
	return v;
}

/** A time as the captain reads it, in this computer's time zone, to the minute. */
export function when(iso) {
	if (!iso) return 'Never';
	const d = new Date(iso);
	if (Number.isNaN(d.getTime())) return String(iso);
	const p = (n) => String(n).padStart(2, '0');
	return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** How a logged run ended, in a few words. */
export function outcome(e) {
	if (e.outcome === 'ok') return e.signal ? `Ended by ${e.signal}` : `Exit ${e.exit ?? '?'}`;
	if (e.outcome === 'denied') return 'Refused: not granted';
	if (e.outcome === 'unavailable') return 'Refused: values unavailable';
	if (e.outcome === 'failed') return 'Did not start';
	return 'Unknown';
}

const names = (list) => (list.length ? list.join(', ') : 'None');
const available = (value) => ({
	available: true,
	value,
	source: SOURCE,
	observedAt: new Date().toISOString()
});
const unavailable = (reason) => ({ available: false, reason: `${reason}.` });

/** A task cell: a link to the task's page when Wheelhouse knows the task. */
function taskCell(ctx, id) {
	if (!id) return '—';
	return ctx.tasks.some((t) => t.id === id)
		? { text: id, href: `/tasks/${encodeURIComponent(id)}` }
		: id;
}

const COMMANDS = {
	block: 'kv.v1',
	items: [
		{ key: 'Store', value: 'wh-vault set NAME' },
		{ key: 'Grant', value: 'wh-vault grant NAME PROJECT' },
		{ key: 'Revoke', value: 'wh-vault revoke NAME PROJECT' },
		{ key: 'Use', value: 'wh-vault run -- <command>' }
	]
};

/** @param {ProviderContext} ctx */
async function overview(ctx) {
	const v = await secrets(ctx);
	if (v.error) return unavailable(v.error);
	const used = await runs(ctx, [], 15);
	/** @type {Block[]} */
	const blocks = [
		{
			block: 'text.v1',
			text: 'Values stay in the macOS login Keychain. Wheelhouse shows only names, grants and use, never a value, and grants change only in a terminal.',
			muted: true
		}
	];
	if (v.secrets.length) {
		blocks.push({
			block: 'table.v1',
			columns: ['Secret', 'Projects', 'Value set', 'Last used'],
			rows: v.secrets.map((s) => [s.name, names(s.projects), when(s.updatedAt), when(s.lastUsedAt)])
		});
	} else {
		blocks.push({ block: 'text.v1', text: 'The vault is empty.' });
	}
	blocks.push(COMMANDS);
	if (used.error)
		blocks.push({ block: 'text.v1', text: `Recent use: ${used.error}.`, muted: true });
	else if (used.length) {
		blocks.push({ block: 'text.v1', text: 'Recent use' });
		blocks.push({
			block: 'table.v1',
			columns: ['When', 'Task', 'Project', 'Secrets', 'Command', 'Result'],
			rows: used.map((e) => [
				when(e.at),
				taskCell(ctx, e.task),
				e.project ?? '—',
				names(e.names),
				e.program ?? '—',
				outcome(e)
			])
		});
	}
	return available(blocks);
}

/** @param {ProviderContext} ctx */
async function projectSecrets(ctx) {
	const v = await secrets(ctx);
	if (v.error) return unavailable(v.error);
	const id = ctx.project.id;
	const granted = v.secrets.filter((s) => s.projects.includes(id));
	const used = await runs(ctx, ['--project', id], 10);
	const history = Array.isArray(used) ? used : [];
	if (!granted.length && !history.length) return unavailable(`No secrets are granted to ${id}`);
	/** @type {Block[]} */
	const blocks = [];
	if (granted.length) {
		blocks.push({
			block: 'text.v1',
			text: `A command run for ${id} with wh-vault run -- <command> gets these in its environment, that command only.`,
			muted: true
		});
		blocks.push({
			block: 'table.v1',
			columns: ['Secret', 'Value set', 'Last used'],
			rows: granted.map((s) => [s.name, when(s.updatedAt), when(s.lastUsedAt)])
		});
	} else {
		blocks.push({ block: 'text.v1', text: `No secrets are granted to ${id} now.` });
	}
	blocks.push({
		block: 'kv.v1',
		items: [
			{ key: 'Grant', value: `wh-vault grant NAME ${id}` },
			{ key: 'Revoke', value: `wh-vault revoke NAME ${id}` }
		]
	});
	if (used.error)
		blocks.push({ block: 'text.v1', text: `Recent use: ${used.error}.`, muted: true });
	else if (history.length) {
		blocks.push({
			block: 'table.v1',
			columns: ['When', 'Task', 'Secrets', 'Command', 'Result'],
			rows: history.map((e) => [
				when(e.at),
				taskCell(ctx, e.task),
				names(e.names),
				e.program ?? '—',
				outcome(e)
			])
		});
	}
	return available(blocks);
}

/** @param {ProviderContext} ctx */
async function taskUse(ctx) {
	const v = await secrets(ctx);
	if (v.error) return unavailable(v.error);
	const used = await runs(ctx, ['--task', ctx.task.id], 20);
	if (used.error) return unavailable(used.error);
	if (!used.length) return unavailable('This task has not used any secrets');
	return available([
		{
			block: 'text.v1',
			text: 'Each line is one command this task ran with wh-vault run, by name; values are never logged.',
			muted: true
		},
		{
			block: 'table.v1',
			columns: ['When', 'Secrets', 'Command', 'Result'],
			rows: used.map((e) => [when(e.at), names(e.names), e.program ?? '—', outcome(e)])
		}
	]);
}

/** @type {WheelhousePlugin} */
export default {
	providers: [
		{ id: 'overview', scope: 'fleet', ttlMs: 15_000, timeoutMs: 8_000, fetch: overview },
		{ id: 'project', scope: 'project', ttlMs: 15_000, timeoutMs: 8_000, fetch: projectSecrets },
		{ id: 'task', scope: 'task', ttlMs: 15_000, timeoutMs: 8_000, fetch: taskUse }
	],
	contributions: [
		{
			slot: 'nav.page',
			id: 'overview',
			title: 'Vault',
			provider: 'overview',
			when: 'provider-available',
			render: { blocks: true }
		},
		{
			slot: 'project.tab',
			id: 'secrets',
			title: 'Secrets',
			provider: 'project',
			when: 'provider-available',
			render: { blocks: true }
		},
		{
			slot: 'task.section',
			id: 'used',
			title: 'Secrets used',
			provider: 'task',
			when: 'provider-available',
			placement: { order: 300 },
			render: { blocks: true }
		}
	]
};
