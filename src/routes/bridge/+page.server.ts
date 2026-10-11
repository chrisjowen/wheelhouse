import { currentMessages, loadSlots } from '$lib/server/runtime';
import { slotKey } from '$lib/plugins/keys';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
	const [messages, slots] = await Promise.all([currentMessages(), loadSlots([slotKey.fleet])]);
	return { messages, slots, slotsAt: Date.now() };
};
