import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { commitDays } from './activity';

/** A project's commits per day, read from a scratch repository with dated commits. */

let dir: string;
const NOW = new Date(2026, 9, 30, 15, 0).getTime();

function commit(when: Date, branch?: string) {
	const env = {
		...process.env,
		GIT_AUTHOR_NAME: 't',
		GIT_AUTHOR_EMAIL: 't@t',
		GIT_COMMITTER_NAME: 't',
		GIT_COMMITTER_EMAIL: 't@t',
		GIT_AUTHOR_DATE: when.toISOString(),
		GIT_COMMITTER_DATE: when.toISOString()
	};
	const git = (...args: string[]) =>
		execFileSync('git', ['-C', dir, ...args], { env, stdio: 'ignore' });
	if (branch) git('checkout', '-q', '-B', branch);
	writeFileSync(path.join(dir, 'f.txt'), String(when.getTime()));
	git('add', 'f.txt');
	git('commit', '-q', '-m', 'c');
}

beforeEach(() => {
	dir = mkdtempSync(path.join(tmpdir(), 'wh-activity-'));
	execFileSync('git', ['init', '-q', '-b', 'main', dir]);
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('commitDays', () => {
	it('counts commits on every branch per day over the last two weeks, oldest first', async () => {
		commit(new Date(2026, 9, 1, 12));
		commit(new Date(2026, 9, 29, 10));
		commit(new Date(2026, 9, 30, 9));
		commit(new Date(2026, 9, 30, 11), 'feature');
		const days = await commitDays(dir, NOW);
		expect(days).toHaveLength(14);
		expect(days?.slice(-2)).toEqual([1, 2]);
		expect(days?.reduce((a, b) => a + b, 0)).toBe(3);
	});

	it('is null without a clone or outside a repository', async () => {
		expect(await commitDays(null, NOW)).toBeNull();
		expect(await commitDays(path.join(dir, 'missing'), NOW)).toBeNull();
	});
});
