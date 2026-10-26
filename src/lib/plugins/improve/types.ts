/**
 * What the Improve plugin hands its panels: improve's view of the Firstmate
 * harness, already in plain words. Plain JSON, shared by the provider and the
 * browser.
 */

/** Who a proposal's files belong to, as improve classifies them. */
export type Visibility = 'captain-private' | 'shared-tracked' | 'mixed' | null;

/** A proposal routed as a captain-held Firstmate task, and where that task stands. */
export interface ProposalDecision {
	taskId: string;
	/** The task's page, when Wheelhouse has the task. */
	href: string | null;
	/** Plain words: "Waiting for your call", "Answered", ... */
	state: string;
	routedAt: string | null;
	/** The proposal was edited after it was filed. */
	changedSinceFiling: boolean;
}

export interface ProposalItem {
	/** The file under `.harness/proposals/`. */
	file: string;
	id: string;
	title: string;
	status: string;
	statusLabel: string;
	/** The status as a chip: "Your call", "Draft", "Approved"... */
	statusShort: string;
	group: StatusGroup;
	kind: Kind;
	kindLabel: string;
	/** The first sentence of what it changes, for the card. */
	summary: string | null;
	/** Proposed: waiting for the captain's call. */
	waiting: boolean;
	layer: string | null;
	/** What it changes, in the proposal's own words. */
	changes: string | null;
	/** Why: the proposal's hypothesis, else its objective. */
	why: string | null;
	files: string[];
	/** The Firstmate surfaces it changes, in plain words. */
	surfaces: string[];
	visibility: Visibility;
	visibilityLabel: string;
	/** The visibility as a chip: "Private", "Shared"... */
	visibilityShort: string;
	/** What happens once it is approved. */
	deliveryLabel: string;
	evidence: { source: string; observation: string }[];
	confidence: string | null;
	createdAt: string | null;
	decision: ProposalDecision | null;
	/** How routing would treat it next, when that says something the status does not. */
	routing: string | null;
	/** The proposal in improve's own UI, when that UI is running. */
	openUrl: string | null;
}

export interface Pattern {
	sentence: string;
	/** The repeated question itself, for a chip. */
	example: string;
	kind: 'review' | 'decision';
	count: number;
	tasks: number;
	answers: string[];
}

export interface ImproveUi {
	/** Where improve's UI is expected (127.0.0.1 by default). */
	url: string;
	running: boolean;
	/** Whether it opens a proposal by its file (`/proposals?p=<file>`). */
	deepLinks: boolean;
	/** How to start it, bound to 127.0.0.1, when it is not running and Wheelhouse knows where it is. */
	start: string | null;
}

export interface HarnessView {
	schema: 'wheelhouse-improve.v1';
	review: {
		/** null when periodic review is off or has not started counting. */
		due: boolean | null;
		/** One sentence: due or not, and why. */
		headline: string;
		reasons: string[];
		lastReviewedAt: string | null;
		/** When the next periodic review comes, or that periodic review is off. */
		periodic: string;
	};
	/** Proposals waiting for the captain's call. */
	waiting: number;
	proposals: ProposalItem[];
	evidence: {
		importedAt: string | null;
		/** One sentence of counts, or null when the import could not be read. */
		summary: string | null;
		counts: { label: string; value: number }[];
		/** What improve read, by kind, for a bar: only the kinds it found any of. */
		mix: { key: string; label: string; value: number }[];
		patterns: Pattern[];
	};
	/** Short sentences about the harness's size (AGENTS.md, skills). */
	inventory: string[];
	/** The harness's size, for a meter. */
	size: {
		contractFile: string;
		contractTokens: number;
		/** Share of the startup memory budget, 0-1, when the home sets one. */
		budgetShare: number | null;
		skills: number | null;
		largestSkill: string | null;
	} | null;
	/** What could not be read, in plain words. */
	problems: string[];
	ui: ImproveUi;
}

/** What kind of harness change a proposal is, from the surfaces it changes. */
export type Kind =
	'instructions' | 'skill' | 'script' | 'preference' | 'memory' | 'settings' | 'docs' | 'other';

/** Where a proposal stands, grouped for the page. */
export type StatusGroup = 'waiting' | 'drafting' | 'approved' | 'done' | 'declined';

/** A routed proposal, for its Firstmate task's page. */
export interface ProposalSection {
	schema: 'wheelhouse-improve-proposal.v1';
	proposal: ProposalItem;
	/** The Improvements page, at this proposal. */
	improvementsHref: string;
	ui: ImproveUi;
}
