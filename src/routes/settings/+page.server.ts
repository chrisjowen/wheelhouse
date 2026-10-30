import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

// Settings opens on its first page.
export const load: PageServerLoad = () => redirect(307, '/settings/gateway');
