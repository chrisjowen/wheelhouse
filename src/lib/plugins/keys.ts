/**
 * How pages name what they want plugin entries for. The key doubles as the
 * `/api/slots` query string, so the server load and the browser's refresh ask
 * for the same thing.
 */
export type SlotKey = string;

export const slotKey = {
	fleet: 'fleet' as SlotKey,
	project: (id: string): SlotKey => `project=${encodeURIComponent(id)}`,
	task: (id: string): SlotKey => `task=${encodeURIComponent(id)}`
};

export type SlotQuery =
	{ scope: 'fleet' } | { scope: 'project'; projectId: string } | { scope: 'task'; taskId: string };

export function parseSlotKey(key: SlotKey): SlotQuery {
	if (key.startsWith('project=')) {
		return { scope: 'project', projectId: decodeURIComponent(key.slice('project='.length)) };
	}
	if (key.startsWith('task=')) {
		return { scope: 'task', taskId: decodeURIComponent(key.slice('task='.length)) };
	}
	return { scope: 'fleet' };
}

export const slotsUrl = (key: SlotKey) =>
	key === slotKey.fleet ? '/api/slots' : `/api/slots?${key}`;

/** A project.tab entry's own page: `/projects/<project>/<plugin>/<contribution>`. */
export const projectTabHref = (
	projectId: string,
	e: { pluginId: string; contributionId: string }
) =>
	`/projects/${encodeURIComponent(projectId)}/${encodeURIComponent(e.pluginId)}/${encodeURIComponent(e.contributionId)}`;

/** A nav.page entry's own page, a top-level menu item: `/plugins/<plugin>/<contribution>`. */
export const navPageHref = (e: { pluginId: string; contributionId: string }) =>
	`/plugins/${encodeURIComponent(e.pluginId)}/${encodeURIComponent(e.contributionId)}`;
