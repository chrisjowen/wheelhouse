import { quotaKeys } from '$lib/server/insights/quota-keys';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async () => ({ keys: await quotaKeys().view() });
