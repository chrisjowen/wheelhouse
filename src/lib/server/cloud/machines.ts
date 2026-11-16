import { randomBytes, sign } from 'node:crypto';
import { fingerprint, type DeviceKey } from './protocol';
import { MATE_NAME_PATTERN } from '../../mate-name';

export interface GatewayMachine {
	id: string;
	name: string;
	slug: string;
	state: string;
	phase: string;
	reachable: boolean;
	ssh: boolean | null;
	keysReady: boolean;
	matesRefused: string | null;
	deviceKey: string | null;
	targetEncryptionKey: string | null;
	targetEncryptionKeySig: string | null;
	plan: string;
	size: string;
	region: string;
	runtimes: string[] | null;
}

export interface HomeRuntime {
	harness: string;
	agent: string;
	model: string;
	effort: string;
	provider: string;
}

const b64u = (bytes: Buffer | Uint8Array) => Buffer.from(bytes).toString('base64url');

/** A one-use signed request to Fleetyard's paired-computer machines API. */
export async function gatewayMachinesCall<T = Record<string, unknown>>(
	gateway: string,
	deviceId: string,
	key: DeviceKey,
	action: string,
	fields: Record<string, unknown> = {},
	fetcher: typeof fetch = fetch,
	timeoutMs = 15_000
): Promise<T> {
	const request = JSON.stringify({
		action,
		...fields,
		ts: Date.now(),
		nonce: b64u(randomBytes(18))
	});
	const sig = b64u(sign(null, Buffer.from(`whc-machines-v1\n${request}`), key.privateKey));
	const response = await fetcher(`${gateway}/v1/machines`, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ deviceId, request, sig }),
		redirect: 'error',
		signal: AbortSignal.timeout(timeoutMs)
	});
	const body: unknown = await response.json().catch(() => null);
	if (!response.ok) {
		const detail =
			typeof body === 'object' &&
			body !== null &&
			'message' in body &&
			typeof body.message === 'string'
				? body.message.slice(0, 300)
				: `Fleetyard answered ${response.status}.`;
		throw new Error(detail);
	}
	if (!body || typeof body !== 'object' || Array.isArray(body)) {
		throw new Error('Fleetyard returned an unexpected machines response.');
	}
	return body as T;
}

/** Build and sign the exact typed launch intent accepted by the home-lifecycle API. */
export async function launchGatewayHome(
	gateway: string,
	deviceId: string,
	key: DeviceKey,
	machine: GatewayMachine,
	input: {
		name: string;
		charter: string;
		projects: string[];
		runtime: HomeRuntime;
		requestId: string;
		expiresAt: number;
	},
	fetcher: typeof fetch = fetch
): Promise<Record<string, unknown>> {
	if (!machine.deviceKey) throw new Error('This machine has not reported a device key yet.');
	if (!machine.reachable)
		throw new Error(`${machine.name} must be reachable before a second mate can launch.`);
	if (!machine.keysReady)
		throw new Error(
			`Approve this computer for ${machine.name} with your passkey before launching.`
		);
	if (!MATE_NAME_PATTERN.test(input.name))
		throw new Error('Choose a name that can be used for the second mate home.');
	const homeId = input.name;
	const targetFingerprint = fingerprint(machine.deviceKey);
	const intent = {
		action: 'launch',
		targetId: machine.id,
		homeId,
		allowedProjectRefs: input.projects,
		runtime: input.runtime,
		// Fleetyard's current contract intentionally has no credential-transfer path.
		selectedSecretNames: [],
		targetFingerprint,
		expiresAt: input.expiresAt,
		requestId: input.requestId
	};
	const intentSignature = b64u(
		sign(null, Buffer.from(`whc-home-intent-v1\n${JSON.stringify(intent)}`), key.privateKey)
	);
	await gatewayMachinesCall(
		gateway,
		deviceId,
		key,
		'mate.register',
		{
			machine: machine.id,
			name: input.name.trim(),
			home: homeId,
			charter: input.charter.trim()
		},
		fetcher
	);
	return gatewayMachinesCall(
		gateway,
		deviceId,
		key,
		'home.launch',
		{
			machine: machine.id,
			intent,
			intentSignature
		},
		fetcher,
		45_000
	);
}
