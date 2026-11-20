import { currentFleet } from '$lib/server/runtime';
import { voiceService } from '$lib/server/voice/service';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async () => ({
	voice: await voiceService().view(),
	projects: (await currentFleet().catch(() => null))?.projects.map((p) => p.id) ?? []
});
