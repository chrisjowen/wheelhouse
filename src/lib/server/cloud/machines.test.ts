import { createPublicKey, verify } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { newDeviceKey } from './protocol';
import { launchGatewayHome, type GatewayMachine } from './machines';

const MACHINE_ID = '123e4567-e89b-42d3-a456-426614174000';
const REQUEST_ID = '223e4567-e89b-42d3-a456-426614174000';

function signedRequest(
	body: string,
	signature: string,
	publicKey: ReturnType<typeof createPublicKey>
) {
	return verify(null, Buffer.from(body), publicKey, Buffer.from(signature, 'base64url'));
}

describe('Fleetyard whole-home launches', () => {
	it('signs the exact launch intent and always sends an empty selected-secret list', async () => {
		const computer = newDeviceKey();
		const target = newDeviceKey();
		const publicKey = createPublicKey(computer.privateKey);
		const calls: { request: Record<string, unknown>; signature: string }[] = [];
		const fetcher: typeof fetch = async (_input, init) => {
			const outer = JSON.parse(String(init?.body)) as { request: string; sig: string };
			const request = JSON.parse(outer.request) as Record<string, unknown>;
			calls.push({ request, signature: outer.sig });
			return Response.json(
				request.action === 'home.launch' ? { result: { ok: true } } : { ok: true }
			);
		};
		const machine: GatewayMachine = {
			id: MACHINE_ID,
			name: 'Studio runner',
			slug: 'studio-runner',
			state: 'running',
			phase: 'reachable',
			reachable: true,
			ssh: true,
			keysReady: true,
			matesRefused: null,
			deviceKey: target.publicKey,
			targetEncryptionKey: null,
			targetEncryptionKeySig: null,
			plan: 'auto',
			size: 'small',
			region: 'us-east-1',
			runtimes: null
		};

		await launchGatewayHome(
			'https://fleetyard.io',
			'323e4567-e89b-42d3-a456-426614174000',
			computer,
			machine,
			{
				name: 'docs-mate',
				charter: 'Keep the docs in step.',
				projects: ['wheelhouse'],
				runtime: {
					harness: 'claude',
					agent: 'claude',
					model: 'sonnet',
					effort: 'medium',
					provider: 'anthropic'
				},
				requestId: REQUEST_ID,
				expiresAt: Date.now() + 5 * 60_000
			},
			fetcher
		);

		expect(calls.map(({ request }) => request.action)).toEqual(['mate.register', 'home.launch']);
		for (const { request, signature } of calls) {
			expect(
				signedRequest(`whc-machines-v1\n${JSON.stringify(request)}`, signature, publicKey)
			).toBe(true);
		}
		const launch = calls[1]!.request;
		const intent = launch.intent as Record<string, unknown>;
		expect(intent).toMatchObject({
			action: 'launch',
			targetId: MACHINE_ID,
			homeId: 'docs-mate',
			allowedProjectRefs: ['wheelhouse'],
			selectedSecretNames: [],
			requestId: REQUEST_ID
		});
		expect(
			signedRequest(
				`whc-home-intent-v1\n${JSON.stringify(intent)}`,
				String(launch.intentSignature),
				publicKey
			)
		).toBe(true);
	});
});
