/**
 * Project links as an installed plugin: the compiled-in project-links plugin
 * (src/lib/plugins/project-links/) in the external format. It shows a
 * project's repository, README and pull requests, using only the project
 * clone's `origin` remote, its README and the fleet Wheelhouse already has. It
 * reads nothing else and writes nothing. Its Harbour card is the
 * <project-links-summary> element from ../ui/index.js.
 *
 * A real plugin would import the SDK's builders and bundle them in; this one
 * writes its blocks out so it needs no build step.
 *
 * @typedef {import('@chrisjowen/wheelhouse-plugin-sdk').WheelhousePlugin} WheelhousePlugin
 * @typedef {import('@chrisjowen/wheelhouse-plugin-sdk').ProviderContext} ProviderContext
 * @typedef {import('@chrisjowen/wheelhouse-plugin-sdk').Project} Project
 * @typedef {import('@chrisjowen/wheelhouse-plugin-sdk').Task} Task
 * @typedef {import('@chrisjowen/wheelhouse-plugin-sdk').Block} Block
 */

/** The browser URL for a GitHub-style remote, without credentials, or null. */
export function webUrl(remote) {
	const s = remote.trim();
	const scp = /^[\w.-]+@([\w.-]+):([\w.-]+\/[\w.-]+?)(?:\.git)?\/?$/.exec(s);
	if (scp) return `https://${scp[1]}/${scp[2]}`;
	let u;
	try {
		u = new URL(s);
	} catch {
		return null;
	}
	if (!['https:', 'http:', 'ssh:', 'git:'].includes(u.protocol)) return null;
	const repo = /^\/([\w.-]+\/[\w.-]+?)(?:\.git)?\/?$/.exec(u.pathname);
	if (!repo || !/^[\w.-]+$/.test(u.hostname)) return null;
	return `https://${u.hostname}/${repo[1]}`;
}

const isGitHub = (url) => !!url && url.startsWith('https://github.com/');
const segments = (ref) => ref.split('/').map(encodeURIComponent).join('/');

/** The project's browser URL and README title, reused for a minute across providers. */
const facts = new Map();
const FACTS_TTL_MS = 60_000;

/** @param {ProviderContext} ctx @param {Project | null} project */
function projectFacts(ctx, project = ctx.project) {
	const dir = project?.path;
	if (!dir) return Promise.resolve({ repoUrl: null, readme: null });
	const hit = facts.get(dir);
	const at = Date.now();
	if (hit && at - hit.at < FACTS_TTL_MS) return hit.value;
	const value = (async () => {
		const [remote, readme] = await Promise.all([
			ctx.exec({
				argv: ['git', 'remote', 'get-url', 'origin'],
				cwd: 'project',
				project: project.id,
				timeoutMs: 2_000,
				maxBytes: 4096
			}),
			ctx.readFile('README.md', { root: 'project', maxBytes: 8192, project: project.id })
		]);
		if (!remote.ok && facts.get(dir)?.at === at) facts.delete(dir);
		const repoUrl = remote.ok ? webUrl(remote.stdout) : null;
		const title = readme?.match(/^#\s+(.+)$/m)?.[1].trim() ?? 'README';
		return {
			repoUrl,
			readme:
				readme === null
					? null
					: { title, url: isGitHub(repoUrl) ? `${repoUrl}/blob/HEAD/README.md` : null }
		};
	})();
	facts.set(dir, { at, value });
	return value;
}

/** @param {Task[]} tasks */
const pulls = (tasks) =>
	tasks
		.filter((t) => t.pr)
		.map((t) => ({
			title: t.title,
			url: t.pr.url,
			number: t.pr.number,
			landed: t.status === 'landed'
		}));

const SOURCE = 'the project clone’s origin remote and README, and Firstmate’s fleet';
const now = () => new Date().toISOString();

/** @param {ProviderContext} ctx */
async function summary(ctx) {
	const f = await projectFacts(ctx);
	return {
		available: true,
		value: { ...f, pulls: pulls(ctx.tasks) },
		source: SOURCE,
		observedAt: now()
	};
}

/** @returns {Block[]} */
function projectBlocks(project, s) {
	const links = [];
	if (s.repoUrl) links.push({ label: 'Repository', href: s.repoUrl });
	if (s.readme?.url) links.push({ label: 'README', href: s.readme.url, note: s.readme.title });
	if (isGitHub(s.repoUrl)) links.push({ label: 'Pull requests', href: `${s.repoUrl}/pulls` });
	const blocks = [];
	if (links.length) blocks.push({ block: 'links.v1', links });
	else {
		blocks.push({
			block: 'text.v1',
			text: project.path
				? 'This project’s clone has no GitHub-style origin remote.'
				: 'Firstmate has not recorded a clone for this project.',
			muted: true
		});
	}
	blocks.push({
		block: 'kv.v1',
		items: [
			{ key: 'Clone', value: project.path ?? 'Not recorded' },
			{ key: 'README', value: s.readme ? s.readme.title : 'None found' }
		]
	});
	if (s.pulls.length) {
		blocks.push({
			block: 'table.v1',
			columns: ['Task', 'Pull request', 'State'],
			rows: s.pulls.map((p) => [
				p.title,
				{ text: p.number ? `#${p.number}` : 'Open', href: p.url },
				p.landed ? 'Landed' : 'Open'
			])
		});
	} else {
		blocks.push({
			block: 'text.v1',
			text: 'No pull requests recorded for this project.',
			muted: true
		});
	}
	return blocks;
}

/** @type {WheelhousePlugin} */
export default {
	providers: [
		{ id: 'summary', scope: 'project', ttlMs: 30_000, fetch: summary },
		{
			id: 'links',
			scope: 'project',
			ttlMs: 30_000,
			async fetch(ctx) {
				const s = await summary(ctx);
				return { ...s, value: projectBlocks(ctx.project, s.value) };
			}
		},
		{
			id: 'task',
			scope: 'task',
			ttlMs: 15_000,
			async fetch(ctx) {
				const t = ctx.task;
				const { repoUrl } = await projectFacts(ctx);
				const links = [];
				if (t.pr) {
					links.push({
						label: `Pull request${t.pr.number ? ` #${t.pr.number}` : ''}`,
						href: t.pr.url
					});
				}
				if (t.preview) links.push({ label: 'Reported preview', href: t.preview.url });
				if (t.branch && isGitHub(repoUrl)) {
					links.push({
						label: 'Branch',
						href: `${repoUrl}/tree/${segments(t.branch)}`,
						note: t.branch
					});
				}
				if (repoUrl) links.push({ label: 'Repository', href: repoUrl });
				const blocks = [
					t.pr
						? {
								block: 'status.v1',
								tone: t.status === 'landed' ? 'ok' : 'pending',
								label: t.status === 'landed' ? 'Pull request landed' : 'Pull request open'
							}
						: { block: 'status.v1', tone: 'unknown', label: 'No pull request recorded yet' }
				];
				if (links.length) blocks.push({ block: 'links.v1', links });
				return { available: true, value: blocks, source: SOURCE, observedAt: now() };
			}
		},
		{
			id: 'compare',
			scope: 'task',
			ttlMs: 30_000,
			async fetch(ctx) {
				const t = ctx.task;
				const { repoUrl } = await projectFacts(ctx);
				if (!t.branch || !isGitHub(repoUrl)) {
					return { available: false, reason: 'No branch on a GitHub repository to compare.' };
				}
				const href = `${repoUrl}/compare/${segments(t.branch)}`;
				return {
					available: true,
					value: [{ block: 'links.v1', links: [{ label: `Compare ${t.branch} on GitHub`, href }] }],
					source: SOURCE,
					observedAt: now()
				};
			}
		},
		{
			id: 'repos',
			scope: 'fleet',
			ttlMs: 60_000,
			async fetch(ctx) {
				const cards = [];
				for (const p of ctx.projects) {
					const { repoUrl, readme } = await projectFacts(ctx, p);
					if (!repoUrl) continue;
					const links = [{ label: 'Repository', href: repoUrl }];
					if (readme?.url) links.push({ label: 'README', href: readme.url });
					cards.push({
						key: p.id,
						title: p.name,
						mentions: [repoUrl],
						blocks: [
							...(p.description ? [{ block: 'text.v1', text: p.description, muted: true }] : []),
							{ block: 'links.v1', links }
						]
					});
				}
				return { available: true, value: cards, source: SOURCE, observedAt: now() };
			}
		}
	],
	contributions: [
		{
			slot: 'project.tab',
			id: 'links',
			title: 'Links',
			provider: 'links',
			render: { blocks: true }
		},
		{
			slot: 'harbour.card',
			id: 'summary',
			title: 'Project links',
			provider: 'summary',
			when: 'provider-available',
			render: { element: 'project-links-summary' }
		},
		{
			slot: 'task.section',
			id: 'task-links',
			title: 'Links',
			provider: 'task',
			placement: { order: 250 },
			render: { blocks: true }
		},
		{
			slot: 'step.evidence',
			id: 'compare',
			title: 'Compare on GitHub',
			provider: 'compare',
			when: 'provider-available',
			placement: { step: 'pr' },
			render: { blocks: true }
		},
		{
			slot: 'bridge.card',
			id: 'repo',
			title: 'Project',
			provider: 'repos',
			render: { blocks: true }
		}
	]
};
