import { accessSync, constants, existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { DepItem, PackageManager, PlatformView, ToolsReport } from '../../setup';
import { runBounded } from '../firstmate/exec';
import { which, type Run } from '../sessions/tmux';
import { checkHerdr, HERDR_MIN_VERSION } from '../sessions/herdr';
import type { SessionBackendName } from '../sessions/choice';

/**
 * What Firstmate needs, from Firstmate itself: the wizard runs its own
 * bootstrap check (`bin/fm-bootstrap.sh`, detect-only, as its session start
 * does when another session holds the lock) and reads the lines it prints:
 *
 *   MISSING: <tool> (install: <command>)
 *   MISSING_MANUAL: <tool> (instructions: <url>)
 *   OUTDATED: <tool> (installed: <v>; requires <floor>; upgrade: <command>)
 *   PRESENTATION_UNAVAILABLE: <tool> (requires <floor>; install: <command>) - <why>
 *   NEEDS_GH_AUTH
 *   BACKEND_INVALID: <name> (known: <names>)
 *
 * The tools it checks are its own list (COMMON_TOOLS in fm-bootstrap.sh, plus
 * fm_backend_required_tools for the resolved backend); Wheelhouse adds only
 * what it needs itself: the session backend it runs the Firstmate session in,
 * tmux, or herdr at HERDR_MIN_VERSION or newer when herdr is chosen. The
 * descriptions below say what each is for; they decide nothing.
 *
 * One click is offered only for a command that is exactly a well-known package
 * manager's install (`npm install -g <pkg>`, `brew install <pkg>`), optionally
 * followed by that package's own `<pkg> setup hooks`, never with sudo and never
 * through a shell; everything else (curl | sh installers, sudo, sign-ins) is
 * shown for the captain's own terminal.
 */

export interface ToolInfo {
	what: string;
	link: string | null;
}

export const TOOL_INFO: Record<string, ToolInfo> = {
	git: {
		what: 'Version control: every project and worktree',
		link: 'https://git-scm.com/downloads'
	},
	gh: { what: 'GitHub: pull requests, CI and issues', link: 'https://cli.github.com' },
	node: { what: 'Runs Firstmate’s Node helpers and the axi tools', link: 'https://nodejs.org' },
	tmux: {
		what: 'Terminals for Firstmate and its crew',
		link: 'https://github.com/tmux/tmux/wiki/Installing'
	},
	herdr: { what: 'The Herdr runtime backend', link: 'https://herdr.dev' },
	zellij: { what: 'The Zellij runtime backend', link: 'https://zellij.dev' },
	jq: { what: 'Reads JSON in Firstmate’s scripts', link: 'https://jqlang.org/download/' },
	curl: { what: 'Downloads in Firstmate’s scripts', link: 'https://curl.se' },
	treehouse: {
		what: 'A clean git worktree for each task',
		link: 'https://github.com/kunchenguid/treehouse'
	},
	'no-mistakes': {
		what: 'Reviews, tests and ships each change as a pull request',
		link: 'https://github.com/kunchenguid/no-mistakes'
	},
	'gh-axi': { what: 'GitHub for agents', link: 'https://www.npmjs.com/package/gh-axi' },
	'chrome-devtools-axi': {
		what: 'A browser for agents, to check pages',
		link: 'https://www.npmjs.com/package/chrome-devtools-axi'
	},
	'tasks-axi': { what: 'Firstmate’s backlog', link: 'https://www.npmjs.com/package/tasks-axi' },
	'quota-axi': {
		what: 'Reads agents’ usage limits',
		link: 'https://www.npmjs.com/package/quota-axi'
	},
	'lavish-axi': {
		what: 'Visual boards for decisions and reports (optional)',
		link: 'https://www.npmjs.com/package/lavish-axi'
	},
	cmux: { what: 'The cmux runtime backend', link: 'https://cmux.com' },
	orca: { what: 'The Orca runtime backend', link: null }
};

/** Firstmate's own universal list, if bin/fm-bootstrap.sh has none we can read. */
const FALLBACK_COMMON = 'node git gh no-mistakes gh-axi chrome-devtools-axi tasks-axi quota-axi';

export function detectPlatform(
	platform: NodeJS.Platform,
	find: (name: string) => string | null
): PlatformView {
	const pm: PackageManager | null = find('brew')
		? 'brew'
		: platform === 'linux'
			? find('apt-get')
				? 'apt'
				: find('dnf')
					? 'dnf'
					: find('pacman')
						? 'pacman'
						: null
			: null;
	const os =
		platform === 'darwin'
			? 'macos'
			: platform === 'linux'
				? 'linux'
				: platform === 'win32'
					? 'windows'
					: 'other';
	const name = { macos: 'macOS', linux: 'Linux', windows: 'Windows', other: platform }[os];
	return { os, label: pm ? `${name} (${pm})` : name, packageManager: pm };
}

export type Finding =
	| { kind: 'missing'; tool: string; command: string }
	| { kind: 'manual'; tool: string; url: string }
	| { kind: 'outdated'; tool: string; installed: string; requires: string; command: string }
	| { kind: 'optional'; tool: string; requires: string; command: string; why: string }
	| { kind: 'gh-auth' }
	| { kind: 'backend-invalid'; detail: string };

/** The lines fm-bootstrap.sh printed, as findings, and every other line as it was. */
export function parseBootstrap(text: string): { findings: Finding[]; other: string[] } {
	const findings: Finding[] = [];
	const other: string[] = [];
	for (const raw of text.split('\n')) {
		const line = raw.trimEnd();
		if (!line.trim()) continue;
		let m: RegExpMatchArray | null;
		if ((m = line.match(/^MISSING: (\S+) \(install: (.+)\)$/))) {
			findings.push({ kind: 'missing', tool: m[1], command: m[2] });
		} else if ((m = line.match(/^MISSING_MANUAL: (\S+) \(instructions: (\S+)\)$/))) {
			findings.push({ kind: 'manual', tool: m[1], url: m[2] });
		} else if (
			(m = line.match(/^OUTDATED: (\S+) \(installed: ([^;]*); requires ([^;]*); upgrade: (.+)\)$/))
		) {
			findings.push({
				kind: 'outdated',
				tool: m[1],
				installed: m[2],
				requires: m[3],
				command: m[4]
			});
		} else if (
			(m = line.match(
				/^PRESENTATION_UNAVAILABLE: (\S+) \(requires ([^;]*); install: (.+?)\) - (.*)$/
			))
		) {
			findings.push({ kind: 'optional', tool: m[1], requires: m[2], command: m[3], why: m[4] });
		} else if (line === 'NEEDS_GH_AUTH') {
			findings.push({ kind: 'gh-auth' });
		} else if ((m = line.match(/^BACKEND_INVALID: (.+)$/))) {
			findings.push({ kind: 'backend-invalid', detail: m[1] });
		} else {
			other.push(line);
		}
	}
	return { findings, other };
}

/** The universal tool list Firstmate's bootstrap declares (`COMMON_TOOLS="…"`). */
export function commonTools(bootstrapText: string | null): string[] {
	const m = bootstrapText?.match(/^COMMON_TOOLS="([^"]*)"/m);
	return (m?.[1] ?? FALLBACK_COMMON).split(/\s+/).filter(Boolean);
}

const PKG = /^(@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/;
const SHELLY = /[|;&$`<>(){}*?!'"\\]/;

export interface CommandEnv {
	packageManager: PackageManager | null;
	/** npm's global folder can be written without sudo. */
	npmWritable: boolean;
}

/** A command split into argument arrays, when it is safe to run with one click; else null. */
export function oneClickSteps(command: string, env: CommandEnv): string[][] | null {
	const parts = command.split(' && ').map((p) => p.trim());
	if (parts.some((p) => !p || SHELLY.test(p))) return null;
	const steps = parts.map((p) => p.split(/\s+/));
	const [first, ...rest] = steps;
	let pkg: string;
	if (first[0] === 'npm' && first[1] === 'install' && first[2] === '-g' && first.length === 4) {
		if (!env.npmWritable) return null;
		pkg = first[3];
	} else if (first[0] === 'brew' && first[1] === 'install' && env.packageManager === 'brew') {
		const args = first.slice(2);
		if (args.length === 2 && args[0] === '--cask') pkg = args[1];
		else if (args.length === 1) pkg = args[0];
		else return null;
	} else {
		return null;
	}
	if (!PKG.test(pkg)) return null;
	// The only follow-up allowed is the package's own documented setup step.
	const name = pkg.replace(/^@[^/]+\//, '');
	for (const s of rest) {
		if (!(s.length === 3 && s[0] === name && s[1] === 'setup' && s[2] === 'hooks')) return null;
	}
	return steps;
}

/** How to install a system tool with this computer's package manager, for the captain's terminal. */
export function systemInstall(tool: string, pm: PackageManager | null): string | null {
	const names: Record<string, Partial<Record<PackageManager, string>>> = {
		gh: { apt: '', dnf: 'gh', pacman: 'github-cli' },
		node: { apt: '', dnf: 'nodejs', pacman: 'nodejs npm' }
	};
	if (!pm) return null;
	const pkg = names[tool]?.[pm] ?? tool;
	// Debian's own gh and node are too old or missing: their sites say how to add theirs.
	if (!pkg) return null;
	switch (pm) {
		case 'brew':
			return `brew install ${pkg}`;
		case 'apt':
			return `sudo apt-get install -y ${pkg}`;
		case 'dnf':
			return `sudo dnf install -y ${pkg}`;
		case 'pacman':
			return `sudo pacman -S --needed ${pkg}`;
	}
}

const SYSTEM_TOOLS = new Set(['git', 'gh', 'node', 'tmux', 'jq', 'curl', 'zellij']);

/** The commands for one finding: one click where safe, else for the terminal. */
export function remedy(
	tool: string,
	command: string,
	env: CommandEnv
): Pick<DepItem, 'oneClick' | 'terminal' | 'note'> {
	// Firstmate writes `brew install X  # or the platform's package manager`.
	const hash = command.indexOf('  #');
	const bare = (hash >= 0 ? command.slice(0, hash) : command).trim();
	const comment = hash >= 0 ? command.slice(hash + 3).trim() : null;
	if (SYSTEM_TOOLS.has(tool) && bare.startsWith('brew ') && env.packageManager !== 'brew') {
		const sys = systemInstall(tool, env.packageManager);
		return {
			oneClick: null,
			terminal: sys ? [sys] : [],
			note: sys ? null : 'Install it from its website for this computer.'
		};
	}
	const steps = oneClickSteps(bare, env);
	if (steps) return { oneClick: { command: bare }, terminal: [], note: comment };
	const npm = bare.startsWith('npm install -g ') && !env.npmWritable;
	return {
		oneClick: null,
		terminal: [bare],
		note: npm
			? 'npm’s global folder needs sudo on this computer, so Wheelhouse will not run it for you. Run it in your terminal, or set npm up to install into your own folder (nvm does).'
			: (comment ?? null)
	};
}

/** Whether npm's global folder (`npm prefix -g`) can be written by this user. */
export async function npmWritable(
	run: Run,
	npm: string | null,
	env: NodeJS.ProcessEnv
): Promise<boolean> {
	if (!npm) return false;
	const r = await run(npm, ['prefix', '-g'], { env, timeoutMs: 10_000, maxOutputBytes: 4096 });
	if (!r.ok) return false;
	const prefix = r.stdout.trim();
	const dir = process.platform === 'win32' ? prefix : path.join(prefix, 'lib', 'node_modules');
	for (const d of [dir, prefix]) {
		if (!existsSync(d)) continue;
		try {
			accessSync(d, constants.W_OK);
			return true;
		} catch {
			return false;
		}
	}
	return false;
}

/** The first line of `<tool> --version`, for a tick's detail. */
async function versionOf(run: Run, file: string, env: NodeJS.ProcessEnv): Promise<string | null> {
	// tmux has no --version; every other tool Firstmate checks answers it.
	const flag = path.basename(file) === 'tmux' ? '-V' : '--version';
	const r = await run(file, [flag], { env, timeoutMs: 5_000, maxOutputBytes: 8 * 1024 });
	const first = r.ok ? (r.stdout || r.stderr).trim().split('\n')[0] : '';
	return first ? first.slice(0, 80) : null;
}

export interface ToolsOptions {
	firstmateDir: string;
	homeDir: string;
	env: NodeJS.ProcessEnv;
	platform: PlatformView;
	run?: Run;
	find?: (name: string) => string | null;
	timeoutMs?: number;
	/** What Wheelhouse runs the Firstmate session in (default tmux). */
	sessionBackend?: SessionBackendName;
}

const BOOTSTRAP_TIMEOUT_MS = 90_000;

/** Firstmate's resolved backend and the tools it needs, from Firstmate's own backend library. */
async function backendTools(
	opts: ToolsOptions,
	run: Run,
	bash: string
): Promise<{ backend: string | null; tools: string[] }> {
	const lib = path.join(opts.firstmateDir, 'bin', 'fm-backend.sh');
	if (!existsSync(lib)) return { backend: null, tools: ['tmux', 'treehouse'] };
	const r = await run(
		bash,
		[
			'-c',
			'. "$1" && n=$(fm_backend_name) && printf "%s\\n%s\\n" "$n" "$(fm_backend_required_tools "$n")"',
			'fm',
			lib
		],
		{
			cwd: opts.firstmateDir,
			env: { ...opts.env, FM_HOME: opts.homeDir },
			timeoutMs: 15_000,
			maxOutputBytes: 16 * 1024
		}
	);
	if (!r.ok) return { backend: null, tools: ['tmux', 'treehouse'] };
	const [backend, tools = ''] = r.stdout.split('\n');
	return { backend: backend.trim() || null, tools: tools.split(/\s+/).filter(Boolean) };
}

/** Run Firstmate's bootstrap check and turn what it says into the wizard's list. */
export async function checkTools(opts: ToolsOptions): Promise<ToolsReport> {
	const run = opts.run ?? runBounded;
	const find = opts.find ?? ((n: string) => which(n, opts.env.PATH));
	const checkedAt = new Date().toISOString();
	const script = path.join(opts.firstmateDir, 'bin', 'fm-bootstrap.sh');
	const bash = find('bash');
	if (!bash) {
		return {
			backend: null,
			items: [],
			notes: [],
			error: 'bash is not on PATH; Firstmate’s scripts need it.',
			checkedAt
		};
	}
	let scriptText: string | null = null;
	try {
		scriptText = readFileSync(script, 'utf8');
	} catch {
		return {
			backend: null,
			items: [],
			notes: [],
			error: `${script} is missing, so Firstmate’s own check cannot run.`,
			checkedAt
		};
	}
	const [boot, backend, writable] = await Promise.all([
		run(bash, [script], {
			cwd: opts.firstmateDir,
			// Detect-only: the check's read-only half. It never changes the home or a project.
			env: { ...opts.env, FM_HOME: opts.homeDir, FM_BOOTSTRAP_DETECT_ONLY: '1' },
			timeoutMs: opts.timeoutMs ?? BOOTSTRAP_TIMEOUT_MS,
			maxOutputBytes: 256 * 1024
		}),
		backendTools(opts, run, bash),
		npmWritable(run, find('npm'), opts.env)
	]);
	if (!boot.ok && boot.kind !== 'exit') {
		return {
			backend: backend.backend,
			items: [],
			notes: [],
			error: `Firstmate’s check did not finish: ${boot.message}`,
			checkedAt
		};
	}
	const { findings, other } = parseBootstrap(boot.stdout);
	const cmdEnv: CommandEnv = {
		packageManager: opts.platform.packageManager,
		npmWritable: writable
	};
	const session = opts.sessionBackend ?? 'tmux';
	const expected = unique([session, ...backend.tools, ...commonTools(scriptText)]);
	const items = new Map<string, DepItem>();
	const base = (tool: string, required = true): DepItem => ({
		tool,
		what: TOOL_INFO[tool]?.what ?? 'Needed by Firstmate',
		status: 'ok',
		detail: null,
		required,
		oneClick: null,
		terminal: [],
		link: TOOL_INFO[tool]?.link ?? null,
		note: null
	});
	const notes = [...other];
	for (const f of findings) {
		if (f.kind === 'gh-auth') {
			const gh = items.get('gh') ?? base('gh');
			items.set('gh', {
				...gh,
				status: gh.status === 'ok' ? 'needs-auth' : gh.status,
				detail: 'Not signed in to GitHub',
				terminal: [...gh.terminal, 'gh auth login'],
				note: 'Signing in asks you questions and opens a browser, so it runs in your own terminal. Wheelhouse never sees the token.'
			});
		} else if (f.kind === 'backend-invalid') {
			notes.unshift(`Firstmate’s backend setting is not one it knows: ${f.detail}`);
		} else if (f.kind === 'manual') {
			items.set(f.tool, {
				...base(f.tool),
				status: 'missing',
				detail: 'Not installed',
				link: f.url,
				note: 'Install it by its own instructions.'
			});
		} else {
			const item = base(f.tool, f.kind !== 'optional');
			const detail =
				f.kind === 'missing'
					? 'Not installed'
					: f.kind === 'outdated'
						? `${f.installed} installed; Firstmate needs ${f.requires}`
						: `Optional: ${f.why.replace(/^nonvisual/, 'Non-visual')}`;
			items.set(f.tool, {
				...item,
				status: f.kind === 'optional' ? 'optional' : f.kind,
				detail,
				...remedy(f.tool, f.command, cmdEnv)
			});
		}
	}
	// Wheelhouse itself runs the Firstmate session in its session backend, whatever Firstmate's.
	if (session === 'herdr' && !items.has('herdr')) {
		const herdr = await checkHerdr(find, opts.env, run);
		if (!herdr.ok) {
			items.set('herdr', {
				...base('herdr'),
				status: herdr.path ? 'outdated' : 'missing',
				detail: herdr.path
					? herdr.problem
					: `Not installed (Wheelhouse runs Firstmate in it; needs ${HERDR_MIN_VERSION} or newer)`,
				note: 'Install or update it by its own instructions.'
			});
		}
	}
	if (session === 'tmux' && !items.has('tmux') && !find('tmux')) {
		items.set('tmux', {
			...base('tmux'),
			status: 'missing',
			detail: 'Not installed (Wheelhouse runs Firstmate in it)',
			...remedy('tmux', 'brew install tmux', cmdEnv)
		});
	}
	// Ticks for everything Firstmate checked and found, with the version it reports.
	const present = expected.filter((t) => !items.has(t));
	const versions = await Promise.all(
		present.map(async (t) => {
			const file = find(t);
			return file ? await versionOf(run, file, opts.env) : null;
		})
	);
	present.forEach((t, i) => items.set(t, { ...base(t), detail: versions[i] }));
	const order = [...expected, ...items.keys()];
	const sorted = unique(order)
		.map((t) => items.get(t))
		.filter((i): i is DepItem => Boolean(i));
	return { backend: backend.backend, items: sorted, notes, error: null, checkedAt };
}

const unique = (xs: string[]) => [...new Set(xs)];

/** The one-click steps for a tool in `report`, from Firstmate's own command (never the page's). */
export function stepsFor(
	report: ToolsReport,
	tool: string,
	env: CommandEnv
): { command: string; steps: string[][] } | null {
	const item = report.items.find((i) => i.tool === tool);
	if (!item?.oneClick) return null;
	const steps = oneClickSteps(item.oneClick.command, env);
	return steps ? { command: item.oneClick.command, steps } : null;
}
