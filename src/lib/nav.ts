/**
 * The main sections, in the left menu (and across the header on a narrow screen, where
 * there is no room for the menu): Firstmate, Harbour, Projects, Decisions and the
 * Logbook, then each plugin's own page (a nav.page entry). Each section's own pages sit
 * in a row at its top, so the menu lists only the sections.
 */

export type SectionKey = 'firstmate' | 'harbour' | 'projects' | 'decisions' | 'logbook';

export interface Section {
	href: string;
	label: string;
	/** A built-in section, else null for a plugin's page. */
	key: SectionKey | null;
	/** The page you are on belongs to it. */
	on: boolean;
}

/**
 * The Logbook's own row: the session and headroom pages, Headroom first, then
 * Plugins, which opens Settings → Plugins (behind the header's gear).
 */
export const LOGBOOK_ROW = [
	{ href: '/headroom', label: 'Headroom' },
	{ href: '/time', label: 'Where time went' },
	{ href: '/decisions', label: 'Decided for you' },
	{ href: '/settings/plugins', label: 'Plugins' }
];

/** The Logbook's pages: the session and headroom pages. */
const LOGBOOK = ['/headroom', '/time', '/decisions'];

export function mainSections(
	pathname: string,
	pluginPages: { href: string; label: string }[] = []
): Section[] {
	const under = (p: string) => pathname.startsWith(`${p}/`);
	const built: Section[] = [
		{ href: '/', label: 'Firstmate', key: 'firstmate', on: pathname === '/' },
		// A task's page is part of the Harbour; a project's own pages are part of Projects.
		{
			href: '/harbour',
			label: 'Harbour',
			key: 'harbour',
			on: pathname === '/harbour' || under('/tasks')
		},
		{
			href: '/projects',
			label: 'Projects',
			key: 'projects',
			on: pathname === '/projects' || under('/projects')
		},
		{ href: '/inbox', label: 'Decisions', key: 'decisions', on: pathname === '/inbox' },
		{ href: '/headroom', label: 'Logbook', key: 'logbook', on: LOGBOOK.includes(pathname) }
	];
	return [...built, ...pluginPages.map((p) => ({ ...p, key: null, on: pathname === p.href }))];
}

/** The Harbour board, scoped to one project when given: where a task's page goes back to. */
export function harbourHref(projectId?: string | null): string {
	return projectId ? `/harbour?project=${encodeURIComponent(projectId)}` : '/harbour';
}
