import type { DecisionFilter } from '$lib/decisionhome';
import type { DecisionForm } from '$lib/decisionform';

/**
 * What slides out over the page, on any page: a task (TaskSlideout), or the
 * Decisions slide-out, filtered to a task or project and maybe opened on one
 * card (DecisionSlideout). One at a time: opening one from the other replaces
 * it and remembers it, so the new one offers the way back. The host in the
 * layout draws them (SlideoutHost), and turns a click on a link to a task's page
 * or to one decision into opening its slide-out.
 */
export type Panel =
	| { kind: 'task'; id: string; tab: string | null }
	| { kind: 'decisions'; filter: DecisionFilter; cardId: string | null; label: string | null };

class Slideout {
	panel = $state<Panel | null>(null);
	/** The panel this one replaced, for Back. */
	back = $state<Panel | null>(null);
	/**
	 * The form Firstmate asked a decision with in the chat, by card id, where it
	 * replaced the one read from the question (ChatDecision keeps it here while it
	 * is drawn): the slide-out answers with it, as the chat did.
	 */
	forms = $state<Record<string, { form: DecisionForm; key: string; refined: boolean }>>({});

	get taskId(): string | null {
		return this.panel?.kind === 'task' ? this.panel.id : null;
	}

	openTask(id: string, tab: string | null = null) {
		this.go({ kind: 'task', id, tab });
	}

	/** The Decisions slide-out: the filter's list, or one card in it. */
	openDecisions(
		filter: DecisionFilter = {},
		cardId: string | null = null,
		label: string | null = null
	) {
		this.go({ kind: 'decisions', filter, cardId, label });
	}

	/** Show another card in the open Decisions slide-out (null: its list). */
	pick(cardId: string | null) {
		if (this.panel?.kind === 'decisions') this.panel = { ...this.panel, cardId };
	}

	goBack() {
		this.panel = this.back;
		this.back = null;
	}

	/** Close `kind` if it is still the one out (a dialog closing as another replaces it leaves that one). */
	close(kind?: Panel['kind']) {
		if (kind && this.panel?.kind !== kind) return;
		this.panel = null;
		this.back = null;
	}

	private go(p: Panel) {
		const cur = this.panel;
		this.back = cur && cur.kind !== p.kind ? cur : this.back;
		this.panel = p;
	}
}

export const slideout = new Slideout();
