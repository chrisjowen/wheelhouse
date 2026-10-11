/**
 * What the docket plugin sends to the page: a docket's graph, trimmed to what
 * the Chart draws, and where the fleet's tasks sit on it. Plain JSON, shared
 * by the server and the browser.
 */

/** How sure the docket is of a link, in chart terms. */
export type Mark = 'charted' | 'approximate' | 'doubtful' | 'unsurveyed';

/** One observation of an exhibit or a link. */
export interface Evidence {
	source: string;
	path: string | null;
	lines: string | null;
	key: string | null;
	symbol: string | null;
	url: string | null;
	observedAt: string | null;
	observedBy: string | null;
	note: string | null;
}

export interface Exhibit {
	id: string;
	type: string;
	title: string;
	/** The team whose waters these are (the target of its `owned_by` link), if any. */
	owner: string | null;
	attributes: { key: string; value: string }[];
	tags: string[];
	/** The first paragraph of its write-up, shortened. */
	summary: string | null;
	confidence: number | null;
	basis: string | null;
	/** The newest date any of its own or its links' evidence was observed (YYYY-MM-DD). */
	surveyed: string | null;
	evidence: Evidence[];
	/** The docket file that declares it, relative to the docket's root. */
	path: string | null;
}

export interface Link {
	source: string;
	rel: string;
	target: string;
	confidence: number | null;
	basis: string | null;
	mark: Mark;
	/** No exhibit has the target's id. */
	dangling: boolean;
	evidence: Evidence[];
}

export interface DocketGraph {
	project: { name: string; root: string };
	exhibits: Exhibit[];
	links: Link[];
	types: { name: string; icon: string | null; description: string | null }[];
	diagnostics: { errors: number; warnings: number; messages: string[] };
	index: { synced: boolean; behind: number } | null;
	/** The newest evidence date in the whole docket. */
	surveyed: string | null;
	/** Exhibits and links the reader left out to stay within its size limit. */
	trimmed: { exhibits: number; links: number };
}

/** A task under way whose changed files the docket's evidence names. */
export interface Vessel {
	taskId: string;
	title: string;
	/** The passage step it is on, in plain words. */
	step: string;
	status: string;
	/** Exhibits its changed files touch. */
	touched: string[];
	/** Restricted waters (constraints) that apply to an exhibit it touches. */
	hazards: string[];
}

/** The project's Chart. */
export interface ChartData {
	state: 'chart';
	graph: DocketGraph;
	vessels: Vessel[];
	/** Tasks under way that touch nothing on the chart, or whose files Wheelhouse cannot read. */
	unplaced: number;
	/** Where the docket was read from, when the captain pointed the plugin somewhere else. */
	configuredRoot: string | null;
	/** How to browse the same docket in docket's own UI. */
	openCommand: string;
}

/** Shown in place of the Chart when the project keeps no docket. */
export interface NoDocket {
	state: 'no-docket';
}

/** One link found while joining a task to the chart. */
export interface JoinLink {
	source: string;
	rel: string;
	target: string;
	mark: Mark;
}

/** Where a set of changed files sits on the chart. */
export interface Join {
	/** Exhibits the files touch, with the files that matched their evidence. */
	touched: { id: string; files: string[] }[];
	/** Links whose evidence the files touch. */
	touchedLinks: (JoinLink & { files: string[] })[];
	/** One step out from what is touched, along depends_on, uses and deployed_to. */
	nearby: JoinLink[];
	/** Constraints (and anything else that is not a decision) applying to what is touched or nearby. */
	restricted: { id: string; appliesTo: string[]; direct: boolean }[];
	/** Decisions applying to what is touched or nearby. */
	notices: { id: string; appliesTo: string[]; superseded: boolean }[];
	/** Exhibits that depend on or use what is touched. */
	dependents: JoinLink[];
	/** How many files were checked, and how many evidence records carry a path. */
	coverage: { files: number; matched: number; evidencePaths: number };
}

/** The task page's "Waters this passage crosses". */
export type WatersData =
	| {
			state: 'waters';
			join: Join;
			/** Titles and types of every exhibit the join names. */
			exhibits: Record<string, { title: string; type: string }>;
			chartHref: string;
	  }
	| { state: 'unreadable'; reason: string };

/** The Harbour's "Hazards ahead": tasks under way in restricted waters. */
export interface HazardsData {
	hazards: {
		taskId: string;
		title: string;
		step: string;
		/** Touched exhibits that a restriction applies to. */
		exhibits: { id: string; title: string }[];
		restrictions: { id: string; title: string }[];
	}[];
	chartHref: string;
}
