import { existsSync } from 'node:fs';
import {
	andList,
	PROJECT_ID,
	SECRET_NAME,
	type VaultChange,
	type VaultChangeResult,
	type VaultSecret
} from '../vault';
import { runBounded, type RunResult } from './firstmate/exec';

/**
 * Changes the captain makes on the Vault page: store a value, grant or revoke
 * a secret for projects, remove a secret. Each runs the `wh-vault` bundled
 * with Wheelhouse (dist/wh-vault.js), the same command a terminal runs, so
 * names, grants, the Keychain item and the usage log come out exactly as
 * `wh-vault set`, `grant`, `revoke` and `remove` make them. A value goes to
 * `wh-vault set` on its standard input, never on a command line, and is never
 * logged, written anywhere else or sent back: answers are built from names and
 * from `wh-vault list --all --json`, which reads no value.
 *
 * The Vault plugin, which draws the page, stays read-only; only this module,
 * reached through POST /api/vault (Origin and session token checked in
 * hooks.server.ts), changes the vault. Changes run one at a time.
 */

/** How long `set` and `remove` may take: a Keychain dialog may be waiting on the screen. */
const KEYCHAIN_TIMEOUT_MS = 130_000;
const TIMEOUT_MS = 10_000;
const MAX_OUTPUT_BYTES = 2 * 1024 * 1024;
/** Far above what the Keychain takes (about 1,900 bytes); `wh-vault set` says when it is too long. */
export const MAX_VALUE_BYTES = 16 * 1024;

export interface VaultServiceOptions {
	/** The bundled `wh-vault` script. */
	cli: string;
	/** Wheelhouse's config directory, whose `vault` folder holds the vault. */
	configDir: string;
	env: NodeJS.ProcessEnv;
	/** The Node.js that runs the script (default: this one). */
	node?: string;
}

export type VaultChangeOutcome =
	({ ok: true } & VaultChangeResult) | { ok: false; status: number; message: string };

/**
 * A change from a request body, or why it is not one. `known` is the projects
 * Wheelhouse knows: a secret can be granted only to one of them, and revoked
 * from any project it is granted to.
 */
export function parseChange(
	body: Record<string, unknown>,
	known: ReadonlySet<string>
): { ok: true; change: VaultChange } | { ok: false; message: string } {
	const bad = (message: string) => ({ ok: false as const, message });
	const { action, name, value, projects } = body;
	if (action !== 'set' && action !== 'grant' && action !== 'revoke' && action !== 'remove') {
		return bad('action must be set, grant, revoke or remove.');
	}
	if (typeof name !== 'string' || !SECRET_NAME.test(name)) {
		return bad(
			'A secret’s name is an environment variable name: letters, digits and underscores, not starting with a digit.'
		);
	}
	if (action === 'remove') return { ok: true, change: { action, name } };
	const list = projects ?? [];
	if (!Array.isArray(list) || !list.every((p) => typeof p === 'string' && PROJECT_ID.test(p))) {
		return bad('projects must be a list of project names.');
	}
	const ids = [...new Set(list as string[])].sort();
	if (action !== 'revoke') {
		const unknown = ids.filter((p) => !known.has(p));
		if (unknown.length) return bad(`Wheelhouse does not know the project ${andList(unknown)}.`);
	}
	if (action === 'set') {
		if (typeof value !== 'string' || !value) return bad('Give the secret a value.');
		if (Buffer.byteLength(value) > MAX_VALUE_BYTES) return bad('That value is far too long.');
		return { ok: true, change: { action, name, value, projects: ids } };
	}
	if (!ids.length) return bad('Name at least one project.');
	return { ok: true, change: { action, name, projects: ids } };
}

export class VaultService {
	private queue: Promise<unknown> = Promise.resolve();

	constructor(private readonly o: VaultServiceOptions) {}

	/** Why changes cannot be made here, or null when they can. */
	unavailable(): string | null {
		return existsSync(this.o.cli)
			? null
			: 'The wh-vault bundled with Wheelhouse is missing (npm run build makes it).';
	}

	/** Make one change, after any already under way. */
	change(c: VaultChange): Promise<VaultChangeOutcome> {
		const next = this.queue.then(() => this.apply(c));
		this.queue = next.catch(() => {});
		return next;
	}

	private async apply(c: VaultChange): Promise<VaultChangeOutcome> {
		const missing = this.unavailable();
		if (missing) return { ok: false, status: 503, message: missing };
		const before = await this.list();
		if (!before.ok) return { ok: false, status: 502, message: before.message };
		const had = before.secrets.find((s) => s.name === c.name);
		if (c.action !== 'set' && !had) {
			return { ok: false, status: 404, message: `The vault has no secret named ${c.name}.` };
		}
		let message: string;
		switch (c.action) {
			case 'set': {
				const r = await this.run(['set', c.name], KEYCHAIN_TIMEOUT_MS, c.value);
				if (!r.ok) return { ok: false, status: 502, message: failure(r, 'store', c.value) };
				const added = c.projects.filter((p) => !had?.projects.includes(p));
				if (added.length) {
					const g = await this.run(['grant', c.name, ...added], TIMEOUT_MS);
					if (!g.ok) {
						return {
							ok: false,
							status: 502,
							message: `Stored ${c.name}, but could not let ${andList(added)} use it: ${failure(g, 'grant', c.value)}`
						};
					}
				}
				const projects = [...new Set([...(had?.projects ?? []), ...added])].sort();
				const who = projects.length
					? `${andList(projects)} can use it.`
					: 'No project can use it yet.';
				message = had
					? `Replaced the value of ${c.name}. ${added.length ? who : ''}`.trim()
					: `Stored ${c.name} in your Mac’s login Keychain. ${who}`;
				break;
			}
			case 'grant':
			case 'revoke': {
				const r = await this.run([c.action, c.name, ...c.projects], TIMEOUT_MS);
				if (!r.ok) return { ok: false, status: 502, message: failure(r, c.action) };
				const can = c.action === 'grant' ? 'can now use' : 'can no longer use';
				message = `${andList(c.projects)} ${can} ${c.name}.`;
				break;
			}
			case 'remove': {
				const r = await this.run(['remove', c.name], KEYCHAIN_TIMEOUT_MS);
				if (!r.ok) return { ok: false, status: 502, message: failure(r, 'remove') };
				message = `Removed ${c.name}. Its value is deleted from the Keychain and no project can use it.`;
				break;
			}
		}
		const after = await this.list();
		const observedAt = new Date().toISOString();
		// The change is made; if the vault cannot be read back, the page keeps what it showed.
		if (!after.ok) return { ok: true, message, secrets: before.secrets, observedAt };
		return { ok: true, message, secrets: after.secrets, observedAt };
	}

	/** Every secret's name, grants and dates, from `wh-vault list --all --json`. */
	async list(): Promise<{ ok: true; secrets: VaultSecret[] } | { ok: false; message: string }> {
		const r = await this.run(['list', '--all', '--json'], TIMEOUT_MS);
		if (!r.ok) return { ok: false, message: failure(r, 'read') };
		try {
			const v = JSON.parse(r.stdout) as { schema?: unknown; secrets?: unknown };
			if (v.schema !== 'wh-vault.list.v1' || !Array.isArray(v.secrets)) throw new Error();
			return {
				ok: true,
				secrets: (v.secrets as VaultSecret[]).map((s) => ({
					name: s.name,
					projects: s.projects,
					updatedAt: s.updatedAt,
					lastUsedAt: s.lastUsedAt ?? null
				}))
			};
		} catch {
			return { ok: false, message: 'wh-vault gave an answer Wheelhouse does not know.' };
		}
	}

	/**
	 * Run the bundled wh-vault with `args`, and `input` on its standard input.
	 * Its environment is only what it needs to find the Keychain: never the
	 * task variables (FM_TASK_ID and the like) that would log the change as a task's.
	 */
	private run(args: string[], timeoutMs: number, input?: string): Promise<RunResult> {
		const env = this.o.env;
		return runBounded(
			this.o.node ?? process.execPath,
			[this.o.cli, '--config-dir', this.o.configDir, ...args],
			{
				cwd: env.HOME || '/',
				env: {
					PATH: env.PATH ?? '/usr/bin:/bin',
					HOME: env.HOME ?? '',
					LANG: env.LANG ?? 'C.UTF-8',
					...(env.TMPDIR ? { TMPDIR: env.TMPDIR } : {})
				},
				timeoutMs,
				maxOutputBytes: MAX_OUTPUT_BYTES,
				maxErrorBytes: 4 * 1024,
				...(input === undefined ? {} : { input, maxInputBytes: MAX_VALUE_BYTES })
			}
		);
	}
}

/**
 * Why a wh-vault run failed, in plain words: its own one-line reason, else how
 * it ended. Never anything that holds the value, should a reason ever repeat it.
 */
function failure(r: Exclude<RunResult, { ok: true }>, verb: string, value?: string): string {
	const said = r.stderr
		.split('\n')
		.map((l) => l.trim())
		.find(Boolean)
		?.replace(/^wh-vault:\s*/, '')
		.replace(/\.$/, '');
	const hex = value ? Buffer.from(value, 'utf8').toString('hex') : '';
	const leaks = (s: string) => !!value && (s.includes(value) || s.includes(hex));
	if (r.kind === 'timeout') {
		return `wh-vault did not finish in time; a Keychain dialog may be waiting on the Mac’s screen.`;
	}
	if (said && !leaks(said)) return `Could not ${verb} it: ${said}.`;
	return `Could not ${verb} it: wh-vault ${r.kind === 'exit' ? `exited ${r.code}` : 'did not run'}.`;
}
