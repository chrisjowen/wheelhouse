import { describe, expect, it } from 'vitest';
import { repoName, resolveCaller } from './caller';

const HOME = '/fm';
const files = (map: Record<string, string>) => async (f: string) => {
	if (f in map) return map[f];
	throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
};
const noRemote = async () => null;

describe('resolveCaller', () => {
	it('finds a Firstmate task’s project from its record beside the steering inbox', async () => {
		const c = await resolveCaller({
			env: { FM_TASK_ID: 'wh-1', FM_TASK_INBOX: `${HOME}/state/wh-1.inbox` },
			cwd: '/anywhere',
			readFile: files({
				[`${HOME}/state/wh-1.meta`]: 'window=x\nproject=/fm/projects/wheelhouse\nkind=ship\n'
			}),
			originUrl: async () => 'git@github.com:o/other.git'
		});
		expect(c).toEqual({ task: 'wh-1', project: 'wheelhouse', via: 'task-record' });
	});

	it('reads the record under FM_HOME when there is no inbox, and names the home firstmate', async () => {
		const c = await resolveCaller({
			env: { FM_TASK_ID: 'fm-9', FM_HOME: '/homes/crew' },
			cwd: '/x',
			readFile: files({ '/homes/crew/state/fm-9.meta': 'project=/homes/crew\n' }),
			originUrl: noRemote
		});
		expect(c).toEqual({ task: 'fm-9', project: 'firstmate', via: 'task-record' });
	});

	it('falls back to the origin remote, keeping the task id for the log', async () => {
		const c = await resolveCaller({
			env: { FM_TASK_ID: 'wh-2', FM_TASK_INBOX: `${HOME}/state/wh-2.inbox` },
			cwd: '/x',
			readFile: files({}),
			originUrl: async () => 'https://github.com/chrisjowen/casebook.git\n'
		});
		expect(c).toEqual({ task: 'wh-2', project: 'casebook', via: 'origin-remote' });
	});

	it('ignores an inbox path that is not this task’s, and a task id that is not a slug', async () => {
		const read = files({ [`${HOME}/state/a.meta`]: 'project=/fm/projects/secret\n' });
		expect(
			await resolveCaller({
				env: { FM_TASK_ID: 'b', FM_TASK_INBOX: `${HOME}/state/a.inbox` },
				cwd: '/x',
				readFile: read,
				originUrl: noRemote
			})
		).toEqual({ task: 'b', project: null, via: null });
		expect(
			await resolveCaller({
				env: { FM_TASK_ID: '../a', FM_TASK_INBOX: `${HOME}/state/../a.inbox` },
				cwd: '/x',
				readFile: read,
				originUrl: noRemote
			})
		).toEqual({ task: null, project: null, via: null });
	});

	it('knows nothing outside a task and a repository', async () => {
		expect(await resolveCaller({ env: {}, cwd: '/x', originUrl: noRemote })).toEqual({
			task: null,
			project: null,
			via: null
		});
	});
});

describe('repoName', () => {
	it('takes the repository’s name from any remote form', () => {
		expect(repoName('git@github.com:chrisjowen/wheelhouse.git')).toBe('wheelhouse');
		expect(repoName('https://github.com/o/r')).toBe('r');
		expect(repoName('ssh://git@host/o/r.git/')).toBe('r');
		expect(repoName('/srv/git/team-memory.git')).toBe('team-memory');
		expect(repoName('')).toBeNull();
	});
});
