/**
 * The hosted machines Fleetyard can launch for a second mate. Mirrors Fleetyard's own catalog
 * (wheelhouse-cloud src/hosted/catalog.ts); Fleetyard checks the choice again when it launches.
 */

export const MATE_MACHINE_SIZES = [
	{
		id: 'small',
		label: 'Small',
		vcpu: 2,
		memoryGb: 4,
		diskGb: 40,
		fits: 'A second mate and a couple of crew at a time.'
	},
	{
		id: 'medium',
		label: 'Medium',
		vcpu: 4,
		memoryGb: 8,
		diskGb: 60,
		fits: 'A busy second mate with several crew.'
	},
	{
		id: 'large',
		label: 'Large',
		vcpu: 8,
		memoryGb: 16,
		diskGb: 80,
		fits: 'Heavy builds and many crew in parallel.'
	}
] as const;

export const MATE_MACHINE_REGIONS = [
	{ id: 'us-east-1', label: 'US East', where: 'N. Virginia', open: true },
	{ id: 'eu-west-1', label: 'Europe', where: 'Ireland', open: false },
	{ id: 'eu-central-1', label: 'Europe', where: 'Frankfurt', open: false }
] as const;

export type MateMachineSize = (typeof MATE_MACHINE_SIZES)[number]['id'];

export const isMateMachineSize = (value: unknown): value is MateMachineSize =>
	MATE_MACHINE_SIZES.some((size) => size.id === value);

export const isOpenMateMachineRegion = (value: unknown): value is string =>
	MATE_MACHINE_REGIONS.some((region) => region.id === value && region.open);
