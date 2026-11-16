<script lang="ts">
	import { onMount } from 'svelte';
	import { currentFleet } from '$lib/client/live.svelte';
	import type { Project } from '$lib/types';
	import { FLEETYARD_IMAGE_RUNTIME_IDS, SECOND_MATE_RUNTIMES } from '$lib/second-mate-runtimes';
	import { mateNameSlug } from '$lib/mate-name';
	import {
		ArrowLeft,
		ArrowRight,
		Check,
		ExternalLink,
		LoaderCircle,
		Plus,
		RefreshCw
	} from '@lucide/svelte';

	const FLEETYARD_SIGN_IN_COPY =
		'Fleetyard opens its own sign-in page. Sign in with GitHub, then approve this Wheelhouse computer with your passkey. Wheelhouse never asks you to paste a key or token.';
	// Keep this disabled until Fleetyard offers a safe credential-transfer contract.
	const GATEWAY_CREDENTIAL_SYNC_ENABLED = false;
	const fleet = $derived(currentFleet());
	const projects = $derived(fleet?.projects ?? []);
	const runtimes = SECOND_MATE_RUNTIMES;

	type SshKey = { id: string; label: string };
	type MateMachine = {
		id: string;
		name: string;
		slug: string;
		state: string;
		phase: string;
		reachable: boolean;
		keysReady: boolean;
		matesRefused: string | null;
		targetFingerprint: string | null;
		size: string;
		region: string;
		runtimes: string[] | null;
	};
	type CloudDevice = { id: string; gateway: string } | null;
	type CloudPairing = {
		gateway: string;
		verificationUri: string;
		userCode: string;
		fingerprint: string;
		expiresAt: string;
		error: string | null;
	} | null;
	type SetupData = {
		gateway: string;
		cloud: { gateway: string; device: CloudDevice; pairing?: CloudPairing };
		machines: MateMachine[];
		machineError: string | null;
		sshKeys: SshKey[];
		vaultNames: string[];
	};

	let data = $state<SetupData | null>(null);
	let branch = $state<'gateway' | 'ssh'>('gateway');
	let step = $state(0);
	let busy = $state(false);
	let error = $state('');
	let notice = $state('');
	let selectedMachineId = $state('');
	let selectedSshKey = $state('');
	let approvalUrl = $state('');
	let approvalPrepared = $state(false);
	let sshTestStatus = $state<'idle' | 'waiting' | 'ok' | 'fail'>('idle');
	let sshTestReply = $state('');
	let sshTestRequestId = $state('');
	let sshTestSnapshot = $state('');
	let sshRuntimeHarnesses = $state<string[] | null>(null);
	let sshPollBusy = false;
	let host = $state('');
	let user = $state('');
	let name = $state('');
	let charter = $state('');
	let runtimeId = $state<(typeof runtimes)[number]['id']>('claude-sonnet');
	let selectedProjects = $state<string[]>([]);
	let syncRuntime = $state(true);
	let syncLogin = $state(false);
	let syncVault = $state<string[]>([]);
	let launchReceipt = $state('');
	let completed = $state(false);
	let launchAttempt = $state<{
		launchRequestId: string;
		messageRequestId: string;
		expiresAt: number;
	} | null>(null);
	let pairTimer: ReturnType<typeof setInterval> | null = null;
	let machineTimer: ReturnType<typeof setInterval> | null = null;
	let sshTestTimer: ReturnType<typeof setInterval> | null = null;

	const selectedMachine = $derived(
		data?.machines.find((machine) => machine.id === selectedMachineId) ?? null
	);
	const availableRuntimes = $derived(
		branch === 'ssh'
			? sshRuntimeHarnesses === null
				? runtimes
				: runtimes.filter((item) => sshRuntimeHarnesses!.includes(item.runtime.harness))
			: !selectedMachine || selectedMachine.runtimes === null
				? runtimes.filter((item) => FLEETYARD_IMAGE_RUNTIME_IDS.includes(item.id))
				: runtimes.filter((item) => selectedMachine.runtimes!.includes(item.id))
	);
	const selectedRuntime = $derived(
		availableRuntimes.find((runtime) => runtime.id === runtimeId) ?? availableRuntimes[0] ?? runtimes[0]
	);
	const gatewayPaired = $derived(!!data?.cloud.device);
	const gatewayReady = $derived(!!selectedMachine?.reachable && !!selectedMachine?.keysReady);
	const showSyncStep = $derived(branch === 'ssh' || GATEWAY_CREDENTIAL_SYNC_ENABLED);

	$effect(() => {
		if (!availableRuntimes.some((item) => item.id === runtimeId)) {
			runtimeId = availableRuntimes[0]?.id ?? runtimes[0].id;
		}
	});

	onMount(() => {
		void refresh(true);
		return () => {
			if (pairTimer) clearInterval(pairTimer);
			if (machineTimer) clearInterval(machineTimer);
			if (sshTestTimer) clearInterval(sshTestTimer);
		};
	});

	async function refresh(includeVault = false) {
		try {
			const response = await fetch(`/api/second-mate-setup${includeVault ? '?vault=1' : ''}`, {
				cache: 'no-store'
			});
			const body = (await response.json()) as SetupData & { message?: string };
			if (!response.ok) throw new Error(body.message ?? 'Could not read setup status.');
			const retainedVault = data?.vaultNames ?? [];
			data = { ...body, vaultNames: includeVault ? body.vaultNames : retainedVault };
			if (!selectedMachineId && body.machines[0]) selectedMachineId = body.machines[0].id;
			if (!selectedSshKey && body.sshKeys[0]) selectedSshKey = body.sshKeys[0].id;
			if (gatewayPaired && pairTimer) {
				clearInterval(pairTimer);
				pairTimer = null;
			}
			if (selectedMachine?.reachable && selectedMachine.keysReady && machineTimer) {
				clearInterval(machineTimer);
				machineTimer = null;
				notice = 'This computer is trusted and the machine is ready.';
			}
		} catch (e) {
			error = (e as Error).message;
		}
	}

	async function post(action: string, fields: Record<string, unknown> = {}) {
		const response = await fetch('/api/second-mate-setup', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ action, ...fields })
		});
		const body = (await response.json().catch(() => ({}))) as {
			message?: string;
			[key: string]: unknown;
		};
		if (!response.ok) throw new Error(body.message ?? `Setup request failed (${response.status}).`);
		return body;
	}

	async function startPairing() {
		busy = true;
		error = '';
		notice = '';
		try {
			await post('pair', {
				gateway: data?.cloud.device?.gateway ?? data?.cloud.gateway ?? 'https://fleetyard.io'
			});
			await refresh();
			if (!gatewayPaired) {
				pairTimer ??= setInterval(() => void refresh(), 3000);
				notice = 'Waiting for you to approve the pairing in Fleetyard.';
			}
		} catch (e) {
			error = (e as Error).message;
		} finally {
			busy = false;
		}
	}

	function sshSnapshot() {
		return JSON.stringify({ host: host.trim(), user: user.trim(), key: selectedSshKey });
	}

	function resetSshTest() {
		if (sshTestStatus === 'idle') return;
		if (sshTestTimer) clearInterval(sshTestTimer);
		sshTestTimer = null;
		sshTestStatus = 'idle';
		sshTestReply = '';
		sshTestRequestId = '';
		sshTestSnapshot = '';
		sshRuntimeHarnesses = null;
	}

	async function testSshConnection() {
		if (!host.trim() || !user.trim() || !selectedSshKey) {
			error = 'Enter the SSH host and user, then choose an existing key.';
			return;
		}
		busy = true;
		error = '';
		notice = '';
		sshTestStatus = 'waiting';
		sshTestReply =
			'Firstmate is checking the host and verifying its SSH identity. Nothing will be launched during this check.';
		sshTestRequestId = crypto.randomUUID();
		sshTestSnapshot = sshSnapshot();
		try {
			await post('test-ssh', {
				machine: host.trim(),
				user: user.trim(),
				sshKeyId: selectedSshKey,
				requestId: sshTestRequestId
			});
			sshTestTimer ??= setInterval(() => void checkSshTestReply(), 3000);
			void checkSshTestReply();
		} catch (e) {
			sshTestStatus = 'fail';
			sshTestReply = (e as Error).message;
		} finally {
			busy = false;
		}
	}

	async function checkSshTestReply() {
		if (sshPollBusy || !sshTestRequestId) return;
		sshPollBusy = true;
		try {
			const response = await fetch('/api/firstmate/messages', { cache: 'no-store' });
			if (!response.ok) return;
			const view = (await response.json()) as {
				messages?: { requestId: string; reply?: { body: string } | null }[];
			};
			const reply = view.messages?.find((message) => message.requestId === sshTestRequestId)?.reply
				?.body;
			if (!reply) return;
			sshTestReply = reply;
			sshTestStatus = /^SSH_CHECK:\s*OK\b/m.test(reply) ? 'ok' : 'fail';
			if (sshTestStatus === 'ok') {
				const match = reply.match(/^RUNTIMES:\s*(.+)$/m);
				const listed = match?.[1].trim().toLowerCase() ?? '';
				const harnesses = listed && listed !== 'none' ? listed.split(',').map((s) => s.trim()) : [];
				sshRuntimeHarnesses = harnesses;
				const narrowed = runtimes.filter((item) => harnesses.includes(item.runtime.harness));
				const pi = narrowed.find((item) => item.id === 'pi-default');
				runtimeId = pi
					? pi.id
					: (narrowed.find((item) => item.id === runtimeId)?.id ?? narrowed[0]?.id ?? runtimes[0].id);
			}
			if (sshTestTimer) clearInterval(sshTestTimer);
			sshTestTimer = null;
		} catch (e) {
			sshTestReply = (e as Error).message;
			sshTestStatus = 'fail';
			if (sshTestTimer) clearInterval(sshTestTimer);
			sshTestTimer = null;
		} finally {
			sshPollBusy = false;
		}
	}

	async function refreshMachines() {
		busy = true;
		error = '';
		try {
			await refresh();
			notice = 'Fleetyard machine list refreshed.';
		} finally {
			busy = false;
		}
	}

	async function prepareApproval() {
		if (!selectedMachine || !selectedSshKey) return;
		busy = true;
		error = '';
		try {
			const result = await post('offer-ssh-key', {
				machineId: selectedMachine.id,
				keyId: selectedSshKey
			});
			approvalUrl = String(result.approve ?? '');
			approvalPrepared = true;
			notice =
				'Open the FleetYard approval page and approve this computer for the selected machine with your passkey. Then return and refresh.';
			await refresh();
		} catch (e) {
			error = (e as Error).message;
		} finally {
			busy = false;
		}
	}

	async function startSelectedMachine() {
		if (!selectedMachine) return;
		busy = true;
		error = '';
		try {
			if (selectedMachine.state === 'stopped') {
				await post('start-machine', { machineId: selectedMachine.id });
				notice = `Starting ${selectedMachine.name}. Keep this page open while Fleetyard brings it online.`;
			} else {
				await post('machine-status', { machineId: selectedMachine.id });
				notice = `Checking ${selectedMachine.name} with Fleetyard.`;
			}
			await refresh();
			machineTimer ??= setInterval(() => void refresh(), 3000);
		} catch (e) {
			error = (e as Error).message;
		} finally {
			busy = false;
		}
	}

	function moveNext() {
		error = '';
		notice = '';
		if (step === 0) step = 1;
		else if (step === 1 && branch === 'ssh' && (!host.trim() || !user.trim() || !selectedSshKey)) {
			error = 'Enter the SSH host and user, then choose an existing key.';
		} else if (
			step === 1 &&
			branch === 'ssh' &&
			(sshTestStatus !== 'ok' || sshTestSnapshot !== sshSnapshot())
		) {
			error = 'Test the SSH connection and verify the host identity before continuing.';
		} else if (step === 1 && branch === 'gateway' && !gatewayReady) {
			error =
				'Finish Fleetyard sign-in, trust this computer with your passkey, and wait for the selected machine to be ready.';
		} else if (step === 1) step = 2;
		else if (step === 2 && (!mateName() || !charter.trim())) {
			error = 'Give the second mate a name and a focus.';
		} else if (step === 2) step = showSyncStep ? 3 : 4;
		else if (step === 3) step = 4;
	}

	function moveBack() {
		error = '';
		notice = '';
		if (step === 4) launchAttempt = null;
		if (step === 4 && !showSyncStep) step = 2;
		else if (step === 4) step = 3;
		else if (step > 0) step--;
	}

	function mateName() {
		return mateNameSlug(name);
	}

	async function launch() {
		if (!mateName()) {
			error = 'Give this second mate a name using letters or numbers.';
			return;
		}
		busy = true;
		error = '';
		notice = '';
		try {
			if (branch === 'ssh') {
				const messageRequestId = launchAttempt?.messageRequestId ?? crypto.randomUUID();
				launchAttempt = { launchRequestId: messageRequestId, messageRequestId, expiresAt: 0 };
				const result = await post('launch-ssh', {
					sshTestRequestId,
					machine: host.trim(),
					user: user.trim(),
					sshKeyId: selectedSshKey,
					name: mateName(),
					charter: charter.trim(),
					runtime: selectedRuntime.runtime,
					projects: selectedProjects,
					sync: {
						runtime: syncRuntime,
						savedLogin: syncRuntime && syncLogin,
						vaultNames: syncVault
					},
					messageRequestId
				});
				launchReceipt = `Request sent to Firstmate (${String((result.message as { delivery?: string } | undefined)?.delivery ?? 'sending')}). Firstmate will use its remote setup and launch commands; nothing asks you to paste a key or password.`;
			} else {
				if (!selectedMachine) throw new Error('Choose a Fleetyard machine.');
				if (!selectedMachine.reachable) {
					await startSelectedMachine();
					if (!selectedMachine?.reachable) {
						throw new Error(
							'The machine is starting. Wait for it to become reachable, then launch again.'
						);
					}
				}
				if (!selectedMachine.keysReady)
					throw new Error(
						'Approve this computer for the machine on Fleetyard with your passkey before launching.'
					);
				const attempt = launchAttempt ?? {
					launchRequestId: crypto.randomUUID(),
					messageRequestId: crypto.randomUUID(),
					expiresAt: Date.now() + 8 * 60_000
				};
				launchAttempt = attempt;
				const result = await post('launch-gateway', {
					machineId: selectedMachine.id,
					name: mateName(),
					charter: charter.trim(),
					projects: selectedProjects,
					runtime: selectedRuntime.runtime,
					...attempt
				});
				const reply = result.result as { status?: string; result?: { state?: string } } | undefined;
				const message = result.message as { error?: string } | undefined;
				launchReceipt = `Fleetyard accepted the signed launch request${reply?.status === 'pending' ? ' and is still preparing the second mate' : ''}. ${message?.error ? `The Firstmate connection request could not be delivered (${message.error}); ask Firstmate in chat to connect this existing home.` : 'Firstmate has been asked to connect this existing home.'} No login or vault values were sent to Fleetyard.`;
			}
			completed = true;
		} catch (e) {
			error = (e as Error).message;
		} finally {
			busy = false;
		}
	}

	function toggleProject(id: string) {
		selectedProjects = selectedProjects.includes(id)
			? selectedProjects.filter((project) => project !== id)
			: [...selectedProjects, id];
	}

	function toggleVault(name: string) {
		syncVault = syncVault.includes(name)
			? syncVault.filter((item) => item !== name)
			: [...syncVault, name];
	}
</script>

<svelte:head><title>Add a second mate · Wheelhouse</title></svelte:head>

<main class="mx-auto max-w-4xl px-4 py-6 sm:px-6 lg:px-10">
	<div class="mb-5 flex items-start justify-between gap-4">
		<div>
			<p class="mono-label">Crew · Second mates</p>
			<h1 class="mt-1 text-2xl">Add a second mate</h1>
			<p class="mt-1 max-w-2xl text-sm text-muted-foreground">
				A few details, then Firstmate will launch and connect its own worker on another host.
			</p>
		</div>
		<a
			href="/second-mates"
			class="rounded-md px-2 py-1 text-sm text-muted-foreground hover:bg-muted">Cancel</a
		>
	</div>

	<ol class="mb-5 grid grid-cols-4 gap-2" aria-label="Setup progress">
		{#each ['Connect', 'About', 'Optional sync', 'Launch'] as label, i (label)}
			<li
				class="border-t-2 pt-2 text-xs {((step === 0 || step === 1) && i === 0) ||
				(step === 2 && i === 1) ||
				(step === 3 && i === 2) ||
				(step === 4 && i === 3)
					? 'border-primary font-semibold text-foreground'
					: i < (step === 2 ? 1 : step === 3 ? 2 : step === 4 ? 3 : 0)
						? 'border-sea text-muted-foreground'
						: 'border-border text-muted-foreground'}"
			>
				<span class="font-mono">0{i + 1}</span>
				{label}
			</li>
		{/each}
	</ol>

	{#if error}
		<div
			class="mb-4 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive"
			role="alert"
		>
			{error}
		</div>
	{/if}
	{#if notice}
		<div class="mb-4 rounded-md border border-primary/30 bg-primary/5 p-3 text-sm" role="status">
			{notice}
		</div>
	{/if}

	{#if completed}
		<section class="surface p-6 text-center sm:p-8" aria-live="polite">
			<div class="mx-auto grid size-12 place-items-center rounded-full bg-sea/10 text-sea">
				<Check class="size-6" />
			</div>
			<p class="mono-label mt-4">Request received</p>
			<h2 class="mt-1 text-xl">{name} is being set up</h2>
			<p class="mx-auto mt-2 max-w-xl text-sm text-muted-foreground">{launchReceipt}</p>
			<div class="mt-5 flex flex-wrap justify-center gap-3">
				<a
					href="/second-mates"
					class="inline-flex h-9 items-center rounded-md bg-primary px-3 text-sm text-primary-foreground"
					>View second mates</a
				>
				<a href="/" class="inline-flex h-9 items-center rounded-md border px-3 text-sm"
					>Open Firstmate chat</a
				>
			</div>
		</section>
	{:else if !data}
		<section
			class="surface flex items-center gap-3 p-5 text-sm text-muted-foreground"
			aria-busy="true"
		>
			<LoaderCircle class="size-4 animate-spin" /> Reading Wheelhouse and Fleetyard setup…
		</section>
	{:else if step === 0}
		<section class="surface p-5 sm:p-7">
			<p class="mono-label">Step 1 · Connect</p>
			<h2 class="mt-1 text-xl">Where should it run?</h2>
			<p class="mt-1 text-sm text-muted-foreground">
				Choose a direct SSH host or a machine on the Fleetyard gateway.
			</p>
			<div class="mt-5 grid gap-3 sm:grid-cols-2">
				<button
					class="rounded-lg border p-4 text-left transition hover:border-primary {branch === 'ssh'
						? 'border-primary bg-primary/5'
						: ''}"
					onclick={() => (branch = 'ssh')}
					aria-pressed={branch === 'ssh'}
				>
					<span class="font-semibold">SSH host</span><span
						class="mt-1 block text-sm text-muted-foreground"
						>Use a host alias and an existing SSH key. Firstmate checks the host identity before
						trusting it.</span
					>
				</button>
				<button
					class="rounded-lg border p-4 text-left transition hover:border-primary {branch ===
					'gateway'
						? 'border-primary bg-primary/5'
						: ''}"
					onclick={() => (branch = 'gateway')}
					aria-pressed={branch === 'gateway'}
				>
					<span class="font-semibold">Fleetyard gateway</span><span
						class="mt-1 block text-sm text-muted-foreground"
						>Sign in in your browser, confirm with a passkey, then choose a machine.</span
					><span class="mt-2 block font-mono text-xs text-muted-foreground"
						>Default · {data.cloud.device?.gateway ?? data.cloud.gateway}</span
					>
				</button>
			</div>
			<div class="mt-6 flex justify-end">
				<button
					class="inline-flex h-9 items-center gap-2 rounded-md bg-primary px-3 text-sm text-primary-foreground"
					onclick={moveNext}>Continue <ArrowRight class="size-4" /></button
				>
			</div>
		</section>
	{:else if step === 1 && branch === 'ssh'}
		<section class="surface p-5 sm:p-7">
			<p class="mono-label">Step 1 · Connect with SSH</p>
			<h2 class="mt-1 text-xl">Connect to an SSH host</h2>
			<p class="mt-1 text-sm text-muted-foreground">
				Use a host alias already configured for SSH and choose one of your existing public keys. No
				password or private-key text is collected.
			</p>
			<div class="mt-5 grid gap-4 sm:grid-cols-2">
				<label class="grid gap-1.5 text-sm font-medium"
					>Host or alias<input
						class="h-10 rounded-md border bg-background px-3 font-normal"
						bind:value={host}
						oninput={resetSshTest}
						placeholder="build-box"
						autocomplete="off"
					/></label
				>
				<label class="grid gap-1.5 text-sm font-medium"
					>SSH user<input
						class="h-10 rounded-md border bg-background px-3 font-normal"
						bind:value={user}
						oninput={resetSshTest}
						placeholder="alex"
						autocomplete="username"
					/></label
				>
				<label class="grid gap-1.5 text-sm font-medium sm:col-span-2"
					>Existing SSH key
					<select
						class="h-10 rounded-md border bg-background px-3 font-normal"
						bind:value={selectedSshKey}
						onchange={resetSshTest}
					>
						<option value="">Choose a key…</option>
						{#each data.sshKeys as key (key.id)}<option value={key.id}
								>{key.label} · {key.id}</option
							>{/each}
					</select>
					{#if !data.sshKeys.length}<span class="text-xs text-warning"
							>No existing public keys were found under ~/.ssh. Add a key there, then reload this
							page.</span
						>{/if}
				</label>
			</div>
			<div class="mt-4 rounded-md bg-muted/50 p-3 text-sm text-muted-foreground">
				<strong class="text-foreground">First connection?</strong> Firstmate will check the connection
				and host identity before it launches. If the host key changed, setup must stop so you can verify
				it.
			</div>
			<div class="mt-4 flex flex-wrap items-center gap-3">
				<button
					class="inline-flex h-9 items-center gap-2 rounded-md border px-3 text-sm"
					onclick={testSshConnection}
					disabled={busy || !host.trim() || !user.trim() || !selectedSshKey}
					>{#if busy}<LoaderCircle class="size-4 animate-spin" />{:else}<RefreshCw
							class="size-4"
						/>{/if} Test connection</button
				>
				{#if sshTestStatus === 'waiting'}<span class="text-xs text-muted-foreground"
						>Waiting for Firstmate’s check…</span
					>{/if}
			</div>
			{#if sshTestStatus === 'ok' || sshTestStatus === 'fail'}
				<div
					class="mt-3 rounded-md border p-3 text-sm {sshTestStatus === 'ok'
						? 'border-sea/40 bg-sea/5'
						: 'border-destructive/40 bg-destructive/5'}"
					role="status"
				>
					<strong
						>{sshTestStatus === 'ok'
							? 'Connection looks good'
							: 'Connection needs attention'}</strong
					>
					<p class="mt-1 whitespace-pre-wrap text-muted-foreground">{sshTestReply}</p>
				</div>
			{/if}
			<div class="mt-6 flex justify-between">
				<button
					class="inline-flex h-9 items-center gap-2 rounded-md border px-3 text-sm"
					onclick={moveBack}><ArrowLeft class="size-4" /> Back</button
				><button
					class="inline-flex h-9 items-center gap-2 rounded-md bg-primary px-3 text-sm text-primary-foreground"
					onclick={moveNext}
					disabled={sshTestStatus !== 'ok' || sshTestSnapshot !== sshSnapshot()}
					>Continue <ArrowRight class="size-4" /></button
				>
			</div>
		</section>
	{:else if step === 1}
		<section class="surface p-5 sm:p-7">
			<p class="mono-label">Step 1 · Fleetyard sign-in and trust</p>
			<h2 class="mt-1 text-xl">Sign in and choose a machine</h2>
			<p class="mt-1 text-sm text-muted-foreground">{FLEETYARD_SIGN_IN_COPY}</p>
			{#if !gatewayPaired}
				<div class="mt-5 rounded-lg border bg-muted/30 p-4">
					{#if data.cloud.pairing?.userCode}
						<p class="font-semibold">Approve this computer</p>
						<p class="mt-1 text-sm text-muted-foreground">
							Open Fleetyard, sign in with GitHub, type this pairing code and confirm the device
							fingerprint with your passkey.
						</p>
						<div class="mt-3 grid gap-3 sm:grid-cols-2">
							<div class="rounded-md border bg-background p-3">
								<span class="block text-xs text-muted-foreground">Pairing code</span><strong
									class="font-mono text-lg tracking-wider">{data.cloud.pairing.userCode}</strong
								>
							</div>
							<div class="rounded-md border bg-background p-3">
								<span class="block text-xs text-muted-foreground"
									>Device fingerprint · verify on Fleetyard</span
								><strong class="font-mono text-sm">{data.cloud.pairing.fingerprint}</strong>
							</div>
						</div>
						<a
							class="mt-3 inline-flex items-center gap-1 text-sm text-primary underline"
							href={data.cloud.pairing.verificationUri}
							target="_blank"
							rel="noopener noreferrer">Open Fleetyard sign-in <ExternalLink class="size-3.5" /></a
						>
						{#if data.cloud.pairing.error}<p class="mt-2 text-sm text-destructive">
								{data.cloud.pairing.error}
							</p>{/if}
					{:else}
						<p class="text-sm">
							Connect this Wheelhouse computer to Fleetyard. You will approve it in the browser with
							a passkey.
						</p>
						<button
							class="mt-3 inline-flex h-9 items-center gap-2 rounded-md bg-primary px-3 text-sm text-primary-foreground"
							onclick={startPairing}
							disabled={busy}
							>{#if busy}<LoaderCircle class="size-4 animate-spin" />{:else}<ExternalLink
									class="size-4"
								/>{/if} Start Fleetyard sign-in</button
						>
					{/if}
				</div>
			{:else}
				<div
					class="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-sea/5 p-3"
				>
					<p class="text-sm">
						<strong>{data.cloud.device?.gateway}</strong> · This computer is paired with Fleetyard.
					</p>
					<button
						class="inline-flex h-8 items-center gap-2 rounded-md border px-3 text-sm"
						onclick={refreshMachines}
						disabled={busy}><RefreshCw class="size-3.5" /> Refresh machines</button
					>
				</div>
				{#if data.machineError}<p class="mt-3 text-sm text-destructive" role="alert">
						{data.machineError}
					</p>{/if}
				{#if data.machines.length}
					<fieldset class="mt-4 grid gap-2">
						<legend class="mb-2 text-sm font-semibold">Choose a machine</legend>
						{#each data.machines as machine (machine.id)}
							<label
								class="flex cursor-pointer items-start gap-3 rounded-lg border p-3 {selectedMachineId ===
								machine.id
									? 'border-primary bg-primary/5'
									: ''}"
							>
								<input
									type="radio"
									name="gateway-machine"
									value={machine.id}
									bind:group={selectedMachineId}
									class="mt-1 accent-primary"
								/>
								<span class="min-w-0 flex-1"
									><strong class="block">{machine.name}</strong><span
										class="block text-xs text-muted-foreground"
										>{machine.phase} · {machine.size} · {machine.region}{machine.keysReady
											? ' · trusted'
											: ' · needs passkey approval'}</span
									>{#if machine.targetFingerprint}<span
											class="mt-1 block font-mono text-[11px] text-muted-foreground"
											>Device fingerprint · {machine.targetFingerprint}</span
										>{/if}{#if machine.matesRefused}<span
											class="mt-1 block text-xs text-destructive"
											>Fleetyard says: {machine.matesRefused}</span
										>{/if}</span
								>
							</label>
						{/each}
					</fieldset>
					{#if selectedMachine && !selectedMachine.keysReady}
						<div class="mt-4 rounded-lg border border-warning/40 bg-warning/5 p-4">
							<p class="font-semibold">Trust this computer with a passkey</p>
							<p class="mt-1 text-sm text-muted-foreground">
								Fleetyard does not authorize a new machine connection by itself. Choose an existing
								SSH key, then approve it for this machine in Fleetyard. Offering a key replaces the
								SSH key currently linked to this Wheelhouse device.
							</p>
							<div class="mt-3 flex flex-col gap-2 sm:flex-row">
								<select
									class="h-9 min-w-0 flex-1 rounded-md border bg-background px-3 text-sm"
									bind:value={selectedSshKey}
									aria-label="Existing SSH key"
								>
									<option value="">Choose an existing SSH key…</option>
									{#each data.sshKeys as key (key.id)}<option value={key.id}
											>{key.label} · {key.id}</option
										>{/each}
								</select>
								<button
									class="inline-flex h-9 items-center justify-center gap-2 rounded-md border px-3 text-sm"
									onclick={prepareApproval}
									disabled={busy || !selectedSshKey}
									>{#if busy}<LoaderCircle class="size-4 animate-spin" />{:else}<Check
											class="size-4"
										/>{/if} Prepare approval</button
								>
							</div>
							{#if approvalPrepared && approvalUrl}<a
									class="mt-3 inline-flex items-center gap-1 text-sm text-primary underline"
									href={approvalUrl}
									target="_blank"
									rel="noopener noreferrer"
									>Approve with your Fleetyard passkey <ExternalLink class="size-3.5" /></a
								>{/if}
							<button class="mt-2 block text-sm text-primary underline" onclick={refreshMachines}
								>I approved it · check again</button
							>
							{#if !data.sshKeys.length}<p class="mt-2 text-xs text-warning">
									No existing public keys were found under ~/.ssh.
								</p>{/if}
						</div>
					{:else if selectedMachine && !selectedMachine.reachable}
						<div
							class="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3"
						>
							<p class="text-sm text-muted-foreground">
								The selected machine is {selectedMachine.state}. Start it and wait for Fleetyard to
								report it reachable.
							</p>
							<button
								class="inline-flex h-9 items-center gap-2 rounded-md border px-3 text-sm"
								onclick={startSelectedMachine}
								disabled={busy}><RefreshCw class="size-4" /> Start or check</button
							>
						</div>
					{/if}
				{:else}
					<div class="mt-4 rounded-lg border border-dashed p-4">
						<p class="text-sm text-muted-foreground">
							No Fleetyard machines are available yet. Add one there, then return and refresh this
							list.
						</p>
						<a
							class="mt-2 inline-flex items-center gap-1 text-sm text-primary underline"
							href="https://fleetyard.io/machines/new"
							target="_blank"
							rel="noopener noreferrer"
							>Add a machine in Fleetyard <ExternalLink class="size-3.5" /></a
						>
					</div>
				{/if}
			{/if}
			<div class="mt-6 flex justify-between">
				<button
					class="inline-flex h-9 items-center gap-2 rounded-md border px-3 text-sm"
					onclick={moveBack}><ArrowLeft class="size-4" /> Back</button
				><button
					class="inline-flex h-9 items-center gap-2 rounded-md bg-primary px-3 text-sm text-primary-foreground"
					onclick={moveNext}
					disabled={!gatewayReady}>Continue <ArrowRight class="size-4" /></button
				>
			</div>
		</section>
	{:else if step === 2}
		<section class="surface p-5 sm:p-7">
			<p class="mono-label">Step 2 · About</p>
			<h2 class="mt-1 text-xl">Give this second mate a name and a focus</h2>
			<p class="mt-1 text-sm text-muted-foreground">
				Choose a worker profile and only the projects it should work in. {branch === 'ssh' &&
				sshRuntimeHarnesses !== null
					? 'Only runtimes confirmed installed and signed in during the connection check are offered.'
					: 'The host checks its runtime support before setup.'}
			</p>
			<div class="mt-5 grid gap-4 sm:grid-cols-2">
				<label class="grid gap-1.5 text-sm font-medium"
					>Name<input
						class="h-10 rounded-md border bg-background px-3 font-normal"
						bind:value={name}
						placeholder="phoenix"
						autocomplete="off"
					/></label
				>
				<label class="grid gap-1.5 text-sm font-medium"
					>What it looks after<input
						class="h-10 rounded-md border bg-background px-3 font-normal"
						bind:value={charter}
						placeholder="Docket work"
					/></label
				>
				<label class="grid gap-1.5 text-sm font-medium sm:col-span-2"
					>Worker runtime and model
					<select
						class="h-10 rounded-md border bg-background px-3 font-normal"
						bind:value={runtimeId}
						>{#each availableRuntimes as item (item.id)}<option value={item.id}>{item.label}</option
							>{/each}</select
					>
				</label>
			</div>
			<fieldset class="mt-5">
				<legend class="text-sm font-semibold">Selected projects</legend>
				<p class="mt-1 text-xs text-muted-foreground">No project is selected by default.</p>
				{#if projects.length}
					<div class="mt-2 grid gap-2 sm:grid-cols-2">
						{#each projects as project (project.id)}
							<label class="flex items-start gap-2 rounded-md border p-3 text-sm"
								><input
									type="checkbox"
									checked={selectedProjects.includes(project.id)}
									onchange={() => toggleProject(project.id)}
									class="mt-1 accent-primary"
								/><span
									><strong class="block">{project.name}</strong><span
										class="text-xs text-muted-foreground">{project.description ?? project.id}</span
									></span
								></label
							>
						{/each}
					</div>
				{:else}<p class="mt-2 rounded-md bg-muted/40 p-3 text-sm text-muted-foreground">
						Firstmate has no registered projects to select.
					</p>{/if}
			</fieldset>
			<div class="mt-6 flex justify-between">
				<button
					class="inline-flex h-9 items-center gap-2 rounded-md border px-3 text-sm"
					onclick={moveBack}><ArrowLeft class="size-4" /> Back</button
				><button
					class="inline-flex h-9 items-center gap-2 rounded-md bg-primary px-3 text-sm text-primary-foreground"
					onclick={moveNext}>Continue <ArrowRight class="size-4" /></button
				>
			</div>
		</section>
	{:else if step === 3 && showSyncStep}
		<section class="surface p-5 sm:p-7">
			<p class="mono-label">Step 3 · Optional sync</p>
			<h2 class="mt-1 text-xl">Bring over only what it needs</h2>
			<p class="mt-1 text-sm text-muted-foreground">
				Everything here is optional. Sync selections are sent to Firstmate by name only; secret
				values are never shown here.
			</p>
			<div class="mt-5 grid gap-3">
				<label class="flex items-start gap-3 rounded-lg border p-4"
					><input type="checkbox" bind:checked={syncRuntime} class="mt-1 accent-primary" /><span
						><strong class="block text-sm">Set up {selectedRuntime.label}</strong><span
							class="text-xs text-muted-foreground"
							>Prepare this worker runtime on the SSH host. Selected by default.</span
						>{#if syncRuntime}<span class="mt-3 block border-t pt-3"
								><label class="flex items-center gap-2 text-sm"
									><input type="checkbox" bind:checked={syncLogin} class="accent-primary" /> Include its
									saved sign-in</label
								></span
							>{/if}</span
					></label
				>
				<div class="rounded-lg border p-4">
					<strong class="block text-sm">Vault items</strong>
					<p class="mt-1 text-xs text-muted-foreground">
						Choose specific saved names. Secret values are never read into the page or message.
					</p>
					{#if data.vaultNames.length}<div class="mt-3 flex flex-wrap gap-2">
							{#each data.vaultNames as secret (secret)}<label
									class="inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs"
									><input
										type="checkbox"
										checked={syncVault.includes(secret)}
										onchange={() => toggleVault(secret)}
										class="accent-primary"
									/>{secret}</label
								>{/each}
						</div>{:else}<p class="mt-2 text-xs text-muted-foreground">
							No saved vault items are available.
						</p>{/if}
				</div>
			</div>
			<div class="mt-6 flex justify-between">
				<button
					class="inline-flex h-9 items-center gap-2 rounded-md border px-3 text-sm"
					onclick={moveBack}><ArrowLeft class="size-4" /> Back</button
				><button
					class="inline-flex h-9 items-center gap-2 rounded-md bg-primary px-3 text-sm text-primary-foreground"
					onclick={moveNext}>Review launch <ArrowRight class="size-4" /></button
				>
			</div>
		</section>
	{:else}
		<section class="surface p-5 sm:p-7">
			<p class="mono-label">Step 4 · Launch</p>
			<h2 class="mt-1 text-xl">Ready to launch {name || 'your second mate'}</h2>
			<p class="mt-1 text-sm text-muted-foreground">
				Review the choices. Nothing starts until you launch.
			</p>
			<dl class="mt-5 divide-y rounded-lg border px-4">
				<div class="grid grid-cols-[9rem_1fr] gap-3 py-3 text-sm">
					<dt class="text-muted-foreground">Connection</dt>
					<dd class="m-0">
						{branch === 'ssh'
							? `${user || 'user'}@${host || 'host'}`
							: `${selectedMachine?.name ?? 'Fleetyard machine'} · ${selectedMachine?.phase ?? ''}`}
					</dd>
				</div>
				<div class="grid grid-cols-[9rem_1fr] gap-3 py-3 text-sm">
					<dt class="text-muted-foreground">Name</dt>
					<dd class="m-0">{name || 'Not set'}</dd>
				</div>
				<div class="grid grid-cols-[9rem_1fr] gap-3 py-3 text-sm">
					<dt class="text-muted-foreground">Looks after</dt>
					<dd class="m-0">{charter || 'Not set'}</dd>
				</div>
				<div class="grid grid-cols-[9rem_1fr] gap-3 py-3 text-sm">
					<dt class="text-muted-foreground">Worker runtime</dt>
					<dd class="m-0">{selectedRuntime.label}</dd>
				</div>
				<div class="grid grid-cols-[9rem_1fr] gap-3 py-3 text-sm">
					<dt class="text-muted-foreground">Projects</dt>
					<dd class="m-0">
						{selectedProjects.length
							? selectedProjects
									.map((id) => projects.find((project: Project) => project.id === id)?.name ?? id)
									.join(', ')
							: 'None selected'}
					</dd>
				</div>
				{#if branch === 'ssh'}<div class="grid grid-cols-[9rem_1fr] gap-3 py-3 text-sm">
						<dt class="text-muted-foreground">Optional sync</dt>
						<dd class="m-0">
							{syncRuntime
								? `Runtime${syncLogin ? ' and saved login' : ''}`
								: 'Runtime setup skipped'}{syncVault.length
								? ` · ${syncVault.length} vault item${syncVault.length === 1 ? '' : 's'}`
								: ''}
						</dd>
					</div>{/if}
			</dl>
			{#if branch === 'gateway'}<p
					class="mt-4 rounded-md bg-muted/40 p-3 text-sm text-muted-foreground"
				>
					Fleetyard receives the signed runtime and project choices only. Login and vault sync are
					not enabled for Gateway launches; selectedSecretNames is sent as an empty list.
				</p>{/if}
			{#if branch === 'ssh'}<p
					class="mt-4 rounded-md bg-muted/40 p-3 text-sm text-muted-foreground"
				>
					Firstmate will verify the SSH host identity and use its own remote provisioning and launch
					commands. Private key contents and secret values are not included in the request.
				</p>{/if}
			<div class="mt-6 flex justify-between">
				<button
					class="inline-flex h-9 items-center gap-2 rounded-md border px-3 text-sm"
					onclick={moveBack}><ArrowLeft class="size-4" /> Back</button
				><button
					class="inline-flex h-9 items-center gap-2 rounded-md bg-primary px-3 text-sm text-primary-foreground"
					onclick={launch}
					disabled={busy}
					>{#if busy}<LoaderCircle class="size-4 animate-spin" />{:else}<Plus class="size-4" />{/if}
					{branch === 'ssh' ? 'Ask Firstmate to launch' : 'Launch second mate'}</button
				>
			</div>
		</section>
	{/if}

	{#if !completed}<aside class="mt-4 rounded-lg border bg-muted/20 p-4 text-sm">
			<strong>You can also ask Firstmate in chat</strong>
			<p class="mt-1 text-muted-foreground">
				Tell Firstmate where the second mate should run, what it looks after and which projects it
				may use. It will ask before continuing.
			</p>
		</aside>{/if}
</main>
