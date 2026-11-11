import { updateService } from '$lib/server/upgrade/service';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async () => ({ view: await updateService().wheelhouse() });
