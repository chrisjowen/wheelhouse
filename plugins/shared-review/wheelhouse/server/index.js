/**
 * Shared review, bundled with Wheelhouse in the installed-plugin format: a
 * **Reviews** page in the menu, a **Shared review** section on each task
 * with a preview or a review, and **Share for review** on every live preview
 * (a preview.action), all drawn by this plugin's elements
 * (wheelhouse/ui/index.js).
 *
 * The plugin itself only reads. Its one companion service, the review desk
 * (review/desk.mjs), runs on this computer on loopback and does the rest:
 * local previews, connecting live apps, reaching the review server set in
 * the plugin's settings, and closing reviews. Wheelhouse starts the desk only
 * when the captain clicks Launch. The providers read the desk's state by
 * running `review/main.mjs status`, which hands the elements the desk's
 * address and key, so their buttons reach it directly. Closing a review sends
 * its comments to Firstmate through Wheelhouse's feedback capability, on the
 * captain's click, as one note about the task.
 *
 * Nothing here names a host, a domain or an account: the review server, how
 * reviewers sign in, the email sender and the secrets (by wh-vault name) are
 * all the plugin's settings.
 *
 * @typedef {import('@chrisjowen/wheelhouse-plugin-sdk').ProviderContext} ProviderContext
 */

import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DESK_SERVICE, stateDir } from '../../review/paths.mjs';

/** The CLI and desk, beside this entry in the plugin folder. */
export const MAIN = fileURLToPath(new URL('../../review/main.mjs', import.meta.url));
/** The wh-vault bundled beside the plugin in Wheelhouse's package (dist/wh-vault.js). */
const VAULT_CLI = fileURLToPath(new URL('../../../../dist/wh-vault.js', import.meta.url));
const DEPLOY_DIR = fileURLToPath(new URL('../../deploy/', import.meta.url));
const DESK_PORT = 4317;
const SOURCE = 'the review desk';
const NAME = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/;

const available = (value) => ({
	available: true,
	value,
	source: SOURCE,
	observedAt: new Date().toISOString()
});
const unavailable = (reason) => ({ available: false, reason });

/** Wheelhouse's config directory, as Wheelhouse and wh-vault work it out. */
function configDir(env = process.env) {
	if (env.WHEELHOUSE_CONFIG_DIR) return path.resolve(env.WHEELHOUSE_CONFIG_DIR);
	if (env.XDG_CONFIG_HOME) return path.join(env.XDG_CONFIG_HOME, 'wheelhouse');
	return path.join(env.HOME ?? '', '.config', 'wheelhouse');
}

const text = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null);

/**
 * The plugin's settings, checked: what it can use, and what it cannot and why.
 * @param {Record<string, unknown>} s
 */
export function readSettings(s) {
	const problems = [];
	let server = text(s.reviewServer);
	if (server) {
		try {
			const u = new URL(server);
			if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Error('not http(s)');
			if (u.protocol === 'http:' && !['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname)) {
				problems.push(
					'The review server address must use https, so sign-ins are not sent in the clear.'
				);
				server = null;
			} else server = u.origin;
		} catch {
			problems.push('The review server address is not a web address.');
			server = null;
		}
	}
	const secret = (key, fallback) => {
		const v = text(s[key]) ?? fallback;
		if (NAME.test(v)) return v;
		problems.push(`${v} is not a wh-vault name (letters, digits and underscores).`);
		return fallback;
	};
	const signIn =
		s.signIn === 'email' ? ['email'] : s.signIn === 'both' ? ['passcode', 'email'] : ['passcode'];
	const invite = Array.isArray(s.invite)
		? s.invite.filter((x) => typeof x === 'string' && x.trim()).map((x) => x.trim())
		: [];
	return {
		reviewServer: server,
		ownerToken: secret('ownerToken', 'SHARED_REVIEW_OWNER_TOKEN'),
		signIn,
		invite,
		reviewHost: text(s.reviewHost),
		emailFrom: text(s.emailFrom),
		smtpUrl: secret('smtpUrl', 'SHARED_REVIEW_SMTP_URL'),
		problems
	};
}

/** A shell word, quoted only when it needs to be. */
const q = (s) => (/^[\w@%+=:,./-]+$/.test(s) ? s : `'${s.replace(/'/g, `'\\''`)}'`);

/** The deploy commands the captain runs, from the settings, with placeholders where a setting is empty. */
export function deployCommands(set) {
	const url = set.reviewServer ?? 'https://review.example.com';
	const host = set.reviewHost ?? 'deploy@review-host.example.com';
	const names = [set.ownerToken, ...(set.signIn.includes('email') ? [set.smtpUrl] : [])];
	const env = [
		`REVIEW_SSH_HOST=${q(host)}`,
		`REVIEW_PUBLIC_URL=${q(url)}`,
		`REVIEW_OWNER_TOKEN_NAME=${set.ownerToken}`,
		...(set.signIn.includes('email')
			? [
					`REVIEW_EMAIL_FROM=${q(set.emailFrom ?? 'Reviews <reviews@example.com>')}`,
					`REVIEW_SMTP_URL_NAME=${set.smtpUrl}`
				]
			: [])
	];
	return {
		ssh: `wh-vault run --only ${names.join(',')} -- env ${env.join(' ')} ${q(path.join(DEPLOY_DIR, 'ssh-deploy.sh'))}`,
		kubernetes: path.join(DEPLOY_DIR, 'kubernetes.yaml'),
		readme: path.join(DEPLOY_DIR, '..', 'README.md')
	};
}

/**
 * What the elements need besides the reviews: the desk's address and key (or
 * why it is not there), the settings they show, and the commands to give
 * Firstmate and workers.
 * @param {ProviderContext} ctx
 * @param {string | null} task
 */
async function deskState(ctx, task) {
	const argv = [
		process.execPath,
		MAIN,
		'status',
		'--json',
		'--state',
		stateDir(process.env),
		...(task ? ['--task', task] : [])
	];
	const run = (cwd) => ctx.exec({ argv, cwd, timeoutMs: 8_000, maxBytes: 4 * 1024 * 1024 });
	// Run in the task's worktree when it has one, so the answer says where that is.
	let ranIn = task ? 'task' : 'home';
	let r = await run(ranIn);
	if (!r.ok && task) r = await run((ranIn = 'home'));
	if (!r.ok)
		return {
			desk: null,
			reviews: [],
			problem: `the review desk could not be asked: ${r.reason}`,
			worktree: null
		};
	try {
		const v = JSON.parse(r.stdout);
		return {
			desk: v.desk ?? null,
			reviews: Array.isArray(v.reviews) ? v.reviews : [],
			problem: v.desk ? null : (v.problem ?? null),
			worktree: ranIn === 'task' && typeof v.cwd === 'string' ? v.cwd : null
		};
	} catch {
		return {
			desk: null,
			reviews: [],
			problem: 'the review desk answered with something other than JSON',
			worktree: null
		};
	}
}

function common(set, state) {
	return {
		desk: state.desk,
		deskProblem: state.desk ? null : state.problem === 'not running' ? null : state.problem,
		service: 'desk',
		settings: {
			reviewServer: set.reviewServer,
			signIn: set.signIn,
			invite: set.invite,
			ownerToken: set.ownerToken,
			reviewHost: set.reviewHost,
			emailFrom: set.emailFrom,
			problems: set.problems
		},
		cli: MAIN,
		deploy: deployCommands(set),
		reviews: state.reviews,
		/** When the desk was read, so a page that asked the desk itself since keeps its newer answer. */
		readAt: Date.now()
	};
}

/** @param {ProviderContext} ctx */
async function fleetReviews(ctx) {
	const set = readSettings(ctx.settings);
	const state = await deskState(ctx, null);
	const known = new Map(ctx.tasks.map((t) => [t.id, t.title]));
	return available({
		...common(set, state),
		tasks: Object.fromEntries(
			state.reviews
				.filter((r) => r.task && known.has(r.task))
				.map((r) => [r.task, known.get(r.task)])
		)
	});
}

/** @param {ProviderContext} ctx */
async function taskReviews(ctx) {
	const t = ctx.task;
	if (!t) return unavailable('No task.');
	const set = readSettings(ctx.settings);
	const state = await deskState(ctx, t.id);
	const preview = t.preview?.url ?? null;
	if (!preview && !state.reviews.length)
		return unavailable('This task has no preview or review to share.');
	return available({
		...common(set, state),
		task: { id: t.id, title: t.title, project: t.projectId, preview, worktree: state.worktree }
	});
}

/**
 * The project a vault secret is granted to (the first with a clone), so the
 * desk can run under `wh-vault run` there; null when there is none or no vault.
 * @param {ProviderContext} ctx
 */
async function grantedClone(ctx, name) {
	if (!existsSync(VAULT_CLI) || !existsSync(path.join(configDir(), 'vault', 'vault.json')))
		return null;
	const r = await ctx.exec({
		argv: [process.execPath, VAULT_CLI, '--config-dir', configDir(), 'list', '--all', '--json'],
		cwd: 'home',
		timeoutMs: 5_000,
		maxBytes: 2 * 1024 * 1024
	});
	if (!r.ok) return null;
	try {
		const v = JSON.parse(r.stdout);
		const s = (v.secrets ?? []).find((x) => x.name === name);
		for (const id of s?.projects ?? []) {
			const p = ctx.projects.find((x) => x.id === id && x.path);
			if (p) return p.path;
		}
	} catch {
		return null;
	}
	return null;
}

export default {
	providers: [
		{ id: 'reviews', scope: 'fleet', ttlMs: 4_000, timeoutMs: 10_000, fetch: fleetReviews },
		{ id: 'task-reviews', scope: 'task', ttlMs: 4_000, timeoutMs: 10_000, fetch: taskReviews }
	],
	contributions: [
		{
			slot: 'nav.page',
			id: 'reviews',
			title: 'Reviews',
			provider: 'reviews',
			render: { element: 'shared-review-page' }
		},
		{
			slot: 'task.section',
			id: 'review',
			title: 'Shared review',
			provider: 'task-reviews',
			when: 'provider-available',
			placement: { order: 40 },
			render: { element: 'shared-review-task' }
		},
		{
			// Share for review on every live preview: the chat's boxes and a task's Live preview tab.
			slot: 'preview.action',
			id: 'share',
			title: 'Share for review',
			provider: 'reviews',
			render: { element: 'shared-review-share' }
		}
	],
	services: [
		{
			id: 'desk',
			title: 'the review desk',
			scope: 'fleet',
			/** @param {import('@chrisjowen/wheelhouse-plugin-sdk').ServiceContext} ctx */
			async resolve(ctx) {
				const set = readSettings(ctx.settings);
				const port = await ctx.servicePort(DESK_PORT);
				const desk = [
					process.execPath,
					MAIN,
					'desk',
					'--port',
					String(port),
					'--state',
					stateDir(process.env)
				];
				if (set.reviewServer)
					desk.push('--remote', set.reviewServer, '--token-env', set.ownerToken);
				let argv = desk;
				let cwd = path.dirname(MAIN);
				if (set.reviewServer) {
					// The owner token comes from the vault, by name, into the desk's own environment only.
					const clone = await grantedClone(ctx, set.ownerToken);
					if (clone) {
						argv = [process.execPath, VAULT_CLI, 'run', '--only', set.ownerToken, '--', ...desk];
						cwd = clone;
					}
				}
				const base = `http://127.0.0.1:${port}/_review`;
				return {
					available: true,
					spec: {
						url: `${base}/`,
						health: `${base}/health`,
						identity: { url: `${base}/health`, path: ['service'], value: DESK_SERVICE },
						argv,
						cwd,
						binds: 'loopback'
					},
					hint: `${set.reviewServer ? `wh-vault run --only ${set.ownerToken} -- ` : ''}node ${q(MAIN)} desk --port ${port}${set.reviewServer ? ` --remote ${set.reviewServer} --token-env ${set.ownerToken}` : ''}`
				};
			}
		}
	]
};
