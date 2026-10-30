import type {
	AppCallView,
	AppOpenView,
	AppRef,
	CallToolResult,
	ChatAppsView,
	ReadResourceResult
} from '$lib/apps/types';
import type { ServiceView } from '$lib/plugins/types';
import { SESSION_HEADER } from './messages';

/**
 * MCP apps in the browser: what the page asks Wheelhouse for an app it draws.
 * Every request is a POST with the session token, as every request that may
 * change something is; an app never sees the token.
 */

async function post<T>(op: string, body: object, token: string): Promise<T> {
	let res: Response;
	try {
		res = await fetch(`/api/apps/${op}`, {
			method: 'POST',
			headers: { 'content-type': 'application/json', [SESSION_HEADER]: token },
			body: JSON.stringify(body)
		});
	} catch {
		throw new Error('Could not reach the Wheelhouse server.');
	}
	const data = (await res.json().catch(() => null)) as (T & { message?: string }) | null;
	if (data && (res.ok || 'ok' in data || 'state' in data)) return data;
	throw new Error(data?.message ?? `Wheelhouse answered ${res.status}.`);
}

export const openApp = (ref: AppRef, token: string) => post<AppOpenView>('open', ref, token);

export const runApp = (ref: AppRef, token: string) =>
	post<AppCallView<CallToolResult>>('run', ref, token);

export const callAppTool = (
	ref: AppRef,
	call: { name: string; arguments: Record<string, unknown>; confirmed: boolean },
	token: string
) => post<AppCallView<CallToolResult>>('call', { ...ref, ...call }, token);

export const readAppResource = (ref: AppRef, uri: string, token: string) =>
	post<AppCallView<ReadResourceResult>>('read', { ...ref, uri }, token);

/** Which of these tool calls in the chat (by `tool_use` id) have an app to draw. */
export const chatApps = (calls: string[], token: string) =>
	post<ChatAppsView>('chat', { calls }, token);

/** Start a plugin's companion service (the captain's click), without opening a tab. */
export async function startService(
	r: { plugin: string; service: string; project: string | null },
	token: string
): Promise<ServiceView | null> {
	try {
		const res = await fetch('/api/services', {
			method: 'POST',
			headers: { 'content-type': 'application/json', [SESSION_HEADER]: token },
			body: JSON.stringify(r)
		});
		return (await res.json().catch(() => null)) as ServiceView | null;
	} catch {
		return null;
	}
}
