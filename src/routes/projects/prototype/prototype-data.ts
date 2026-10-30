/**
 * PROTOTYPE (throwaway): made-up projects, work and git history for the Projects + Harbour
 * redesign directions at /projects/prototype. Nothing here is read from Firstmate; the
 * winning direction gets rebuilt properly on the real fleet data.
 */

export const STAGES = ['Queued', 'Building', 'Checks', 'Pull request', 'Your review', 'Landed'];

export type TaskState =
	| 'working'
	| 'needs-review'
	| 'needs-decision'
	| 'with-firstmate'
	| 'with-reviewers'
	| 'blocked'
	| 'failed'
	| 'lost'
	| 'queued'
	| 'landed';

export interface FakeTask {
	id: string;
	title: string;
	state: TaskState;
	/** Index into STAGES. */
	stage: number;
	/** What it is doing now, or what it needs, in plain words. */
	now: string;
	/** Minutes ago it started waiting (Your move, held up) or landed. */
	since: number;
}

export type Health = 'needs-you' | 'held-up' | 'under-way' | 'quiet' | 'new';

export interface LogEntry {
	/** Minutes ago. */
	at: number;
	kind: 'landed' | 'started' | 'needs-you' | 'held-up' | 'pr' | 'note';
	text: string;
}

export interface FakeProject {
	id: string;
	name: string;
	description: string;
	/** How changes ship, in plain words (from the registry's delivery posture). */
	ships: string;
	repo: string | null;
	/** Plugin tabs this project shows, after Work. */
	tabs: string[];
	/** Landings per day for the last 14 days, oldest first. */
	pulse: number[];
	/** Commits per day for the last 14 days, oldest first. */
	commits: number[];
	/** Main branch checks. */
	main: 'green' | 'red' | 'none';
	openPRs: number;
	passageProblem: string | null;
	/** Minutes since anything happened. */
	lastActivity: number;
	tasks: FakeTask[];
	log: LogEntry[];
}

const H = 60;
const D = 24 * H;

export const PROJECTS: FakeProject[] = [
	{
		id: 'wheelhouse',
		name: 'wheelhouse',
		description: 'The web app for talking to Firstmate and watching its crew work.',
		ships: 'Every change runs the full checks before its pull request. You merge each one.',
		repo: 'https://github.com/chrisjowen/wheelhouse',
		tabs: ['Git insights', 'Issues', 'Secrets'],
		pulse: [2, 3, 1, 4, 5, 2, 0, 3, 6, 4, 5, 7, 6, 4],
		commits: [5, 8, 3, 9, 11, 4, 1, 7, 14, 9, 12, 16, 13, 9],
		main: 'green',
		openPRs: 2,
		passageProblem: null,
		lastActivity: 2,
		tasks: [
			{
				id: 'w1',
				title: 'Projects and Harbour redesign',
				state: 'needs-decision',
				stage: 1,
				now: 'Three design directions are ready. Pick one to build.',
				since: 6
			},
			{
				id: 'w2',
				title: 'Plugin settings validation',
				state: 'working',
				stage: 1,
				now: 'Writing the settings form tests',
				since: 35
			},
			{
				id: 'w3',
				title: 'Upgrade menu in the header',
				state: 'needs-review',
				stage: 4,
				now: 'Checks are green and the pull request is ready for your review',
				since: 50
			},
			{
				id: 'w4',
				title: 'Home rail smoke test',
				state: 'queued',
				stage: 0,
				now: 'Starts when a worker is free',
				since: 90
			},
			{
				id: 'w5',
				title: 'Turn plugins on or off from Settings',
				state: 'landed',
				stage: 5,
				now: 'Merged',
				since: 3 * H
			},
			{
				id: 'w6',
				title: 'Add and grant secrets on the Vault page',
				state: 'landed',
				stage: 5,
				now: 'Merged',
				since: 4 * H
			},
			{
				id: 'w7',
				title: 'Reach Firstmate from Discord',
				state: 'landed',
				stage: 5,
				now: 'Merged',
				since: 6 * H
			},
			{
				id: 'w8',
				title: 'Plugin apps inline in the chat',
				state: 'landed',
				stage: 5,
				now: 'Merged',
				since: 15 * H
			}
		],
		log: [
			{ at: 2, kind: 'note', text: 'Plugin settings validation wrote 12 new tests' },
			{ at: 6, kind: 'needs-you', text: 'Projects and Harbour redesign is waiting for your pick' },
			{ at: 35, kind: 'started', text: 'Started Plugin settings validation' },
			{ at: 50, kind: 'needs-you', text: 'Upgrade menu in the header is ready for your review' },
			{ at: 3 * H, kind: 'landed', text: 'Turn plugins on or off from Settings landed' },
			{ at: 4 * H, kind: 'landed', text: 'Add and grant secrets on the Vault page landed' },
			{ at: 6 * H, kind: 'landed', text: 'Reach Firstmate from Discord landed' },
			{ at: 15 * H, kind: 'landed', text: 'Plugin apps inline in the chat landed' },
			{ at: 26 * H, kind: 'pr', text: 'Opened a pull request for the upgrade menu' }
		]
	},
	{
		id: 'git-insights-wheelhouse',
		name: 'git-insights-wheelhouse',
		description:
			'A Wheelhouse plugin: who works on a project, latest commits, code hotspots and open pull requests, refreshed hourly.',
		ships: 'Changes go straight to a pull request. You merge each one.',
		repo: 'https://github.com/chrisjowen/git-insights-wheelhouse',
		tabs: ['Git insights'],
		pulse: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
		commits: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 3],
		main: 'none',
		openPRs: 0,
		passageProblem: null,
		lastActivity: 4,
		tasks: [
			{
				id: 'g1',
				title: 'Build the Git insights plugin',
				state: 'working',
				stage: 1,
				now: 'Reading commit history to find code hotspots',
				since: 40
			}
		],
		log: [
			{ at: 4, kind: 'note', text: 'First commit pushed to the new repository' },
			{ at: 40, kind: 'started', text: 'Started Build the Git insights plugin' },
			{ at: 55, kind: 'note', text: 'Added to Firstmate’s projects' }
		]
	},
	{
		id: 'docket',
		name: 'docket',
		description: 'Project knowledge (decisions, constraints, owners) kept beside the code.',
		ships:
			'Every change runs the full checks before its pull request. Firstmate merges once green.',
		repo: 'https://github.com/chrisjowen/docket',
		tabs: ['Chart', 'Git insights'],
		pulse: [1, 0, 2, 1, 0, 0, 0, 1, 2, 0, 1, 0, 1, 0],
		commits: [3, 1, 4, 2, 0, 0, 0, 3, 5, 1, 2, 1, 3, 1],
		main: 'green',
		openPRs: 1,
		passageProblem: null,
		lastActivity: 50,
		tasks: [
			{
				id: 'd1',
				title: 'Which owner wins when two files disagree',
				state: 'needs-decision',
				stage: 1,
				now: 'Keep the newest owner, or flag the conflict for you?',
				since: 20 * H
			},
			{
				id: 'd2',
				title: 'Faster search across a large docket',
				state: 'working',
				stage: 3,
				now: 'Pull request checks running',
				since: 50
			},
			{
				id: 'd3',
				title: 'Owners shown on the docket chart',
				state: 'landed',
				stage: 5,
				now: 'Merged',
				since: 2 * D
			}
		],
		log: [
			{ at: 50, kind: 'pr', text: 'Opened a pull request for faster search' },
			{
				at: 20 * H,
				kind: 'needs-you',
				text: 'Which owner wins when two files disagree is waiting for your answer'
			},
			{ at: 2 * D, kind: 'landed', text: 'Owners shown on the docket chart landed' }
		]
	},
	{
		id: 'casebook',
		name: 'casebook',
		description: 'Records agent runs as cases you can replay and compare.',
		ships: 'Every change runs the full checks before its pull request. You merge each one.',
		repo: 'https://github.com/chrisjowen/casebook',
		tabs: ['Git insights', 'Issues'],
		pulse: [0, 1, 1, 0, 2, 1, 0, 0, 1, 2, 1, 0, 1, 1],
		commits: [2, 4, 3, 1, 6, 3, 0, 1, 4, 6, 3, 2, 4, 3],
		main: 'green',
		openPRs: 2,
		passageProblem: null,
		lastActivity: 18,
		tasks: [
			{
				id: 'c1',
				title: 'Export a case as a PDF',
				state: 'working',
				stage: 3,
				now: 'Pull request checks running, 6 of 8 passed',
				since: 18
			},
			{
				id: 'c2',
				title: 'Replay two runs side by side',
				state: 'with-reviewers',
				stage: 4,
				now: 'Green and waiting on other reviewers',
				since: 5 * H
			},
			{
				id: 'c3',
				title: 'Search cases by tool name',
				state: 'landed',
				stage: 5,
				now: 'Merged',
				since: 22 * H
			},
			{
				id: 'c4',
				title: 'Tag a case from the run page',
				state: 'landed',
				stage: 5,
				now: 'Merged',
				since: 3 * D
			}
		],
		log: [
			{ at: 18, kind: 'note', text: 'Export a case as a PDF passed 6 of 8 pull request checks' },
			{ at: 5 * H, kind: 'pr', text: 'Replay two runs side by side is waiting on other reviewers' },
			{ at: 22 * H, kind: 'landed', text: 'Search cases by tool name landed' },
			{ at: 3 * D, kind: 'landed', text: 'Tag a case from the run page landed' }
		]
	},
	{
		id: 'ship-weather-wheelhouse',
		name: 'ship-weather-wheelhouse',
		description: 'A Wheelhouse plugin: flaky checks and slow builds across the fleet.',
		ships: 'Changes go straight to a pull request. You merge each one.',
		repo: 'https://github.com/chrisjowen/ship-weather-wheelhouse',
		tabs: ['Git insights'],
		pulse: [0, 0, 1, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0],
		commits: [0, 2, 3, 0, 1, 2, 0, 0, 1, 2, 0, 1, 2, 1],
		main: 'red',
		openPRs: 1,
		passageProblem: null,
		lastActivity: 40,
		tasks: [
			{
				id: 's1',
				title: 'Flaky check detector',
				state: 'lost',
				stage: 1,
				now: 'Lost contact with the worker 40 min ago. Firstmate is checking on it.',
				since: 40
			},
			{
				id: 's2',
				title: 'Weekly weather report card',
				state: 'queued',
				stage: 0,
				now: 'Starts when a worker is free',
				since: 3 * H
			}
		],
		log: [
			{ at: 40, kind: 'held-up', text: 'Lost contact with the worker on Flaky check detector' },
			{ at: 9 * H, kind: 'held-up', text: 'Checks on the main branch started failing' },
			{ at: 4 * D, kind: 'landed', text: 'Slowest builds list landed' }
		]
	},
	{
		id: 'improve',
		name: 'improve',
		description: 'Reviews how Firstmate works and proposes changes to its harness.',
		ships: 'Product changes run the full checks; internal tooling goes straight to a pull request.',
		repo: 'https://github.com/chrisjowen/improve',
		tabs: ['Git insights'],
		pulse: [1, 0, 0, 1, 0, 0, 0, 2, 0, 0, 1, 0, 0, 0],
		commits: [2, 1, 0, 3, 1, 0, 0, 4, 1, 0, 2, 1, 1, 0],
		main: 'green',
		openPRs: 0,
		passageProblem: 'Its passage file names a check workflow that does not exist.',
		lastActivity: 2 * H,
		tasks: [
			{
				id: 'i1',
				title: 'Weekly harness review',
				state: 'failed',
				stage: 2,
				now: 'The type check failed twice. Firstmate is retrying with a fix.',
				since: 2 * H
			}
		],
		log: [
			{ at: 2 * H, kind: 'held-up', text: 'Weekly harness review failed its type check twice' },
			{ at: 3 * D, kind: 'landed', text: 'Proposals grouped by area landed' }
		]
	},
	{
		id: 'stuck',
		name: 'stuck',
		description: 'Spots agent sessions that have stopped making progress and nudges them.',
		ships: 'Kept on this machine: changes land locally. You approve each landing.',
		repo: null,
		tabs: [],
		pulse: [0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
		commits: [1, 2, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0],
		main: 'none',
		openPRs: 0,
		passageProblem: null,
		lastActivity: 26 * H,
		tasks: [
			{
				id: 'k1',
				title: 'Nudge stuck sessions over Discord',
				state: 'blocked',
				stage: 1,
				now: 'Needs a Discord bot token in the vault before it can go on.',
				since: 26 * H
			}
		],
		log: [
			{
				at: 26 * H,
				kind: 'held-up',
				text: 'Nudge stuck sessions over Discord is blocked on a token'
			},
			{ at: 12 * D, kind: 'landed', text: 'Idle-session threshold setting landed' }
		]
	},
	{
		id: 'captains-log-wheelhouse',
		name: 'captains-log-wheelhouse',
		description: 'A Wheelhouse plugin: a daily captain’s log of what the crew did.',
		ships: 'Changes go straight to a pull request. Firstmate merges once green.',
		repo: 'https://github.com/chrisjowen/captains-log-wheelhouse',
		tabs: ['Git insights'],
		pulse: [0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 1, 0, 0],
		commits: [0, 1, 0, 3, 1, 0, 0, 1, 3, 1, 0, 2, 1, 1],
		main: 'green',
		openPRs: 1,
		passageProblem: null,
		lastActivity: 70,
		tasks: [
			{
				id: 'l1',
				title: 'Daily summary page',
				state: 'with-firstmate',
				stage: 1,
				now: 'The worker asked how far back a day reaches. Firstmate is answering.',
				since: 70
			},
			{
				id: 'l2',
				title: 'Weekly digest message',
				state: 'queued',
				stage: 0,
				now: 'Starts after the daily summary page',
				since: 70
			},
			{
				id: 'l3',
				title: 'Log entries grouped by project',
				state: 'landed',
				stage: 5,
				now: 'Merged',
				since: 2 * D
			}
		],
		log: [
			{ at: 70, kind: 'note', text: 'Daily summary page asked Firstmate a question' },
			{ at: 2 * D, kind: 'landed', text: 'Log entries grouped by project landed' }
		]
	},
	{
		id: 'giffy-wheelhouse',
		name: 'giffy-wheelhouse',
		description: 'A Wheelhouse plugin: turns a task’s preview screenshots into a short GIF.',
		ships: 'Changes go straight to a pull request. You merge each one.',
		repo: 'https://github.com/chrisjowen/giffy-wheelhouse',
		tabs: ['Git insights'],
		pulse: [1, 2, 0, 1, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0],
		commits: [3, 4, 1, 2, 0, 0, 0, 2, 3, 0, 0, 0, 0, 0],
		main: 'green',
		openPRs: 0,
		passageProblem: null,
		lastActivity: 5 * D,
		tasks: [
			{
				id: 'f1',
				title: 'GIF from the preview’s screenshots',
				state: 'landed',
				stage: 5,
				now: 'Merged',
				since: 5 * D
			}
		],
		log: [{ at: 5 * D, kind: 'landed', text: 'GIF from the preview’s screenshots landed' }]
	},
	{
		id: 'lumen',
		name: 'lumen',
		description: 'Photo sharing for friends and family.',
		ships: 'Changes go straight to a pull request. You merge each one.',
		repo: 'https://github.com/chrisjowen/lumen',
		tabs: ['Git insights', 'Issues'],
		pulse: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
		commits: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
		main: 'green',
		openPRs: 0,
		passageProblem: null,
		lastActivity: 23 * D,
		tasks: [
			{
				id: 'm1',
				title: 'Shareable album links',
				state: 'landed',
				stage: 5,
				now: 'Merged',
				since: 23 * D
			}
		],
		log: [{ at: 23 * D, kind: 'landed', text: 'Shareable album links landed' }]
	},
	{
		id: 'tidewater',
		name: 'tidewater',
		description: 'Tide tables and harbour times as a small API.',
		ships: 'Every change runs the full checks before its pull request. You merge each one.',
		repo: 'https://github.com/chrisjowen/tidewater',
		tabs: ['Git insights'],
		pulse: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
		commits: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
		main: 'none',
		openPRs: 0,
		passageProblem: null,
		lastActivity: 2 * D,
		tasks: [],
		log: [{ at: 2 * D, kind: 'note', text: 'Added to Firstmate’s projects' }]
	},
	{
		id: 'unassigned',
		name: 'Odd jobs',
		description: 'Work Firstmate did that is not part of a project.',
		ships: 'Each job says how it ships.',
		repo: null,
		tabs: [],
		pulse: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0],
		commits: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
		main: 'none',
		openPRs: 0,
		passageProblem: null,
		lastActivity: 28 * H,
		tasks: [
			{
				id: 'u1',
				title: 'Tidy the shell history script',
				state: 'landed',
				stage: 5,
				now: 'Landed',
				since: 28 * H
			}
		],
		log: [{ at: 28 * H, kind: 'landed', text: 'Tidy the shell history script landed' }]
	}
];

// ---------------------------------------------------------------- derived, in plain words

export const yourMove = (p: FakeProject) =>
	p.tasks.filter((t) => t.state === 'needs-review' || t.state === 'needs-decision');
export const heldUp = (p: FakeProject) =>
	p.tasks.filter((t) => t.state === 'blocked' || t.state === 'failed' || t.state === 'lost');
export const underWay = (p: FakeProject) =>
	p.tasks.filter((t) => t.state !== 'landed' && t.state !== 'queued');
export const moving = (p: FakeProject) =>
	p.tasks.filter((t) => ['working', 'with-firstmate', 'with-reviewers'].includes(t.state));
export const queued = (p: FakeProject) => p.tasks.filter((t) => t.state === 'queued');
export const landedThisWeek = (p: FakeProject) =>
	p.tasks.filter((t) => t.state === 'landed' && t.since < 7 * D);
export const lastLanded = (p: FakeProject) =>
	p.tasks.filter((t) => t.state === 'landed').sort((a, b) => a.since - b.since)[0] ?? null;
export const isNew = (p: FakeProject) => p.id === 'git-insights-wheelhouse' || p.id === 'tidewater';

export function health(p: FakeProject): Health {
	if (yourMove(p).length) return 'needs-you';
	if (heldUp(p).length || p.main === 'red' || p.passageProblem) return 'held-up';
	if (p.tasks.some((t) => t.state !== 'landed')) return isNew(p) ? 'new' : 'under-way';
	return 'quiet';
}

export const HEALTH_WORDS: Record<Health, string> = {
	'needs-you': 'Needs you',
	'held-up': 'Held up',
	'under-way': 'Under way',
	quiet: 'Quiet',
	new: 'New'
};

/** One sentence: the most important thing about the project right now. */
export function headlineOf(p: FakeProject): string {
	const move = yourMove(p)[0];
	if (move)
		return move.state === 'needs-review'
			? `${move.title} is ready for your review.`
			: `${move.title}: ${move.now}`;
	const held = heldUp(p)[0];
	if (held) return `${held.title}: ${held.now}`;
	if (p.main === 'red') return 'Checks on the main branch are failing.';
	if (p.passageProblem) return p.passageProblem;
	const m = moving(p);
	if (m.length)
		return `${m[0].title}: ${m[0].now.charAt(0).toLowerCase()}${m[0].now.slice(1).replace(/\.$/, '')}.`;
	const last = lastLanded(p);
	if (last) return `Nothing under way. ${last.title} landed ${ago(last.since)}.`;
	return 'No work yet.';
}

export const ORDER: Health[] = ['needs-you', 'held-up', 'new', 'under-way', 'quiet'];
export const byAttention = (list: FakeProject[]) =>
	[...list].sort(
		(a, b) => ORDER.indexOf(health(a)) - ORDER.indexOf(health(b)) || a.lastActivity - b.lastActivity
	);

export function ago(min: number): string {
	if (min < 1) return 'just now';
	if (min < 60) return `${Math.round(min)} min ago`;
	const h = Math.round(min / 60);
	if (h < 24) return `${h} h ago`;
	const d = Math.round(h / 24);
	if (d === 1) return 'yesterday';
	if (d < 14) return `${d} days ago`;
	return `${Math.round(d / 7)} weeks ago`;
}

export function waited(min: number): string {
	if (min < 60) return `${Math.round(min)} min`;
	const h = Math.round(min / 60);
	if (h < 24) return `${h} h`;
	return `${Math.round(h / 24)} days`;
}

export const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

export function fleetTotals(list: FakeProject[]) {
	return {
		projects: list.filter((p) => p.id !== 'unassigned').length,
		needsYou: sum(list.map((p) => yourMove(p).length)),
		underWay: sum(list.map((p) => underWay(p).length)),
		heldUp: list.filter((p) => health(p) === 'held-up').length,
		landed: sum(list.map((p) => landedThisWeek(p).length))
	};
}

// ---------------------------------------------------------------- the Git insights tab

export interface GitInsights {
	refreshed: number;
	people: { name: string; commits: number; share: number; last: string }[];
	commits: { title: string; who: string; at: number }[];
	hotspots: { area: string; changes: number; note: string }[];
	prs: { title: string; who: string; age: string; state: string }[];
	figures: { label: string; value: string; note: string }[];
}

export const WHEELHOUSE_INSIGHTS: GitInsights = {
	refreshed: 23,
	people: [
		{ name: 'Chris Owen', commits: 92, share: 0.93, last: '3 h ago' },
		{ name: 'Dependabot', commits: 5, share: 0.05, last: '6 days ago' },
		{ name: 'Sam Rivera', commits: 2, share: 0.02, last: '11 days ago' }
	],
	commits: [
		{
			title: 'Turn plugins on or off and change their settings from Settings',
			who: 'Chris Owen',
			at: 3 * H
		},
		{
			title: 'Add, grant, revoke and remove secrets from the Vault page',
			who: 'Chris Owen',
			at: 4 * H
		},
		{
			title: 'Reach Firstmate from Discord, with alerts and decisions as buttons',
			who: 'Chris Owen',
			at: 6 * H
		},
		{ title: 'Show plugin apps inline in the Firstmate chat', who: 'Chris Owen', at: 15 * H },
		{ title: 'Add the vault command and read-only Vault plugin', who: 'Chris Owen', at: 16 * H },
		{ title: 'Upgrade Wheelhouse and its plugins from the header', who: 'Chris Owen', at: 22 * H }
	],
	hotspots: [
		{ area: 'Server runtime', changes: 29, note: 'Changed in 29 commits this month' },
		{ area: 'Task page', changes: 24, note: '24 commits' },
		{ area: 'Fleet collector', changes: 22, note: '22 commits' },
		{ area: 'Header', changes: 19, note: '19 commits' },
		{ area: 'Firstmate model', changes: 15, note: '15 commits' }
	],
	prs: [
		{
			title: 'Upgrade menu in the header',
			who: 'Firstmate',
			age: 'opened yesterday',
			state: 'Ready for your review'
		},
		{
			title: 'Plugin settings validation',
			who: 'Firstmate',
			age: 'opened 35 min ago',
			state: 'Draft'
		}
	],
	figures: [
		{ label: 'Commits this week', value: '74', note: 'up from 41 last week' },
		{ label: 'Pull requests merged', value: '19', note: 'in the last 7 days' },
		{ label: 'Time to merge', value: '2.4 h', note: 'median, last 30 days' },
		{ label: 'Open pull requests', value: '2', note: 'none older than a day' }
	]
};
