import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import path from 'node:path';
import { lstat, readdir, readFile } from 'node:fs/promises';
import { json } from '@sveltejs/kit';
import { DEFAULT_GATEWAY } from '$lib/cloud';
import { fingerprint, sshShortCode, type DeviceKey } from '$lib/server/cloud/protocol';
import { cloudSettings } from '$lib/server/cloud/local';
import { gatewayOrigin } from '$lib/server/cloud/settings';
import { remoteStarter } from '$lib/server/cloud/starter';
import { requestMateMachine, type GatewayMachine } from '$lib/server/cloud/machines';
import { getRuntime } from '$lib/server/runtime';
import { validateSend } from '$lib/server/store/messenger';
import { isSecondMateRuntime, SECOND_MATE_RUNTIMES } from '$lib/second-mate-runtimes';
import { MATE_NAME_PATTERN } from '$lib/mate-name';
import { isMateMachineSize, isOpenMateMachineRegion } from '$lib/mate-machines';
import { NO_STORE, readJson } from '$lib/server/http';
import type { RequestHandler } from './$types';

const MAX_BODY = 16 * 1024;
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SSH_KEY =
	/^(?:ssh-ed25519|ssh-rsa|ecdsa-sha2-nistp256|ecdsa-sha2-nistp384|ecdsa-sha2-nistp521|sk-ssh-ed25519@openssh\.com|sk-ecdsa-sha2-nistp256@openssh\.com) [A-Za-z0-9+/]+={0,3}(?: .{0,200})?$/;

interface ExistingSshKey {
	id: string;
	label: string;
	publicKey: string;
}

async function existingSshKeys(): Promise<ExistingSshKey[]> {
	const dir = path.join(homedir(), '.ssh');
	const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
	const keys: ExistingSshKey[] = [];
	for (const entry of entries
		.filter((item) => item.isFile() && item.name.endsWith('.pub'))
		.slice(0, 32)) {
		const file = path.join(dir, entry.name);
		const info = await lstat(file).catch(() => null);
		if (!info?.isFile() || info.size > 16 * 1024) continue;
		const line = (await readFile(file, 'utf8').catch(() => '')).trim().split(/\r?\n/, 1)[0] ?? '';
		if (!SSH_KEY.test(line)) continue;
		const [type, raw, ...comment] = line.split(/\s+/);
		const digest = createHash('sha256')
			.update(Buffer.from(raw!, 'base64'))
			.digest('base64')
			.replace(/=+$/, '');
		keys.push({
			id: `SHA256:${digest}`,
			label: comment.join(' ').trim() || entry.name.slice(0, -4),
			publicKey: `${type} ${raw}`
		});
	}
	return keys;
}

async function pairedComputer() {
	const settings = cloudSettings();
	const { settings: state, error } = await settings.read();
	if (error) throw new Error(error);
	if (!state.device) return { settings, state, key: null };
	const found = await settings.findKey();
	return { settings, state, key: found?.key ?? null };
}

/** What the wizard shows of a machine while it comes up for a second mate. */
function machineSummary(machine: GatewayMachine) {
	return {
		id: machine.id,
		name: machine.name,
		state: machine.state,
		phase: machine.phase,
		reachable: machine.reachable,
		keysReady: machine.keysReady,
		matesRefused: machine.matesRefused,
		targetFingerprint: machine.deviceKey ? fingerprint(machine.deviceKey) : null,
		size: machine.size,
		region: machine.region,
		runtimes: Array.isArray(machine.runtimes)
			? machine.runtimes.filter((id): id is string => typeof id === 'string').slice(0, 20)
			: null
	};
}

export const GET: RequestHandler = async ({ url }) => {
	const view = await remoteStarter().view();
	let deviceError: string | null = null;
	let sshKeys: Pick<ExistingSshKey, 'id' | 'label'>[] = [];
	let vaultNames: string[] = [];
	if (url.searchParams.has('vault')) {
		const runtime = await getRuntime();
		if (runtime.configured) {
			const listed = await runtime.vault
				.list()
				.catch(() => ({ ok: false as const, message: 'Could not read vault names.' }));
			if (listed.ok) vaultNames = listed.secrets.map((secret) => secret.name);
		}
	}
	try {
		const { state, key } = await pairedComputer();
		if (state.device && !key)
			deviceError = 'The Fleetyard device key is missing. Pair this computer again.';
		sshKeys = await existingSshKeys().then((keys) => keys.map(({ id, label }) => ({ id, label })));
	} catch (e) {
		deviceError = (e as Error).message;
	}
	return json(
		{
			gateway: DEFAULT_GATEWAY,
			cloud: view,
			deviceError,
			sshKeys,
			vaultNames
		},
		{ headers: NO_STORE }
	);
};

export const POST: RequestHandler = async ({ request }) => {
	const read = await readJson(request, MAX_BODY);
	if (!read.ok) return read.response;
	const { action } = read.body;
	const refuse = (message: string, status = 400) =>
		json({ message }, { status, headers: NO_STORE });

	if (action === 'pair') {
		const origin =
			typeof read.body.gateway === 'string'
				? gatewayOrigin(read.body.gateway)
				: { ok: true as const, origin: DEFAULT_GATEWAY };
		if (!origin.ok) return refuse(origin.error);
		const current = await pairedComputer();
		if (current.state.device && current.state.device.gateway !== origin.origin) {
			return refuse(
				'This computer is paired with another gateway. Leave its fleet in Settings → Fleet before changing accounts.',
				409
			);
		}
		if (!current.state.device)
			await current.settings.update((settings) => (settings.gateway = origin.origin));
		const result = await remoteStarter().start();
		if (!result.ok) return refuse(result.error, 502);
		return json({ view: await remoteStarter().view() }, { headers: NO_STORE });
	}

	if (action === 'test-ssh') return testSsh(read.body, refuse);
	if (action === 'launch-ssh') return launchSsh(read.body, refuse);

	const computer = await pairedComputer();
	if (!computer.state.device || !computer.key)
		return refuse('Sign in to Fleetyard and approve this computer with your passkey first.', 409);
	if (action === 'create-machine')
		return createMachine(read.body, computer.state.device, computer.key, refuse);

	return refuse('Expected action: pair, create-machine, test-ssh or launch-ssh.');
};

/** Fleetyard phases at which the new machine is reachable over SSH with this computer's key. */
const SEEDABLE = new Set(['seed', 'running']);

/**
 * Launch a second mate on a new Fleetyard machine of its own, or look again at that launch.
 * The wizard repeats this with the same request ids until the machine is up; then Firstmate is
 * asked, once, to seed and start the mate over SSH and connect it.
 */
async function createMachine(
	body: Record<string, unknown>,
	device: { id: string; gateway: string },
	deviceKey: DeviceKey,
	refuse: (message: string, status?: number) => Response
) {
	const { name, charter, projects, size, region, keyId, runtime, requestId, messageRequestId } =
		body;
	if (typeof name !== 'string' || !MATE_NAME_PATTERN.test(name))
		return refuse('Use a short name with lowercase letters, numbers or hyphens.');
	if (typeof charter !== 'string' || !charter.trim() || charter.trim().length > 1000)
		return refuse('Give the second mate a focus of 1000 characters or fewer.');
	if (!isMateMachineSize(size)) return refuse('Choose a machine size.');
	if (!isOpenMateMachineRegion(region)) return refuse('Choose a region that is open.');
	if (!isSecondMateRuntime(runtime)) return refuse('Choose a supported worker runtime.');
	if (
		typeof requestId !== 'string' ||
		!ID.test(requestId) ||
		typeof messageRequestId !== 'string' ||
		!ID.test(messageRequestId)
	)
		return refuse('Refresh the launch review and try again.');
	const app = await getRuntime();
	if (!app.configured || !app.messenger)
		return refuse(
			app.configured
				? (app.collector.health().messaging.reason ?? 'Messaging is not set up.')
				: app.error,
			503
		);
	const knownProjects = new Set(app.collector.getFleet().projects.map((project) => project.id));
	if (!validProjectSelection(projects, knownProjects))
		return refuse('Choose projects Firstmate knows about.');
	const key =
		typeof keyId === 'string'
			? (await existingSshKeys()).find((candidate) => candidate.id === keyId)
			: undefined;
	if (!key)
		return refuse('That SSH key is no longer available. Refresh the list and choose another.', 409);
	let result: Awaited<ReturnType<typeof requestMateMachine>>;
	try {
		result = await requestMateMachine(device.gateway, device.id, deviceKey, {
			requestId: requestId.toLowerCase(),
			name,
			charter: charter.trim(),
			projects,
			size,
			region,
			publicKey: key.publicKey
		});
	} catch (e) {
		return refuse((e as Error).message, 502);
	}
	const { launch, machine, ssh } = result;
	let message: { delivery?: string; error?: string } | null = null;
	if (SEEDABLE.has(launch.phase) && machine && ssh) {
		const text = [
			`Please set up and start the remote second mate ${name} on its new Fleetyard machine of its own that the captain just launched from Wheelhouse and approved with a passkey. This computer's SSH key below is already approved for it.`,
			`Use your own remote second-mate path over \`ssh ${ssh.alias}\` as ${ssh.user}: \`whc-connector ssh-setup ${name} --write\` writes the ssh config, then \`fm-remote-home-seed.sh ${name} ${ssh.alias} /home/${ssh.user}/firstmate /home/${ssh.user}/${name}\` with its projects seeds the home; start it with the runtime below and connect it to this Firstmate. Do not store passwords or ask for pasted keys or tokens; stop and ask if the host identity is unknown or has changed.`,
			'Configuration (JSON):',
			JSON.stringify({
				machineId: machine.id,
				hostAlias: ssh.alias,
				user: ssh.user,
				sshKey: { fingerprint: key.id, label: key.label },
				name,
				charter: charter.trim(),
				projects,
				runtime
			})
		].join('\n');
		const sent = await sendFirstmateMessage(messageRequestId, text);
		message = sent.ok ? { delivery: sent.message.delivery } : { error: sent.error };
	}
	return json(
		{
			launch,
			approve: result.approve,
			sshCode: sshShortCode(key.publicKey),
			machine: machine ? machineSummary(machine) : null,
			message
		},
		{ headers: NO_STORE }
	);
}

async function testSsh(
	body: Record<string, unknown>,
	refuse: (message: string, status?: number) => Response
) {
	const machine = body.machine;
	const user = typeof body.user === 'string' ? body.user.trim() : '';
	const keyId = body.sshKeyId;
	if (typeof machine !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(machine))
		return refuse('Enter an SSH host alias.');
	if (!/^[A-Za-z0-9._-]{1,64}$/.test(user)) return refuse('Enter a valid SSH user.');
	if (typeof keyId !== 'string') return refuse('Choose an existing SSH key.');
	const key = (await existingSshKeys()).find((candidate) => candidate.id === keyId);
	if (!key) return refuse('That SSH key is no longer available. Refresh and choose another.', 409);
	const harnesses = [...new Set(SECOND_MATE_RUNTIMES.map(({ runtime }) => runtime.harness))];
	const text = [
		'Check this proposed SSH connection only; do not seed a home, provision or launch anything yet. Use Firstmate’s own SSH configuration and the selected existing key. Do not change known_hosts or trust an unknown or changed host identity.',
		'If the host is reachable with this key and its identity is already verified, reply with the exact first line `SSH_CHECK: OK` and include the verified host-key fingerprint. Otherwise reply with `SSH_CHECK: FAIL` first and say what must be checked. Never reveal private-key contents.',
		`If the connection succeeds, also check which of these worker runtimes are installed and already signed in on that host: ${harnesses.join(', ')}. Add a line \`RUNTIMES: \` followed by a comma-separated list of the ones that are installed and signed in, or \`RUNTIMES: none\` if none are.`,
		'Connection details (JSON):',
		JSON.stringify({ host: machine, user, sshKey: { fingerprint: key.id, label: key.label } })
	].join('\n');
	const result = await sendFirstmateMessage(body.requestId, text);
	if (!result.ok) return refuse(result.error, result.status);
	return json(
		{ requestId: body.requestId, delivery: result.message.delivery },
		{ status: result.created ? 201 : 200, headers: NO_STORE }
	);
}

async function launchSsh(
	body: Record<string, unknown>,
	refuse: (message: string, status?: number) => Response
) {
	const machine = body.machine;
	const user = typeof body.user === 'string' ? body.user.trim() : '';
	const sshKeyId = body.sshKeyId;
	const name = typeof body.name === 'string' ? body.name.trim() : '';
	const charter = typeof body.charter === 'string' ? body.charter.trim() : '';
	const runtime = body.runtime;
	const projects = body.projects;
	const sync = body.sync;
	const sshTestRequestId = body.sshTestRequestId;
	if (typeof machine !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(machine))
		return refuse('Enter an SSH host alias.');
	if (!/^[A-Za-z0-9._-]{1,64}$/.test(user)) return refuse('Enter a valid SSH user.');
	if (typeof sshKeyId !== 'string') return refuse('Choose an existing SSH key.');
	const selectedKey = (await existingSshKeys()).find((candidate) => candidate.id === sshKeyId);
	if (!selectedKey)
		return refuse('That SSH key is no longer available. Refresh the page and choose another.', 409);
	if (!MATE_NAME_PATTERN.test(name))
		return refuse('Use a short name with lowercase letters, numbers or hyphens.');
	if (!charter || charter.length > 1000)
		return refuse('Give the second mate a focus of 1000 characters or fewer.');
	const app = await getRuntime();
	if (!app.configured || !app.messenger)
		return refuse(
			app.configured
				? (app.collector.health().messaging.reason ?? 'Messaging is not set up.')
				: app.error,
			503
		);
	if (typeof sshTestRequestId !== 'string' || !ID.test(sshTestRequestId))
		return refuse('Run the SSH connection check before launching.');
	const testMessage = app.messenger
		.view()
		.messages.find((message) => message.requestId === sshTestRequestId);
	const expectedCheck = JSON.stringify({
		host: machine,
		user,
		sshKey: { fingerprint: selectedKey.id, label: selectedKey.label }
	});
	if (
		!testMessage?.text.endsWith(expectedCheck) ||
		!testMessage.reply ||
		!/^SSH_CHECK:\s*OK\b/m.test(testMessage.reply.body) ||
		!/SHA256:[A-Za-z0-9+/]{20,}=?/.test(testMessage.reply.body)
	)
		return refuse(
			'Run a successful SSH connection check for this host and key before launching.',
			409
		);
	const knownProjects = new Set(app.collector.getFleet().projects.map((project) => project.id));
	if (!validProjectSelection(projects, knownProjects))
		return refuse('Choose projects Firstmate knows about.');
	if (!isSecondMateRuntime(runtime)) return refuse('Choose a supported worker runtime.');
	if (!sync || typeof sync !== 'object' || Array.isArray(sync))
		return refuse('Choose the SSH sync options.');
	const options = sync as Record<string, unknown>;
	const vaultNames = options.vaultNames;
	if (
		vaultNames !== undefined &&
		(!Array.isArray(vaultNames) ||
			vaultNames.length > 50 ||
			new Set(vaultNames).size !== vaultNames.length ||
			!vaultNames.every(
				(item) => typeof item === 'string' && /^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(item)
			))
	)
		return refuse('Choose valid vault item names.');
	const vault = await app.vault.list();
	if (!vault.ok && Array.isArray(vaultNames) && vaultNames.length)
		return refuse(vault.message, 503);
	const knownVault = new Set(vault.ok ? vault.secrets.map((secret) => secret.name) : []);
	if (Array.isArray(vaultNames) && vaultNames.some((item) => !knownVault.has(item as string)))
		return refuse('A selected vault name is no longer available. Refresh the wizard.');
	const text = [
		'Please set up and launch a remote second mate through SSH using your own remote provisioning and launch commands, including bin/fm-remote-home-seed.sh. This is the captain-approved setup request from Wheelhouse; do not store passwords or ask for pasted keys or tokens.',
		'Do not seed or launch unless a connection test succeeds with the selected key and the host identity is verified. Stop and ask if the host identity is unknown or has changed.',
		'Configuration (JSON):',
		JSON.stringify({
			host: machine,
			user,
			sshKey: { fingerprint: selectedKey.id, label: selectedKey.label },
			name,
			charter,
			runtime,
			projects,
			sync: {
				runtime: options.runtime === true,
				savedLogin: options.runtime === true && options.savedLogin === true,
				vaultNames: Array.isArray(vaultNames) ? vaultNames : []
			}
		})
	].join('\n');
	const result = await sendFirstmateMessage(body.messageRequestId, text);
	if (!result.ok) return refuse(result.error, result.status);
	return json(
		{ message: result.message },
		{ status: result.created ? 201 : 200, headers: NO_STORE }
	);
}

function validProjectSelection(value: unknown, known: ReadonlySet<string>): value is string[] {
	return (
		Array.isArray(value) &&
		value.length <= 20 &&
		new Set(value).size === value.length &&
		value.every(
			(project) =>
				typeof project === 'string' &&
				known.has(project) &&
				/^[A-Za-z0-9][A-Za-z0-9._/-]{0,199}$/.test(project) &&
				!project.includes('..') &&
				!project.includes('//') &&
				!project.endsWith('/')
		)
	);
}

async function sendFirstmateMessage(requestId: unknown, text: string) {
	const runtime = await getRuntime();
	if (!runtime.configured)
		return { ok: false as const, status: 503 as const, error: runtime.error };
	if (!runtime.messenger)
		return {
			ok: false as const,
			status: 503 as const,
			error: runtime.collector.health().messaging.reason ?? 'Messaging is not set up.'
		};
	const valid = validateSend(typeof requestId === 'string' ? requestId : null, text, null);
	if (!valid.ok)
		return {
			ok: false as const,
			status: valid.status === 413 ? (413 as const) : (400 as const),
			error: valid.error
		};
	const result = await runtime.messenger.send(valid.input);
	if (!result.ok) return { ok: false as const, status: result.status, error: result.error };
	return { ok: true as const, created: result.created, message: result.message };
}
