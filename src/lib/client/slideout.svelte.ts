/**
 * The task slid out over the page, on any page (TaskSlideout, drawn once by
 * SlideoutHost, which turns a click on a link to a task's page into opening
 * it). `tab` is the tab a link named.
 */
export type Panel = { kind: 'task'; id: string; tab: string | null };

class Slideout {
	panel = $state<Panel | null>(null);

	get taskId(): string | null {
		return this.panel?.id ?? null;
	}

	openTask(id: string, tab: string | null = null) {
		this.panel = { kind: 'task', id, tab };
	}

	close() {
		this.panel = null;
	}
}

export const slideout = new Slideout();
