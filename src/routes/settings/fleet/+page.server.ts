import { fleetPage } from '$lib/server/cloud/page';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ request }) => fleetPage(request);
