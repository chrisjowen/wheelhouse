import { setupService } from '$lib/server/setup/service';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async () => ({ setup: await setupService().view() });
