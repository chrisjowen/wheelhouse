import { describe, expect, it } from 'vitest';
import {
	docKind,
	docsFromTranscript,
	docTitle,
	githubBlob,
	githubRepo,
	isDocPath,
	readableName
} from './docs';

describe('which files are docs', () => {
	it('takes Markdown docs and decision records, not tooling or dependencies', () => {
		for (const p of [
			'README.md',
			'docs/guide.md',
			'docs/adr/0003-approvals.md',
			'packages/web/README.md',
			'.docket/decisions/pin-sveltekit-2.md'
		])
			expect(isDocPath(p), p).toBe(true);
		for (const p of [
			'src/app.ts',
			'node_modules/x/README.md',
			'.github/PULL_REQUEST_TEMPLATE.md',
			'.docket/resources/services/wheelhouse.md',
			'CHANGELOG.md',
			'../outside.md',
			'/etc/motd.md',
			'src/lib/server/passages/testdata/notes.md'
		])
			expect(isDocPath(p), p).toBe(false);
	});

	it('tells decision records from readmes and docs', () => {
		expect(docKind('docs/adr/0003-approvals.md')).toBe('decision');
		expect(docKind('docs/decisions/x.md')).toBe('decision');
		expect(docKind('.docket/constraints/read-only.md')).toBe('decision');
		expect(docKind('README.md')).toBe('readme');
		expect(docKind('docs/guide.md')).toBe('doc');
	});
});

describe('titles', () => {
	it('uses front matter, then the first heading, then the file name', () => {
		expect(docTitle('---\ntitle: "Pin SvelteKit 2"\n---\n# x', 'a.md')).toBe('Pin SvelteKit 2');
		expect(docTitle('Intro\n\n# Use `Postgres` for **cases**\n', 'a.md')).toBe(
			'Use Postgres for cases'
		);
		expect(docTitle('no heading here', 'docs/adr/0007-use-postgres.md')).toBe('Use postgres');
		expect(readableName('packages/web/README.md')).toBe('Readme for web');
		expect(docTitle('# Lumen\n', 'README.md')).toBe('Project readme');
	});
});

describe('docs a session touched', () => {
	const wt = '/work/trees/lumen';
	const line = (branch: string, name: string, file: string) =>
		JSON.stringify({
			type: 'assistant',
			gitBranch: branch,
			message: { content: [{ type: 'tool_use', name, input: { file_path: file } }] }
		});
	it('keeps Read, Edit and Write calls on docs in the worktree, on the task branch', () => {
		const touches = docsFromTranscript(
			[
				line('fm/share', 'Read', `${wt}/docs/adr/0002-links.md`),
				line('fm/share', 'Edit', `${wt}/README.md`),
				line('fm/share', 'Read', `${wt}/README.md`),
				line('fm/share', 'Read', `${wt}/src/links.ts`),
				line('fm/other', 'Read', `${wt}/docs/guide.md`),
				line('fm/share', 'Read', '/elsewhere/docs/notes.md'),
				line('fm/share', 'Grep', `${wt}/docs/x.md`),
				'not json "tool_use" fm/share'
			],
			wt,
			'fm/share'
		);
		expect(touches).toEqual([
			{ path: 'docs/adr/0002-links.md', read: true, changed: false },
			{ path: 'README.md', read: true, changed: true }
		]);
	});
});

describe('GitHub links', () => {
	it('links the branch while changed there, else the default branch', () => {
		const repo = githubRepo('https://github.com/lumen-app/lumen/pull/142');
		expect(repo).toBe('lumen-app/lumen');
		expect(githubBlob(repo, 'fm/share-links', 'docs/a b.md', true)).toBe(
			'https://github.com/lumen-app/lumen/blob/fm/share-links/docs/a%20b.md'
		);
		expect(githubBlob(repo, 'fm/share-links', 'README.md', false)).toBe(
			'https://github.com/lumen-app/lumen/blob/HEAD/README.md'
		);
		expect(githubBlob(null, 'fm/x', 'README.md', true)).toBeNull();
	});
});
