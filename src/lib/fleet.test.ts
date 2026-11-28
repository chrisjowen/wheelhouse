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
		expect(fleetTabs(base, { remotes: true }).map((t) => t.label)).toEqual(['Overview', 'Remotes']);
		expect(fleetTabs(base, {}).map((t) => t.label)).toEqual(['Overview']);
		expect(fleetTabs(null, { remotes: true }).map((t) => t.off)).toEqual([null, null]);
	});

	it('keeps a tab the fleet switched off, locked with who and why', () => {
		const remotes = fleetTabs(remotesOff, { remotes: true })[1];
		expect(remotes.href).toBe('/fleet/remotes');
		expect(remotes.off?.reason).toBe('off_by_org');
		expect(remotes.off?.why).toBe('Only from the office network for now.');
	});

	it('says nothing is switched off without a fleet document to say so', () => {
		expect(switchedOff(remotesOff, 'remotes')?.reason).toBe('off_by_org');
		expect(switchedOff(base, 'remotes')).toBeNull();
		expect(switchedOff({ ...remotesOff, state: 'unknown' }, 'remotes')).toBeNull();
		expect(switchedOff(null, 'remotes')).toBeNull();
		expect(switchedOff(remotesOff, 'knowledge')).toBeNull();
	});
});
