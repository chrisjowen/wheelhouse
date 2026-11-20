import { createPublicKey, verify } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { newDeviceKey, sshShortCode } from './protocol';
import { requestMateMachine } from './machines';

const REQUEST_ID = '223e4567-e89b-42d3-a456-426614174000';
const DEVICE_ID = '323e4567-e89b-42d3-a456-426614174000';
const PUBLIC_KEY =
	'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOMqqnkVzrm0SdG6UOoqKLsabgH5C9okWi0dh2l9GKJl';
const INPUT = {
	requestId: REQUEST_ID,
	name: 'docs-mate',
	charter: 'Keep the docs in step.',
	projects: ['wheelhouse'],
	size: 'small',
	region: 'us-east-1',
	publicKey: PUBLIC_KEY
};

function answering(body: unknown, calls: Record<string, unknown>[] = [], sigs: string[] = []) {
	const fetcher: typeof fetch = async (_input, init) => {
		const outer = JSON.parse(String(init?.body)) as { request: string; sig: string };
		calls.push(JSON.parse(outer.request) as Record<string, unknown>);
		sigs.push(outer.sig);
		return Response.json(body);
	};
	return fetcher;
}

describe('a second mate on a new Fleetyard machine', () => {
	it('signs a mate.machine request that never names an existing machine', async () => {
		const computer = newDeviceKey();
		const calls: Record<string, unknown>[] = [];
		const sigs: string[] = [];
		const result = await requestMateMachine(
			'https://fleetyard.io',
			DEVICE_ID,
			computer,
			INPUT,
			answering(
				{
					launch: { id: 'l1', requestId: REQUEST_ID, state: 'pending', phase: 'approve' },
					approve: 'https://fleetyard.io/mates/launch/l1',
					machine: null,
					mate: null,
					ssh: null
				},
				calls,
				sigs
			)
		);

		expect(calls[0]).toMatchObject({ action: 'mate.machine', plan: 'auto', ...INPUT });
		expect(calls[0]).not.toHaveProperty('machine');
		expect(
			verify(
				null,
				Buffer.from(`whc-machines-v1\n${JSON.stringify(calls[0])}`),
				createPublicKey(computer.privateKey),
				Buffer.from(sigs[0]!, 'base64url')
			)
		).toBe(true);
		expect(result).toEqual({
			launch: { state: 'pending', phase: 'approve', expiresAt: null, message: null },
			approve: 'https://fleetyard.io/mates/launch/l1',
			machine: null,
			ssh: null
		});
	});

	it('refuses a passkey page on another site', async () => {
		await expect(
			requestMateMachine(
				'https://fleetyard.io',
				DEVICE_ID,
				newDeviceKey(),
				INPUT,
				answering({
					launch: { state: 'pending', phase: 'approve' },
					approve: 'https://evil.example/mates/launch/l1'
				})
			)
		).rejects.toThrow(/unexpected passkey-approval address/);
	});

	it('keeps only a well-formed SSH alias for the launched machine', async () => {
		const launched = (ssh: unknown) =>
			requestMateMachine(
				'https://fleetyard.io',
				DEVICE_ID,
				newDeviceKey(),
				INPUT,
				answering({ launch: { state: 'launched', phase: 'seed' }, ssh })
			);
		expect((await launched({ alias: 'fy-docs-mate', user: 'captain' })).ssh).toEqual({
			alias: 'fy-docs-mate',
			user: 'captain'
		});
		expect((await launched({ alias: 'fy-x; rm -rf ~', user: 'captain' })).ssh).toBeNull();
	});

	it('shows the same SSH short code as Fleetyard', () => {
		expect(sshShortCode(PUBLIC_KEY)).toBe('7A4J RXYL');
	});
});
