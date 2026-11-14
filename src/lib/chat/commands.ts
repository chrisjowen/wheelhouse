import type { SlashCommand } from '$lib/types';

/** The heading a slash command is listed under in the composer, by where it comes from. */
export function commandGroup(c: SlashCommand): string {
	switch (c.source) {
		case 'firstmate':
			return 'Firstmate';
		case 'personal':
			return 'Personal';
		case 'plugin':
			return c.plugin ? `Plugin ${c.plugin}` : 'Plugin';
		default:
			return 'Built-in';
	}
}
