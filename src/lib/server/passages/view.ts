import { getRuntime } from '../runtime';
import { PROJECT_ID } from './sources';
import type { ProjectPassage } from '../../types';

export type PassageViewResult =
	| { ok: true; view: ProjectPassage }
	| { ok: false; status: 400 | 404 | 409 | 500 | 503; message: string };

async function known(id: string) {
	const runtime = await getRuntime();
	if (!runtime.configured)
		return { ok: false as const, status: 503 as const, message: runtime.error };
	if (!PROJECT_ID.test(id))
		return { ok: false as const, status: 400 as const, message: 'Not a project id.' };
	if (!runtime.collector.getFleet().projects.some((p) => p.id === id)) {
		return {
			ok: false as const,
			status: 404 as const,
			message: `There is no project called ${id}.`
		};
	}
	return { ok: true as const, passages: runtime.passages };
}

/** A project's passage panel (passage files, steps, checks, consent). */
export async function projectPassage(id: string): Promise<PassageViewResult> {
	const k = await known(id);
	if (!k.ok) return k;
	return { ok: true, view: await k.passages.view(id) };
}

/** Enable a project file's network checks for the version with this digest, or turn them off. */
export async function setPassageConsent(
	id: string,
	digest: string | null
): Promise<PassageViewResult> {
	const k = await known(id);
	if (!k.ok) return k;
	await k.passages.view(id);
	let r;
	try {
		r = await k.passages.setConsent(id, digest);
	} catch (e) {
		return {
			ok: false,
			status: 500,
			message: `Wheelhouse could not save your consent: ${(e as Error).message}`
		};
	}
	if (!r.ok) return r;
	return { ok: true, view: await k.passages.view(id) };
}
