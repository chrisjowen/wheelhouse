import type { SessionsView, SessionSummary } from '$lib/types';
import { SESSION_HEADER } from './messages';

/** Browser calls for the captain's sessions. Mutating calls carry the session token. */

type Failure = { ok: false; error: string };

async function errorOf(res: Response): Promise<string> {
	const body = await res.json().catch(() => null);
	return typeof body?.message === 'string' ? body.message : `Wheelhouse answered ${res.status}.`;
}

export async function launchSession(
	input: { projectId: string | null; prompt: string },
	sessionToken: string
): Promise<{ ok: true; session: SessionSummary; terminalError: string | null } | Failure> {
	try {
		const res = await fetch('/api/sessions', {
			method: 'POST',
			headers: { 'content-type': 'application/json', [SESSION_HEADER]: sessionToken },
			body: JSON.stringify(input)
		});
		if (!res.ok) return { ok: false, error: await errorOf(res) };
		const body = await res.json();
		return { ok: true, session: body.session, terminalError: body.terminalError ?? null };
	} catch {
		return { ok: false, error: 'Could not reach the Wheelhouse server.' };
	}
}

export async function openSession(
	id: string,
	sessionToken: string
): Promise<{ ok: true } | Failure> {
	try {
		const res = await fetch(`/api/sessions/${encodeURIComponent(id)}/open`, {
			method: 'POST',
			headers: { [SESSION_HEADER]: sessionToken }
		});
		return res.ok ? { ok: true } : { ok: false, error: await errorOf(res) };
	} catch {
		return { ok: false, error: 'Could not reach the Wheelhouse server.' };
	}
}

export async function fetchSessions(): Promise<SessionsView | null> {
	try {
		const res = await fetch('/api/sessions');
		return res.ok ? await res.json() : null;
	} catch {
		return null;
	}
}
