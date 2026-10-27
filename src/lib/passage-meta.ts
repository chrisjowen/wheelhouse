/**
 * What the passage file format offers, in a form the browser can use too: the
 * check types with their outcomes and fields, the Firstmate facts conditions
 * may reference, and the evidence blocks, each with plain words for the
 * passage editor. The validator (server/passages/schema.ts) uses the same
 * tables, so the editor's forms and the strict validator never disagree.
 */

export const OUTCOMES = {
	'github.deployment': ['success', 'failure', 'in_progress', 'inactive', 'absent'],
	'github.workflow': ['success', 'failure', 'in_progress', 'absent'],
	'github.release': ['included', 'not_yet'],
	'npm.published': ['published', 'latest', 'absent'],
	http: ['ok', 'mismatch', 'error'],
	'git.contains': ['yes', 'no'],
	'status.note': ['present', 'absent'],
	command: ['passed', 'failed']
} as const satisfies Record<string, readonly string[]>;

export type CheckTypeName = keyof typeof OUTCOMES;

/** Firstmate facts a condition may reference, in plain words. */
export const FACT_WORDS: Record<string, string> = {
	'task.live': 'a worker record exists for the task',
	'backlog.queued': 'the backlog lists it as queued',
	'backlog.done': 'the backlog marks it done',
	'nm.run': 'the automated checks (no-mistakes) are running',
	'pr.recorded': 'a pull request is recorded',
	'pr.ready': 'the pull request is CI-ready and awaits a merge',
	'pr.changes_requested': 'changes were requested after the pull request was reported ready',
	'crew.done': 'the worker reports done',
	merged: 'a merge or landing is recorded',
	'hold.captain': 'Firstmate holds it for the captain',
	'report.present': 'the worker wrote its report'
};

/** Evidence blocks every passage can show, with their names on the task page. */
export const EVIDENCE_WORDS: Record<string, string> = {
	queue: 'Place in the queue',
	progress: 'Progress',
	files: 'Files changed',
	validation: 'Automated checks',
	pr: 'Pull request',
	report: 'Report',
	screenshots: 'Screenshots',
	preview: 'Live preview',
	decision: 'Decisions',
	landed: 'Landed'
};

export const CHECK_WORDS: Record<CheckTypeName, { name: string; what: string }> = {
	'github.deployment': {
		name: 'GitHub deployment',
		what: 'Whether a deployment to an environment (Vercel, Netlify, Render…) succeeded.'
	},
	'github.workflow': {
		name: 'GitHub workflow run',
		what: 'Whether a GitHub Actions workflow passed for the commit.'
	},
	'github.release': { name: 'GitHub release', what: 'Whether a release includes the commit.' },
	'npm.published': {
		name: 'Published on npm',
		what: 'Whether the released version is on npm.'
	},
	http: { name: 'Web address', what: 'Whether a URL answers as expected.' },
	'git.contains': {
		name: 'Commit on a branch',
		what: 'Whether the commit is on a branch of a local checkout.'
	},
	'status.note': {
		name: 'Worker’s preview link',
		what: 'Whether the worker reported a live preview.'
	},
	command: {
		name: 'Run a command',
		what: 'Runs a program on this machine, in the project’s folder; passes when it exits 0.'
	}
};

const OUTCOME_WORDS: Record<string, string> = {
	success: 'succeeded',
	failure: 'failed',
	in_progress: 'is in progress',
	inactive: 'succeeded and was replaced',
	absent: 'is not there yet',
	included: 'includes it',
	not_yet: 'does not include it yet',
	published: 'is published',
	latest: 'is the latest',
	ok: 'answers as expected',
	mismatch: 'answers something else',
	error: 'answers with an error',
	yes: 'contains it',
	no: 'does not contain it yet',
	present: 'is reported',
	passed: 'passed',
	failed: 'failed'
};

export const outcomeWords = (o: string) => OUTCOME_WORDS[o] ?? o.replace(/_/g, ' ');

/** How a form field is edited. */
export type FieldKind = 'text' | 'select' | 'list' | 'duration' | 'number' | 'check' | 'map';

export interface CheckField {
	/** Path within the check (`expect.status` for nested fields). */
	key: string;
	label: string;
	kind: FieldKind;
	required?: boolean;
	options?: { value: string; label: string }[];
	help?: string;
	placeholder?: string;
	/** Only in the captain-owned file. */
	captainOnly?: boolean;
}

const COMMIT = [
	{ value: 'pr.head', label: 'The pull request’s latest commit' },
	{ value: 'merge.commit', label: 'The merge commit' }
];

/** Every check type's own fields (label and interval are common to all). */
export const CHECK_FIELDS: Record<CheckTypeName, CheckField[]> = {
	'github.deployment': [
		{
			key: 'environment',
			label: 'Environment',
			kind: 'text',
			required: true,
			placeholder: 'Production'
		},
		{ key: 'ref', label: 'Commit', kind: 'select', required: true, options: COMMIT },
		{
			key: 'repo',
			label: 'Repository',
			kind: 'text',
			placeholder: 'owner/name',
			help: 'Defaults to the task’s pull request repository.'
		}
	],
	'github.workflow': [
		{
			key: 'workflow',
			label: 'Workflow file',
			kind: 'text',
			required: true,
			placeholder: 'ci.yml'
		},
		{ key: 'ref', label: 'Commit', kind: 'select', required: true, options: COMMIT },
		{ key: 'event', label: 'Event', kind: 'text', placeholder: 'push' },
		{ key: 'repo', label: 'Repository', kind: 'text', placeholder: 'owner/name' }
	],
	'github.release': [
		{ key: 'contains', label: 'Commit', kind: 'select', required: true, options: COMMIT },
		{ key: 'tag_pattern', label: 'Tag pattern', kind: 'text', placeholder: 'v*' },
		{ key: 'repo', label: 'Repository', kind: 'text', placeholder: 'owner/name' }
	],
	'npm.published': [
		{ key: 'package', label: 'Package', kind: 'text', required: true, placeholder: '@scope/name' },
		{
			key: 'version_from',
			label: 'Version from release check',
			kind: 'check',
			required: true,
			help: 'A GitHub release check; its tag (minus a leading v) is the version.'
		}
	],
	http: [
		{ key: 'url', label: 'URL', kind: 'text', required: true, placeholder: 'https://…' },
		{
			key: 'method',
			label: 'Method',
			kind: 'select',
			options: [
				{ value: 'GET', label: 'GET' },
				{ value: 'HEAD', label: 'HEAD' }
			]
		},
		{ key: 'expect.status', label: 'Expected status', kind: 'number', placeholder: '200' },
		{ key: 'expect.json_pointer', label: 'JSON value at', kind: 'text', placeholder: '/commit' },
		{
			key: 'expect.equals',
			label: 'Equals',
			kind: 'text',
			placeholder: 'merge.commit',
			help: 'merge.commit, pr.head, task.id or a literal value.'
		},
		{
			key: 'headers_from_env',
			label: 'Headers from environment',
			kind: 'map',
			captainOnly: true,
			help: 'Header: ENV_VAR, one per line.'
		}
	],
	'git.contains': [
		{
			key: 'repo',
			label: 'Checkout',
			kind: 'select',
			required: true,
			options: [
				{ value: 'project-clone', label: 'The project clone' },
				{ value: 'firstmate-root', label: 'The Firstmate checkout' }
			]
		},
		{ key: 'ref', label: 'Branch', kind: 'text', placeholder: 'the default branch' },
		{ key: 'commit', label: 'Commit', kind: 'select', required: true, options: COMMIT }
	],
	'status.note': [
		{
			key: 'prefix',
			label: 'Status line',
			kind: 'select',
			required: true,
			options: [{ value: 'preview', label: 'preview <url>' }]
		}
	],
	command: [
		{
			key: 'run',
			label: 'Program and arguments',
			kind: 'list',
			required: true,
			help: 'One item per line: the program first, then each argument. Never run through a shell.'
		},
		{
			key: 'cwd',
			label: 'Folder',
			kind: 'text',
			placeholder: '.',
			help: 'Inside the project, relative to its top.'
		},
		{ key: 'timeout', label: 'Time limit', kind: 'duration', placeholder: '5m' },
		{
			key: 'env',
			label: 'Environment to pass',
			kind: 'list',
			help: 'Variable names, one per line, passed from Wheelhouse’s environment.'
		},
		{
			key: 'when',
			label: 'Run only',
			kind: 'select',
			options: [
				{ value: 'merged', label: 'After the merge' },
				{ value: 'pr.recorded', label: 'Once a pull request is open' },
				{ value: 'crew.done', label: 'Once the worker reports done' }
			],
			help: 'Leave it unset to run as soon as a task can use it, even before the merge.'
		},
		{
			key: 'ref',
			label: 'Run once per',
			kind: 'select',
			options: [
				{ value: 'merge.commit', label: 'Merge commit (after the merge)' },
				{ value: 'pr.head', label: 'Pull request commit' }
			],
			help: 'Waits for that commit; without it, it runs as soon as a task can use it.'
		}
	]
};

/** The environment every command check gets besides its own list. */
export const COMMAND_BASE_ENV = ['PATH', 'HOME', 'USER', 'LOGNAME', 'LANG', 'LC_ALL', 'TMPDIR'];

/** The message that asks Firstmate to ship a passage file saved in a project's clone. */
export const shipPassageDraft = (project: string) =>
	`Please commit the edited .wheelhouse.yaml in the ${project} clone and ship it as a pull request; it changes the project's passage.`;
