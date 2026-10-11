import { currentMessages } from '$lib/server/runtime';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async () => ({ messages: await currentMessages() });
