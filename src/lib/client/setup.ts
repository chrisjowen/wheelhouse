import type {
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
	clone: (t: string, dir: string) =>
		act<{ dir: string; output: string; restarting: boolean }>(t, 'clone', { dir }),
	use: (t: string, dir: string) => act<{ dir: string; restarting: boolean }>(t, 'use', { dir }),
	sessionBackend: (t: string, backend: SessionBackendName | null) =>
		act<{ session: SessionSetting; restarting: boolean }>(t, 'session-backend', { backend }),
	tools: (t: string) => act<ToolsReport>(t, 'tools'),
	install: (t: string, tool: string) => act<InstallOutcome>(t, 'install', { tool }),
	claude: (t: string) => act<ClaudeStatus>(t, 'claude'),
	claudeInstall: (t: string) =>
		act<{ outcome: InstallOutcome; status: ClaudeStatus }>(t, 'claude-install'),
	claudeTest: (t: string) => act<ClaudeStatus>(t, 'claude-test'),
	check: (t: string) => act<CheckReport>(t, 'check'),
	plugins: (t: string) => act<SetupPlugin[]>(t, 'plugins'),
	plugin: (t: string, id: string, on: boolean) => act<SetupPlugin[]>(t, 'plugin', { id, on }),
	finish: (t: string) => act<FirstmateSessionViewLike>(t, 'finish')
};
