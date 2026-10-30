import type { PluginPageView } from '$lib/plugins/types';
import type { PluginPreview, PluginUpdatesView } from '$lib/updates';
import { live } from './live.svelte';
import { SESSION_HEADER } from './messages';

/**
 * The Plugins pages' calls: installed plugins' update state, looking a plugin
 * up before installing or updating it, and doing so; and turning a plugin on
 * or off and changing its settings. Each change is a POST
 * carrying the session token; a kept change restarts Wheelhouse, and
 * `afterRestart` settles when the restarted server answers.
 */

export type Answer<T> = { ok: true; value: T } | { ok: false; error: string };

export type PluginsUpdates = PluginUpdatesView & { checking: boolean; busy: string[] };

async function call<T>(url: string, token: string | null, body?: unknown): Promise<Answer<T>> {
	try {
		const res = await fetch(
			url,
			token === null
				? undefined
				: {
						method: 'POST',
						headers: { 'content-type': 'application/json', [SESSION_HEADER]: token },
						body: JSON.stringify(body ?? {})
					}
		);
		const json = (await res.json().catch(() => null)) as (T & { message?: string }) | null;
		if (res.ok && json) return { ok: true, value: json };
		return { ok: false, error: json?.message ?? `Wheelhouse answered ${res.status}.` };
	} catch {
		return { ok: false, error: 'Wheelhouse did not answer.' };
	}
}

export const pluginUpdates = () => call<PluginsUpdates>('/api/plugins/updates', null);
export const checkPluginUpdates = (token: string) =>
	call<PluginsUpdates>('/api/plugins/updates', token);

/** Look up `org/repo` (at `ref`) to install, or an installed plugin's update (`id`, moving to `ref`). */
export const lookUp = (
	q: { repo: string; ref: string | null } | { id: string; ref: string | null },
	token: string
) => call<PluginPreview>('/api/plugins/inspect', token, q);

export const installPlugin = (p: PluginPreview, settings: Record<string, string>, token: string) =>
	call<{ ok: true; restarting: boolean }>('/api/plugins/install', token, {
		repo: p.repository,
		ref: p.ref,
		commit: p.commit,
		settings
	});

export const updatePlugin = (p: PluginPreview, settings: Record<string, string>, token: string) =>
	call<{ ok: true; restarting: boolean }>(
		`/api/plugins/${encodeURIComponent(p.id)}/update`,
		token,
		{
			ref: p.ref,
			commit: p.commit,
			settings
		}
	);

/**
 * Settles true once the restarted Wheelhouse answers on the live stream, or
 * false after `ms` without it.
 */
export function afterRestart(ms = 60_000): Promise<boolean> {
	return new Promise((resolve) => {
		const timer = setTimeout(() => {
			off();
			resolve(false);
		}, ms);
		const off = live.onRestart(() => {
			clearTimeout(timer);
			off();
			resolve(true);
		});
	});
}

/**
 * A plugin's page changes one thing in the plugins file: whether it is on for
 * every project or for one (null goes back to the default), or its settings,
 * as the form's answers by key. Each applies without a restart.
 */
export const changePlugin = (
	id: string,
	change:
		| { enabled: boolean | null }
		| { project: string; enabled: boolean | null }
		| { settings: Record<string, string> },
	token: string
) => call<PluginPageView>(`/api/plugins/${encodeURIComponent(id)}/config`, token, change);

/** Turn an installed plugin that is off back on; Wheelhouse restarts to load it. */
export const loadPlugin = (id: string, token: string) =>
	call<{ ok: true; restarting: boolean }>(`/api/plugins/${encodeURIComponent(id)}/load`, token);
