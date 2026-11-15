import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

/** The retired Discord integration no longer has a Settings page. */
export const load: PageServerLoad = () => redirect(307, '/settings');
