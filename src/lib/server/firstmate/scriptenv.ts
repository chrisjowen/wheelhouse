import { execFileSync } from 'node:child_process';
import os from 'node:os';

/**
 * The environment Firstmate's scripts run with. They are given Wheelhouse's
 * own environment, but a server started by something other than a login shell
 * (a launcher, a service manager, `env -i`) can be missing what a remote
 * second mate's reads need: fm-fleet-snapshot.sh and fm-on.sh reach a remote
 * home with ssh, which finds its host alias, keys and known hosts under HOME,
 * its agent through SSH_AUTH_SOCK, and itself on PATH. Whatever is missing is
 * filled in from this account (HOME, USER, LOGNAME), the usual places ssh
 * lives (PATH), and, on macOS, the agent launchd keeps for the user
 * (SSH_AUTH_SOCK). Nothing already set is changed.
 *
 * The snapshot's remote reads also get a realistic budget: fm-fleet-snapshot.sh
 * gives every remote home's summary read together FM_SNAPSHOT_BUDGET seconds
 * (5 by default), which one SSH round trip to a distant host can use up; a
 * read that runs out falls back to the last cached copy. Unless it is set,
 * Wheelhouse asks for SNAPSHOT_BUDGET_S.
 */

/** FM_SNAPSHOT_BUDGET for Wheelhouse's snapshots, unless the environment sets one. */
export const SNAPSHOT_BUDGET_S = 20;

const PATH_DIRS = ['/usr/local/bin', '/opt/homebrew/bin', '/usr/bin', '/bin', '/usr/sbin', '/sbin'];

export interface ScriptEnvDeps {
	platform?: NodeJS.Platform;
	user?: () => { homedir: string; username: string } | null;
	/** The user's ssh agent socket from launchd, on macOS; null when there is none. */
	agentSocket?: () => string | null;
}

function launchdAgent(): string | null {
	try {
		const out = execFileSync('launchctl', ['getenv', 'SSH_AUTH_SOCK'], {
			encoding: 'utf8',
			timeout: 2_000,
			stdio: ['ignore', 'pipe', 'ignore']
		}).trim();
		return out || null;
	} catch {
		return null;
	}
}

function account(): { homedir: string; username: string } | null {
	try {
		const u = os.userInfo();
		return { homedir: u.homedir, username: u.username };
	} catch {
		return null;
	}
}

export function scriptEnv(env: NodeJS.ProcessEnv, deps: ScriptEnvDeps = {}): NodeJS.ProcessEnv {
	const out: NodeJS.ProcessEnv = { ...env };
	const me = (deps.user ?? account)();
	if (!out.HOME && me?.homedir) out.HOME = me.homedir;
	if (!out.USER && me?.username) out.USER = me.username;
	if (!out.LOGNAME && (out.USER || me?.username)) out.LOGNAME = out.USER ?? me!.username;
	const have = (out.PATH ?? '').split(':').filter(Boolean);
	const missing = PATH_DIRS.filter((d) => !have.includes(d));
	if (missing.length) out.PATH = [...have, ...missing].join(':');
	if (!out.SSH_AUTH_SOCK && (deps.platform ?? process.platform) === 'darwin') {
		const sock = (deps.agentSocket ?? launchdAgent)();
		if (sock) out.SSH_AUTH_SOCK = sock;
	}
	if (!out.FM_SNAPSHOT_BUDGET) out.FM_SNAPSHOT_BUDGET = String(SNAPSHOT_BUDGET_S);
	return out;
}
