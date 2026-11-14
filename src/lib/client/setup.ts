import type { AgentChoice } from '$lib/agent';
import type {
	AgentView,
	CheckReport,
	ClaudeStatus,
	FirstmateSessionViewLike,
	LocationCheck,
	SessionBackendName,
	SessionSetting,
	SetupPlugin,
	SetupView,
	ToolsReport
} from '$lib/setup';
import { SESSION_HEADER } from './messages';
import type { Answer } from './plugins';

/** The setup wizard's calls to /api/setup, each a POST with the page's session token. */

async function act<T>(
	token: string,
	action: string,
	body: Record<string, unknown> = {}
): Promise<Answer<T>> {
	try {
		const res = await fetch('/api/setup', {
			method: 'POST',
			headers: { 'content-type': 'application/json', [SESSION_HEADER]: token },
			body: JSON.stringify({ action, ...body })
		});
		const json = (await res.json().catch(() => null)) as (T & { message?: string }) | null;
		if (res.ok && json) return { ok: true, value: json };
		return { ok: false, error: json?.message ?? `Wheelhouse answered ${res.status}.` };
	} catch {
		return { ok: false, error: 'Wheelhouse did not answer.' };
	}
}

export interface InstallOutcome {
	command: string;
	dryRun: boolean;
	output: string;
}

export const setup = {
	view: async (): Promise<SetupView | null> => {
		try {
			const r = await fetch('/api/setup');
			return r.ok ? ((await r.json()) as SetupView) : null;
		} catch {
			return null;
		}
	},
	inspect: (t: string, dir: string) => act<LocationCheck>(t, 'inspect', { dir }),
	getFirstmate: (t: string) =>
		act<{ dir: string; output: string; restarting: boolean }>(t, 'get-firstmate'),
	clone: (t: string, dir: string) =>
		act<{ dir: string; output: string; restarting: boolean }>(t, 'clone', { dir }),
	use: (t: string, dir: string) => act<{ dir: string; restarting: boolean }>(t, 'use', { dir }),
	sessionBackend: (t: string, backend: SessionBackendName | null) =>
		act<{ session: SessionSetting; restarting: boolean }>(t, 'session-backend', { backend }),
	tools: (t: string) => act<ToolsReport>(t, 'tools'),
	install: (t: string, tool: string) => act<InstallOutcome>(t, 'install', { tool }),
	chooseAgent: (t: string, c: AgentChoice) =>
		act<{ agent: AgentView; restarting: boolean }>(t, 'agent-choose', { ...c }),
	agent: (t: string) => act<ClaudeStatus>(t, 'agent'),
	agentInstall: (t: string) =>
		act<{ outcome: InstallOutcome; status: ClaudeStatus }>(t, 'agent-install'),
	agentTest: (t: string) => act<ClaudeStatus>(t, 'agent-test'),
	agentKey: (t: string, value: string, replace = false) =>
		act<{ name: string; message: string; exists: boolean }>(t, 'agent-key', { value, replace }),
	check: (t: string) => act<CheckReport>(t, 'check'),
	plugins: (t: string) => act<SetupPlugin[]>(t, 'plugins'),
	plugin: (t: string, id: string, on: boolean) => act<SetupPlugin[]>(t, 'plugin', { id, on }),
	finish: (t: string) => act<FirstmateSessionViewLike>(t, 'finish')
};

/** Where Install all is: the tool installing now, counted from 1. */
export interface InstallAllProgress {
	tool: string;
	index: number;
	total: number;
}

export interface InstallAllResult {
	tool: string;
	ok: boolean;
	/** What the install printed, or why it failed. */
	text: string;
}

/**
 * Install each tool in turn, through the same one-click install as its own
 * row (the server re-reads Firstmate's command for it; never one from here).
 * One that fails does not stop the rest: each says how it went.
 */
export async function installAll(
	tools: string[],
	install: (tool: string) => Promise<Answer<InstallOutcome>>,
	progress: (p: InstallAllProgress) => void = () => {}
): Promise<InstallAllResult[]> {
	const results: InstallAllResult[] = [];
	for (const [i, tool] of tools.entries()) {
		progress({ tool, index: i + 1, total: tools.length });
		const r = await install(tool);
		results.push(
			r.ok ? { tool, ok: true, text: r.value.output } : { tool, ok: false, text: r.error }
		);
	}
	return results;
}
