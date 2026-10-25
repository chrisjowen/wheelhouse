import { currentHeadroom } from '$lib/server/runtime';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async () => ({ view: await currentHeadroom() });
