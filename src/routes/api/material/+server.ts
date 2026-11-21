import { json } from '@sveltejs/kit';
import { NO_STORE, readJson } from '$lib/server/http';
import { changeMaterial, currentMaterial } from '$lib/server/runtime';
import { MATERIAL_GROUPS, type MaterialGroup } from '$lib/material';
import type { RequestHandler } from './$types';

/**
 * Settings → Agent material: GET the rows, POST `{ group, on }` to turn one on
 * or off. The page's own call: the agent token is not taken here (an agent uses
 * `wheelhouse skills`).
 */

export const GET: RequestHandler = async () => {
	const view = await currentMaterial();
	if (!view)
		return json({ message: 'Wheelhouse is not set up yet.' }, { status: 409, headers: NO_STORE });
	return json(view, { headers: NO_STORE });
};

export const POST: RequestHandler = async ({ request }) => {
	const read = await readJson(request, 1024);
	if (!read.ok) return read.response;
	const { group, on } = read.body;
	if (!MATERIAL_GROUPS.includes(group as MaterialGroup) || typeof on !== 'boolean') {
		return json(
			{ message: `Choose a group (${MATERIAL_GROUPS.join(', ')}) and set on to true or false.` },
			{ status: 400, headers: NO_STORE }
		);
	}
	const r = await changeMaterial(group as MaterialGroup, on);
	if (!r.ok) return json({ message: r.error }, { status: r.status, headers: NO_STORE });
	return json({ view: r.view, notes: r.notes }, { headers: NO_STORE });
};
