import type { ServerInit } from '@sveltejs/kit';
import { getRuntime } from '$lib/server/runtime';

// Start the shared collector as soon as the server boots, not on the first request.
export const init: ServerInit = async () => {
	await getRuntime();
};
