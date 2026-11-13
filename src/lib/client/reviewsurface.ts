import { page } from '$app/state';
import type { RoleProvider } from '$lib/plugins/types';

/**
 * The plugin that is the review surface now (lib/plugins/types.ts ROLES), as
 * the layout read it, or null while Wheelhouse's own built-in is: its preview
 * helper and review-board links. While a plugin is, pages leave those out and
 * draw the plugin's preview.action as the primary button on each preview.
 */
export const reviewSurface = (): RoleProvider | null =>
	(page.data.reviewSurface as RoleProvider | null | undefined) ?? null;
