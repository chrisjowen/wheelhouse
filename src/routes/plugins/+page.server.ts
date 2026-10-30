import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

// The Plugins page moved under Settings.
export const load: PageServerLoad = () => redirect(307, '/settings/plugins');
