import { describe, expect, it } from 'vitest';
import {
	fleetyardMachine,
	hostLabel,
	linkProblem,
	unreachable,
	withoutTransport
} from './matelink';

describe('a second mate on a Fleetyard machine', () => {
	it('is one whose host is the connector’s fy-<machine> alias', () => {
		expect(fleetyardMachine('fy-mate-demo')).toBe('mate-demo');
		expect(fleetyardMachine('hostinger-fm')).toBeNull();
		expect(fleetyardMachine('fy-')).toBeNull();
		expect(fleetyardMachine(null)).toBeNull();
		expect(hostLabel('fy-mate-demo')).toBe('mate-demo, through Fleetyard');
		expect(hostLabel('tokyo-box')).toBe('tokyo-box');
	});
});

describe('link problems in plain words', () => {
	const say = (s: string) => linkProblem(s, 'mate-demo', 'this Mac');

	it('says what the connector and Fleetyard refuse with, and what fixes it', () => {
		expect(
			say(
				'whc-connector: mate-demo is stopped; start it first. (`whc-connector machine start --wait` it, or dial with --wake)'
			)
		).toEqual({
			code: 'stopped',
			text: 'mate-demo is stopped.',
			action: 'wake'
		});
		expect(
			say(
				'This computer is not approved for mate-demo. Run whc-connector ssh-setup, then approve it at https://fleetyard.io/account.'
			)
		).toEqual({
			code: 'not-approved',
			text: 'This Mac isn’t approved for mate-demo.',
			action: 'approve'
		});
		expect(
			say(
				'mate-demo refused your latest approval (signed by a passkey it does not trust). If it does not trust the passkey you signed with, update its trusted passkeys on Machines with one it does.'
			)
		).toEqual({
			code: 'refused',
			text: 'mate-demo didn’t accept the approval: signed by a passkey it does not trust.',
			action: 'update-passkeys'
		});
		expect(say('mate-demo does not carry SSH: its connector needs updating.')).toMatchObject({
			code: 'old-connector',
			text: 'mate-demo’s connector is too old to be reached this way.',
			action: null
		});
		expect(say('Too many connections from this computer; wait a few minutes.').text).toBe(
			'Too many connections from this Mac; try again in a few minutes.'
		);
		for (const s of [
			'This computer is not paired.',
			'This computer was removed from your account. Pair it again.',
			'whc-connector: this computer is not paired. Run `whc-connector pair` first.'
		]) {
			expect(say(s)).toEqual({
				code: 'not-connected',
				text: 'This Mac isn’t connected to your Fleetyard account.',
				action: 'connect'
			});
		}
		expect(say('Could not reach https://fleetyard.io: getaddrinfo ENOTFOUND').code).toBe(
			'no-answer'
		);
		expect(say('mate-demo is running but its connector is not online yet.').code).toBe('starting');
	});

	it('never names the transport, even in words it does not know', () => {
		const p = say('mate-demo could not reach its SSH server (refused).');
		expect(p.code).toBe('mate');
		expect(p.text).not.toMatch(/ssh/i);
		expect(say('ssh: something new').text).toBe('Fleetyard said: something new');
		expect(withoutTransport('invalid remote route: missing SSH host')).toBe(
			'invalid remote route: missing host'
		);
	});

	it('says why a host could not be reached: the connector’s reason, else the failure in plain words', () => {
		expect(
			unreachable(
				'fy-mate-demo',
				'whc-connector: mate-demo is stopped; start it first.\nConnection closed by UNKNOWN port 65535'
			)
		).toBe('mate-demo is stopped.');
		expect(
			unreachable('fy-mate-demo', 'kex_exchange_identification: Connection closed by remote host')
		).toBe('could not reach mate-demo, through Fleetyard (it closed the connection).');
		expect(
			unreachable(
				'tokyo-box',
				'ssh: Could not resolve hostname tokyo-box: nodename nor servname provided'
			)
		).toBe('could not reach tokyo-box (its name could not be looked up).');
		expect(unreachable('tokyo-box', '')).toBe('could not reach tokyo-box.');
	});
});
