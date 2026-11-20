import { randomBytes, sign } from 'node:crypto';
import type { DeviceKey } from './protocol';

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

export interface MateLaunch {
	state: string;
	phase: string;
	expiresAt: number | null;
	message: string | null;
}

/**
 * Launch a second mate on a brand-new Fleetyard machine of its own (`mate.machine`). Nothing is
 * created until the owner confirms on the returned `approve` page with a passkey; that one
 * confirmation creates the machine and approves this computer's SSH key for it. Re-sending the
 * same request id and fields polls the launch: its phase runs approve → provisioning →
 * connecting → link → seed (reachable over SSH as `ssh.alias`) → running.
 */
export async function requestMateMachine(
	gateway: string,
	deviceId: string,
	key: DeviceKey,
	input: {
		requestId: string;
		name: string;
		charter: string;
		projects: string[];
		size: string;
		region: string;
		publicKey: string;
	},
	fetcher: typeof fetch = fetch
): Promise<{
	launch: MateLaunch;
	approve: string | null;
	machine: GatewayMachine | null;
	ssh: { alias: string; user: string } | null;
}> {
	const result = await gatewayMachinesCall<{
		launch?: Partial<MateLaunch> | null;
		approve?: unknown;
		machine?: GatewayMachine | null;
		ssh?: { alias?: unknown; user?: unknown } | null;
	}>(gateway, deviceId, key, 'mate.machine', { ...input, plan: 'auto' }, fetcher);
	const launch = result.launch;
	if (!launch || typeof launch.state !== 'string' || typeof launch.phase !== 'string')
		throw new Error('Fleetyard returned an unexpected launch response.');
	let approve: string | null = null;
	if (typeof result.approve === 'string') {
		const url = URL.parse(result.approve);
		if (url?.origin !== gateway)
			throw new Error(
				'Fleetyard returned an unexpected passkey-approval address. Stop and check the gateway.'
			);
		approve = url.href;
	}
	const alias = result.ssh?.alias;
	const user = result.ssh?.user;
	return {
		launch: {
			state: launch.state,
			phase: launch.phase,
			expiresAt: typeof launch.expiresAt === 'number' ? launch.expiresAt : null,
			message: typeof launch.message === 'string' ? launch.message.slice(0, 300) : null
		},
		approve,
		machine: result.machine ?? null,
		ssh:
			typeof alias === 'string' &&
			/^fy-[a-z0-9-]{1,60}$/.test(alias) &&
			typeof user === 'string' &&
			/^[a-z_][a-z0-9_-]{0,31}$/.test(user)
				? { alias, user }
				: null
	};
}
