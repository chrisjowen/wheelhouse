import { getRuntime } from '$lib/server/runtime';
import type { ChatArchiveStats } from '$lib/types';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
	const runtime = await getRuntime();
	const stats: ChatArchiveStats | null =
		runtime.configured && runtime.archive ? runtime.archive.stats() : null;
	return {
		stats,
		reason: !runtime.configured
			? runtime.error
			: stats
				? null
				: 'The Wheelhouse state directory is inside the Firstmate home, so the chat is not archived.'
	};
};
