import type { SessionSummary } from '$lib/types';

/**
 * The "New session" dialog, opened from the header or a project section, and
 * the outcome of the last launch, shown on the Sessions page.
 */
class NewSession {
	open = $state(false);
	/** The preselected project; null for a blank idea. */
	projectId = $state<string | null>(null);
	last = $state<{ session: SessionSummary; terminalError: string | null } | null>(null);

	show(projectId: string | null = null) {
		this.projectId = projectId;
		this.open = true;
	}
}

export const newSession = new NewSession();
