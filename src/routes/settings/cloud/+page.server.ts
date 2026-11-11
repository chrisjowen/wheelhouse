import { remotesPage } from '$lib/server/cloud/page';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ request }) => remotesPage(request);
