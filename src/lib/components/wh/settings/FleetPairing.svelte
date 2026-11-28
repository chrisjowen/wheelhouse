<script lang="ts">
	import type { CloudPairingView } from '$lib/cloud';

	/** A Join waiting for the captain to approve this ship on the gateway: how to approve it. */
	let { pairing }: { pairing: CloudPairingView } = $props();
</script>

<section aria-labelledby="fleet-pairing-title" role="status" data-testid="fleet-pairing">
	<h3 id="fleet-pairing-title" class="font-medium">Approve this ship on the gateway</h3>
	<ol class="mt-2 list-decimal space-y-1 pl-5 text-sm">
		<li>
			On a device you trust, open <a
				class="break-all underline"
				href={pairing.verificationUri}
				target="_blank"
				rel="noreferrer noopener">{pairing.verificationUri}</a
			> and sign in.
		</li>
		<li>
			Type this one-time code: <code class="tabular rounded bg-muted px-1.5 py-0.5"
				>{pairing.userCode}</code
			>
		</li>
		<li>
			Check the fingerprint reads <code class="tabular">{pairing.fingerprint}</code>, then approve
			with your passkey.
		</li>
	</ol>
	<p class="mt-3 text-xs text-muted-foreground">
		Only approve a Join you started here. Approving lets this gateway reach this ship once you start
		remote access.
	</p>
</section>
