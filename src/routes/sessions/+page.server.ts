import { currentSessions } from '$lib/server/runtime';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async () => ({ sessions: await currentSessions() });
