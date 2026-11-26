import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { Help, type Command } from 'commander';
import { agentRoute, captainPage } from '../src/lib/server/agentauth';
import { featureForPath } from '../src/lib/server/features';
import { program } from './index';
import { PREVIEW_PROXY_ENV } from '../src/lib/hosted';
import { PROXY_PREFIX } from '../src/lib/server/previewproxy';
import { RESTART_PATH } from './running';
import { vaultProgram } from './vault/program';
import type { Backends } from './vault/select';

/**
 * The manage-wheelhouse skill's operations reference
 * (skills/manage-wheelhouse/references/operations.md), generated from the
 * code so it cannot drift from it: every command's `--help`, and every HTTP
 * route under src/routes with the methods it exports and who may call each.
 * scripts/gen-operations.mjs writes it (in prepack, so the package always
 * carries this version's), and operations.test.ts fails when the committed
 * copy differs.
 */

export const OPERATIONS_FILE = 'skills/manage-wheelhouse/references/operations.md';

const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const;
/** Help is wrapped at a fixed width, so the reference reads the same whatever terminal made it. */
const HELP_WIDTH = 100;

export interface RouteEntry {
	/** The route as a path, `[id]` parameters kept as SvelteKit names them. */
	path: string;
	methods: string[];
}

/** Every `+server.ts` under `routesDir`, with the methods it exports, sorted by path. */
export async function routeTree(routesDir: string): Promise<RouteEntry[]> {
	const out: RouteEntry[] = [];
	const walk = async (dir: string, rel: string) => {
		for (const e of await readdir(dir, { withFileTypes: true })) {
			if (e.isDirectory()) await walk(path.join(dir, e.name), `${rel}/${e.name}`);
			else if (e.name === '+server.ts') {
				const text = await readFile(path.join(dir, e.name), 'utf8');
				const methods = METHODS.filter((m) => new RegExp(`^export const ${m}\\b`, 'm').test(text));
				// A (group) folder is not part of the address.
				out.push({ path: rel.replace(/\/\([^/]+\)/g, '') || '/', methods });
			}
		}
	};
	await walk(routesDir, '');
	return out.sort((a, b) => a.path.localeCompare(b.path));
}

/** A concrete address for a route, to ask the access tables about it. */
const sample = (route: string) =>
	route.replace(/\[\.\.\.[^\]]+\]/g, 'x/y').replace(/\[[^\]]+\]/g, 'x');

/** Who may call `method` on `route`: anyone on this computer for a read, else the page, the agent token or only the captain. */
export function access(method: string, route: string): string {
	if (method === 'GET') return 'read';
	const at = sample(route);
	if (captainPage(at)) return 'captain only';
	if (agentRoute(method, at)) return 'agent token';
	return 'page only';
}

/** Every visible command under `root`, depth first, with its full name. */
export function commandTree(root: Command): { name: string; command: Command }[] {
	const help = new Help();
	const out: { name: string; command: Command }[] = [];
	const walk = (c: Command, prefix: string) => {
		const name = prefix ? `${prefix} ${c.name()}` : c.name();
		out.push({ name, command: c });
		for (const sub of help.visibleCommands(c)) {
			if (sub.name() !== 'help') walk(sub, name);
		}
	};
	walk(root, '');
	return out;
}

/** A command's `--help`, wrapped at a fixed width and without colour. */
export function helpText(c: Command): string {
	c.configureHelp({ helpWidth: HELP_WIDTH });
	c.configureOutput({ getOutHasColors: () => false, getOutHelpWidth: () => HELP_WIDTH });
	return c.helpInformation().trimEnd();
}

/** Every long flag a command takes (its own, not its parents'). */
export const flagsOf = (c: Command): string[] =>
	c.options.map((o) => o.long).filter((l): l is string => !!l);

const fence = (text: string) => '```text\n' + text + '\n```';

export function renderOperations(o: {
	version: string;
	programs: Command[];
	routes: RouteEntry[];
}): string {
	const lines: string[] = [
		'# Wheelhouse operations reference',
		'',
		`Generated from Wheelhouse ${o.version} by \`scripts/gen-operations.mjs\`; do not edit it by hand. It lists every command with its \`--help\`, and every HTTP route with who may call it. Read only the section you need; SKILL.md says which command to reach for.`,
		'',
		'Route access: **read** needs no token (a GET from this computer); **agent token** takes `Authorization: Bearer <token>` from the running record, which the `wheelhouse` agent commands send for you; **page only** needs the open page’s session, so use a command or ask the captain; **captain only** is the captain’s own call and refuses the agent token with the page to make it on. Paths marked *experimental* answer 404 until that feature is on in Settings → Experimental features.',
		''
	];
	for (const program of o.programs) {
		lines.push(`## \`${program.name()}\` commands`, '');
		for (const { name, command } of commandTree(program)) {
			lines.push(`### ${name}`, '', fence(helpText(command)), '');
		}
	}
	lines.push(
		'## HTTP routes',
		'',
		'| Route | Method | Access |',
		'| --- | --- | --- |',
		`| \`${RESTART_PATH}\` | GET, POST | agent token (served by the \`wheelhouse\` watcher, not the app; \`wheelhouse restart\` calls it) |`,
		`| \`${PROXY_PREFIX}<port>/…\` | any, and WebSockets | read: the preview on \`127.0.0.1:<port>\`, sandboxed, only while \`--preview-proxy on\` (\`$${PREVIEW_PROXY_ENV}\`), and only for a port Wheelhouse shows or \`--preview-ports\` names, never its own (served by the server's preview proxy, not the app) |`
	);
	for (const r of o.routes) {
		const feature = featureForPath(sample(r.path));
		for (const m of r.methods) {
			const note = feature ? ` (experimental: ${feature})` : '';
			lines.push(`| \`${r.path}\` | ${m} | ${access(m, r.path)}${note} |`);
		}
	}
	lines.push('');
	return lines.join('\n');
}

/**
 * wh-vault's help names where values are kept on this computer; the reference
 * names every platform's instead, so a Mac and Linux generate the same file.
 */
const anyPlatform: Backends = {
	primary: {
		id: 'keychain',
		where: 'the macOS login Keychain, or the Secret Service keyring on Linux',
		short: 'the keychain',
		storeProblem: async () => null,
		get: async () => '',
		set: async () => {},
		remove: async () => {}
	},
	ids: ['keychain', 'secret-service', 'env-file'],
	make() {
		return this.primary;
	},
	hint: () => null
};

/** The reference for the checkout at `root`, as Wheelhouse `version`. */
export async function operationsReference(root: string, version: string): Promise<string> {
	const vault = vaultProgram({
		backend: anyPlatform,
		env: {},
		cwd: root,
		stdout: process.stdout,
		stderr: process.stderr,
		readValue: async () => null
	});
	return renderOperations({
		version,
		programs: [program(), vault],
		routes: await routeTree(path.join(root, 'src', 'routes'))
	});
}
