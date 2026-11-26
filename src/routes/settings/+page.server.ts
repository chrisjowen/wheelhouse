import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

// Settings opens on its first page, Fleet.
export const load: PageServerLoad = async () => redirect(307, '/settings/fleet');
