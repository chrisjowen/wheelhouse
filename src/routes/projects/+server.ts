import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

// Projects and the Harbour are one page now: every project's card is on the Harbour.
export const GET: RequestHandler = () => redirect(307, '/harbour');
