import { describe, expect, it } from 'vitest';
import { DEFAULT_GATEWAY } from './cloud';
import { fleetTabs, switchedOff, type FleetView } from './fleet';

const base: FleetView = {
	schema: 'wheelhouse-fleet.v1',
	state: 'joined',
	gateway: DEFAULT_GATEWAY,
	fleetyard: true,
	ship: { name: 'priya-mbp', fingerprint: 'ABCD', pairedAt: '' },
	fleet: {
		name: 'Larkspur Market',
		slug: 'larkspur',
		kind: 'company',
		plan: 'Team',
		role: 'member',
		person: 'Priya',
		teams: []
	},
	features: [
		{
			key: 'remotes',
			label: 'Reach this ship from anywhere',
			on: true,
			reason: null,
			note: null,
			why: null
		}
	],
	checkedAt: null,
	error: null,
	gateways: [],
	pairing: null,
	viaRelay: false
};
const remotesOff: FleetView = {
	...base,
	features: [
		{
			key: 'remotes',
			label: 'Reach this ship from anywhere',
			on: false,
			reason: 'off_by_org',
			note: 'Switched off for Larkspur Market by Tom Okafor.',
			why: 'Only from the office network for now.'
		}
	]
};

describe('the Fleet area’s row', () => {
	it('lists the Overview, and Remotes while remote access is on', () => {
		expect(fleetTabs(base, { remotes: true }).map((t) => t.label)).toEqual([
			'Overview',
			'Remotes',
			'Second mates'
		]);
		expect(fleetTabs(base, {}).map((t) => t.label)).toEqual(['Overview', 'Second mates']);
		expect(fleetTabs(null, { remotes: true }).map((t) => t.off)).toEqual([null, null, null]);
	});

	it('keeps a tab the fleet switched off, locked with who and why', () => {
		const remotes = fleetTabs(remotesOff, { remotes: true })[1];
		expect(remotes.href).toBe('/fleet/remotes');
		expect(remotes.off?.reason).toBe('off_by_org');
		expect(remotes.off?.why).toBe('Only from the office network for now.');
	});

	it('locks Second mates with the team’s reason when cloud second mates are off', () => {
		const mates = fleetTabs(
			{
				...base,
				features: [
					{
						key: 'cloud_second_mates',
						label: 'Cloud second mates',
						on: false,
						reason: 'off_by_team',
						note: 'Switched off for Payments squad by Dev Kapoor.',
						why: 'Paused until the AWS budget review.'
					}
				]
			},
			{}
		)[1];
		expect(mates.href).toBe('/fleet/mates');
		expect(mates.feature).toBe('cloud_second_mates');
		expect(mates.off?.reason).toBe('off_by_team');
		expect(fleetTabs(base, {})[1].off).toBeNull();
	});

	it('says nothing is switched off without a fleet document to say so', () => {
		expect(switchedOff(remotesOff, 'remotes')?.reason).toBe('off_by_org');
		expect(switchedOff(base, 'remotes')).toBeNull();
		expect(switchedOff({ ...remotesOff, state: 'unknown' }, 'remotes')).toBeNull();
		expect(switchedOff(null, 'remotes')).toBeNull();
		expect(switchedOff(remotesOff, 'knowledge')).toBeNull();
	});
});
