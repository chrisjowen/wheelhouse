import { describe, expect, it } from 'vitest';
import { scriptEnv, SNAPSHOT_BUDGET_S } from './scriptenv';

const me = () => ({ homedir: '/Users/captain', username: 'captain' });

describe('the environment Firstmate’s scripts run with', () => {
	it('fills what ssh needs from this account when the server started without it', () => {
		const env = scriptEnv(
			{},
			{ platform: 'darwin', user: me, agentSocket: () => '/tmp/agent.sock' }
		);
		expect(env).toMatchObject({
			HOME: '/Users/captain',
			USER: 'captain',
			LOGNAME: 'captain',
			SSH_AUTH_SOCK: '/tmp/agent.sock',
			FM_SNAPSHOT_BUDGET: String(SNAPSHOT_BUDGET_S)
		});
		expect(env.PATH!.split(':')).toEqual(
			expect.arrayContaining([
				'/usr/bin',
				'/bin',
				'/usr/local/bin',
				'/opt/homebrew/bin',
				// Where the hc and herdr runtime backends are usually installed.
				'/Users/captain/.local/bin'
			])
		);
	});

	it('changes nothing already set, and keeps PATH’s own order first', () => {
		const given = {
			HOME: '/h',
			USER: 'u',
			LOGNAME: 'l',
			SSH_AUTH_SOCK: '/s',
			FM_SNAPSHOT_BUDGET: '7',
			PATH: '/mine/bin:/usr/bin'
		};
		const env = scriptEnv(given, { platform: 'darwin', user: me, agentSocket: () => '/other' });
		expect(env).toMatchObject({
			...given,
			PATH: expect.stringMatching(/^\/mine\/bin:\/usr\/bin:/)
		});
	});

	it('asks launchd for an agent only on macOS', () => {
		let asked = false;
		const env = scriptEnv(
			{},
			{
				platform: 'linux',
				user: me,
				agentSocket: () => {
					asked = true;
					return '/tmp/agent.sock';
				}
			}
		);
		expect(asked).toBe(false);
		expect(env.SSH_AUTH_SOCK).toBeUndefined();
	});
});
