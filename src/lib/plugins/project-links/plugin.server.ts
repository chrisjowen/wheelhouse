import type { Block, BridgeCard } from '../types';
import type { ProjectSummary } from './types';
import type { Project, TaskSummary } from '../../types';
import {
	PLUGIN_API_VERSION,
	type ProviderContext,
	type WheelhousePlugin
} from '../../server/plugins/types';

/**
 * Project links: the example plugin that proves every slot end to end. It
 * shows a project's repository, README and pull requests, using only the
 * project clone's `origin` remote, its README and the fleet Wheelhouse
 * already has. It reads nothing else and writes nothing.
 */

/**
 * The browser URL for a git remote, without credentials: GitHub-style SSH and
 * HTTPS remotes only. Anything else (a local path, another scheme) is null.
 */
export function webUrl(remote: string): string | null {
	const s = remote.trim();
	const scp = /^[\w.-]+@([\w.-]+):([\w.-]+\/[\w.-]+?)(?:\.git)?\/?$/.exec(s);
	if (scp) return `https://${scp[1]}/${scp[2]}`;
	let u: URL;
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

const isGitHub = (url: string | null) => !!url && url.startsWith('https://github.com/');
const segments = (ref: string) => ref.split('/').map(encodeURIComponent).join('/');

/** The project's browser URL and README title, reused for a minute across providers. */
const facts = new Map<string, { at: number; value: Promise<Omit<ProjectSummary, 'pulls'>> }>();
const FACTS_TTL_MS = 60_000;

function projectFacts(
	ctx: ProviderContext,
	project: Project | null = ctx.project
): Promise<Omit<ProjectSummary, 'pulls'>> {
	const dir = project?.path;
	if (!dir) return Promise.resolve({ repoUrl: null, readme: null });
	const hit = facts.get(dir);
	if (hit && Date.now() - hit.at < FACTS_TTL_MS) return hit.value;
	const value = (async () => {
		const [remote, readme] = await Promise.all([
			ctx.exec({
				argv: ['git', 'remote', 'get-url', 'origin'],
				cwd: 'project',
				project: project!.id,
				timeoutMs: 2_000,
				maxBytes: 4096
			}),
			ctx.readFile('README.md', { root: 'project', maxBytes: 8192, project: project!.id })
		]);
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
	facts.set(dir, { at: Date.now(), value });
	return value;
}

function pulls(tasks: TaskSummary[]): ProjectSummary['pulls'] {
	return tasks
		.filter((t) => t.pr)
		.map((t) => ({
			title: t.title,
			url: t.pr!.url,
			number: t.pr!.number,
			landed: t.status === 'landed'
		}));
}

const SOURCE = 'the project clone’s origin remote and README, and Firstmate’s fleet';
const now = () => new Date().toISOString();

async function summary(ctx: ProviderContext) {
	const f = await projectFacts(ctx);
	const value: ProjectSummary = { ...f, pulls: pulls(ctx.tasks) };
	return { available: true as const, value, source: SOURCE, observedAt: now() };
}

function projectBlocks(project: Project, s: ProjectSummary): Block[] {
	const links: { label: string; href: string; note?: string }[] = [];
	if (s.repoUrl) links.push({ label: 'Repository', href: s.repoUrl });
	if (s.readme?.url) links.push({ label: 'README', href: s.readme.url, note: s.readme.title });
	if (isGitHub(s.repoUrl)) links.push({ label: 'Pull requests', href: `${s.repoUrl}/pulls` });
	const blocks: Block[] = [];
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

export const projectLinks: WheelhousePlugin = {
	apiVersion: PLUGIN_API_VERSION,
	id: 'project-links',
	name: 'Project links',
	version: '0.1.0',
	enabledByDefault: false,
	providers: [
		{ id: 'summary', scope: 'project', ttlMs: 30_000, fetch: summary },
		{
			id: 'links',
			scope: 'project',
			ttlMs: 30_000,
			async fetch(ctx) {
				const s = await summary(ctx);
				return { ...s, value: projectBlocks(ctx.project!, s.value) };
			}
		},
		{
			id: 'task',
			scope: 'task',
			ttlMs: 15_000,
			async fetch(ctx) {
				const t = ctx.task!;
				const { repoUrl } = await projectFacts(ctx);
				const links: { label: string; href: string; note?: string }[] = [];
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
				const blocks: Block[] = [
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
				const t = ctx.task!;
				const { repoUrl } = await projectFacts(ctx);
				if (!t.branch || !isGitHub(repoUrl)) {
					return { available: false, reason: 'No branch on a GitHub repository to compare.' };
				}
				const blocks: Block[] = [
					{
						block: 'links.v1',
						links: [
							{
								label: `Compare ${t.branch} on GitHub`,
								href: `${repoUrl}/compare/${segments(t.branch)}`
							}
						]
					}
				];
				return { available: true, value: blocks, source: SOURCE, observedAt: now() };
			}
		},
		{
			id: 'repos',
			scope: 'fleet',
			ttlMs: 60_000,
			async fetch(ctx) {
				const cards: BridgeCard[] = [];
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
							...(p.description
								? [{ block: 'text.v1' as const, text: p.description, muted: true }]
								: []),
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
			render: { component: 'project-links/summary' }
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
