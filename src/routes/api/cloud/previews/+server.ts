import { json } from '@sveltejs/kit';
import { NO_STORE } from '$lib/server/http';
import { currentPreviewPorts } from '$lib/server/runtime';
import type { RequestHandler } from './$types';

/** The loopback ports Wheelhouse reports as previews, which Wheelhouse Cloud's connector may relay to. */
export const GET: RequestHandler = async () =>
	json({ ports: await currentPreviewPorts() }, { headers: NO_STORE });
