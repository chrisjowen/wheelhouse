import { taskDetail } from '$lib/server/detail';
import { loadSlots } from '$lib/server/runtime';
import { slotKey } from '$lib/plugins/keys';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params }) => {
	const [r, slots] = await Promise.all([
		taskDetail(params.id),
		loadSlots([slotKey.task(params.id)])
	]);
	return {
		id: params.id,
		detail: r.ok ? r.detail : null,
		problem: r.ok ? null : r.message,
		slots,
		slotsAt: Date.now()
	};
};
