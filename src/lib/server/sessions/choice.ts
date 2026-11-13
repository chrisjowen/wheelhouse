import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

/**
 * Which session backend runs the Firstmate session: tmux (the default) or
 * herdr (experimental). In order, the first that is set wins:
 *
 *   1. --session-backend (the CLI passes it on as WHEELHOUSE_SESSION_BACKEND),
 *   2. WHEELHOUSE_SESSION_BACKEND,
 *   3. the setup wizard's choice, `session-backend.json` in Wheelhouse's
 *      config directory: { "backend": "herdr" },
 *   4. Firstmate's own runtime backend, `config/backend` in its home: `herdr`
 *      there means herdr; any other backend means tmux,
 *   5. tmux.
 *
 * The herdr session name comes from --herdr-session / WHEELHOUSE_HERDR_SESSION
 * (default `wheelhouse`). Synchronous, and free of SvelteKit imports, so the
 * CLI bundles it.
 */

export const SESSION_BACKENDS = ['tmux', 'herdr'] as const;
export type SessionBackendName = (typeof SESSION_BACKENDS)[number];

/** Where the setup wizard keeps its choice, in Wheelhouse's config directory. */
export const SESSION_BACKEND_FILE = 'session-backend.json';

/** Where the backend was decided: the flag or variable, the wizard, Firstmate's config, or the default. */
export type SessionBackendSource = 'env' | 'saved' | 'firstmate' | 'default';

export interface SessionChoice {
	backend: SessionBackendName;
	source: SessionBackendSource;
	/** Firstmate's `config/backend` as it is set, or null when it sets none. */
	firstmate: string | null;
	/** The herdr session name, as given (the herdr backend checks it), or null for the default. */
	herdrSession: string | null;
	/** Wheelhouse and Firstmate are set to different backends, said for the captain; else null. */
	warning: string | null;
	/** The setting cannot be used (an unknown name, an unreadable choice), said for the captain; else null. */
	error: string | null;
}

export function parseSessionBackend(value: string): SessionBackendName {
	const backend = SESSION_BACKENDS.find((name) => name === value);
	if (!backend) {
		throw new Error(
			`Unknown session backend ${JSON.stringify(value)}. Choose tmux, or herdr (experimental).`
		);
	}
	return backend;
}

export const savedBackendFile = (configDir: string) => path.join(configDir, SESSION_BACKEND_FILE);

/**
 * Firstmate's runtime backend as its home's `config/backend` sets it (the
 * first non-empty line, without spaces, as Firstmate reads it), or null.
 */
export function firstmateBackend(homeDir: string | null): string | null {
	if (!homeDir) return null;
	let text: string;
	try {
		text = readFileSync(path.join(homeDir, 'config', 'backend'), 'utf8');
	} catch {
		return null;
	}
	for (const line of text.split('\n')) {
		const value = line.replace(/\s+/g, '');
		if (value) return value;
	}
	return null;
}

/** The setup wizard's choice: a backend, null when it made none, or why it cannot be read. */
export function readSavedBackend(
	configDir: string
): { ok: true; backend: SessionBackendName | null } | { ok: false; error: string } {
	const file = savedBackendFile(configDir);
	let text: string;
	try {
		text = readFileSync(file, 'utf8');
	} catch (e) {
		if ((e as NodeJS.ErrnoException).code === 'ENOENT') return { ok: true, backend: null };
		return { ok: false, error: `Cannot read ${file}. Check its permissions.` };
	}
	try {
		const value = JSON.parse(text) as unknown;
		const backend =
			value && typeof value === 'object' && !Array.isArray(value)
				? (value as Record<string, unknown>).backend
				: undefined;
		if (typeof backend !== 'string') throw new Error('no backend');
		return { ok: true, backend: parseSessionBackend(backend) };
	} catch {
		return {
			ok: false,
			error: `The saved session backend in ${file} is not one Wheelhouse knows. Remove the file, or start Wheelhouse with --session-backend.`
		};
	}
}

/** Keep the wizard's choice, through a temporary file; null removes it (follow Firstmate). */
export function writeSavedBackend(configDir: string, backend: SessionBackendName | null): void {
	const file = savedBackendFile(configDir);
	if (backend === null) {
		rmSync(file, { force: true });
		return;
	}
	mkdirSync(configDir, { recursive: true });
	const tmp = `${file}.${process.pid}.tmp`;
	writeFileSync(tmp, `${JSON.stringify({ backend })}\n`, { mode: 0o644 });
	renameSync(tmp, file);
}

/**
 * The warning when Wheelhouse and Firstmate are set to different backends:
 * Firstmate starts its crew in its own backend, so they would not land beside
 * the Firstmate session. Only herdr against something else counts; with no
 * `config/backend`, Firstmate follows the session it runs in.
 */
export function backendMismatch(
	backend: SessionBackendName,
	firstmate: string | null
): string | null {
	if (firstmate === null || (backend === 'herdr') === (firstmate === 'herdr')) return null;
	return `Wheelhouse runs the Firstmate session in ${backend}, but Firstmate's config/backend is ${firstmate}, so its crew start in ${firstmate}, not beside it in ${backend}. Set both to the same backend to keep them together.`;
}

export interface ResolveSessionOptions {
	env: NodeJS.ProcessEnv;
	/** Wheelhouse's config directory, where the wizard keeps its choice. */
	configDir: string;
	/** Firstmate's operational home, when Wheelhouse has found one. */
	homeDir: string | null;
}

/** Which backend runs the Firstmate session, and where that was decided. */
export function resolveSessionBackend(opts: ResolveSessionOptions): SessionChoice {
	const firstmate = firstmateBackend(opts.homeDir);
	const herdrSession = opts.env.WHEELHOUSE_HERDR_SESSION || null;
	const choice = (backend: SessionBackendName, source: SessionBackendSource): SessionChoice => ({
		backend,
		source,
		firstmate,
		herdrSession,
		warning: backendMismatch(backend, firstmate),
		error: null
	});
	const requested = opts.env.WHEELHOUSE_SESSION_BACKEND;
	if (requested) {
		try {
			return choice(parseSessionBackend(requested), 'env');
		} catch (e) {
			return { ...choice('tmux', 'env'), warning: null, error: (e as Error).message };
		}
	}
	const saved = readSavedBackend(opts.configDir);
	if (!saved.ok) return { ...choice('tmux', 'saved'), warning: null, error: saved.error };
	if (saved.backend) return choice(saved.backend, 'saved');
	if (firstmate !== null) return choice(firstmate === 'herdr' ? 'herdr' : 'tmux', 'firstmate');
	return choice('tmux', 'default');
}
