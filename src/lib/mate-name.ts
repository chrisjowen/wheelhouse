export const MATE_NAME_PATTERN = /^[a-z0-9][a-z0-9-]{0,39}$/;

export function mateNameSlug(value: string): string {
	return value
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, 40);
}
