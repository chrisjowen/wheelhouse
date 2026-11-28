import { SESSION_HEADER } from '$lib/client/messages';
import type { FleetView } from '$lib/fleet';

/**
 * The fleet this ship is in, asked again of this Wheelhouse (GET /api/fleet/membership),
 * for Settings → Fleet and Fleet → Overview; null when it could not be asked.
 */
export async function readFleet(): Promise<FleetView | null> {
	try {
		const r = await fetch('/api/fleet/membership');
		return r.ok ? ((await r.json()) as FleetView) : null;
	} catch {
		return null;
	}
}

/** What a membership action answered: the view after it, and its words. */
export interface FleetActed {
	ok: boolean;
	view: FleetView | null;
	/** Why it failed, when it did. */
	error: string;
	/** A word on what it did, when it did. */
	note: string;
}

/** Join, cancel, check, leave, or change the saved gateways (POST /api/fleet/membership). */
export async function fleetAction(
	sessionToken: string,
	action: string,
	extra: Record<string, unknown> = {}
): Promise<FleetActed> {
	try {
		const r = await fetch('/api/fleet/membership', {
			method: 'POST',
			headers: { 'content-type': 'application/json', [SESSION_HEADER]: sessionToken },
			body: JSON.stringify({ action, ...extra })
		});
		const body = (await r.json().catch(() => null)) as {
			message?: string;
			view?: FleetView;
			note?: string | null;
		} | null;
		const view = body?.view ?? null;
		if (!r.ok)
			return {
				ok: false,
				view,
				error: body?.message ?? `Wheelhouse could not do that (${r.status}).`,
				note: ''
			};
		return { ok: true, view, error: '', note: body?.note ?? '' };
	} catch {
		return {
			ok: false,
			view: null,
			error: 'Wheelhouse could not be reached. Try again.',
			note: ''
		};
	}
}
