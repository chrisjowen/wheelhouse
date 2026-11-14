<script lang="ts">
	/**
	 * A line's state as a small nautical icon (see LineIcon in ondeck.ts), coloured by
	 * its tone: teal while it runs, gold when it is the captain's, amber or red when
	 * something is wrong. Its words are its accessible label and its tooltip, which
	 * shows quickly on hover and while its line has keyboard focus, so it is never
	 * colour or shape alone. While the work moves it moves too: the ship sails on a
	 * streaming wake, the lighthouse's beam sweeps, the compass needle settles, and
	 * what has gone wrong pulses. `still` keeps it static; so does
	 * prefers-reduced-motion. Beside its own words, `decorative` drops the tooltip and
	 * hides it from screen readers so the state is not read twice.
	 */
	import type { LineState } from '$lib/ondeck';

	let {
		state,
		still = false,
		decorative = false,
		class: cls = ''
	}: { state: LineState; still?: boolean; decorative?: boolean; class?: string } = $props();

	// The ship and the lighthouse move only while their crew is busy; Firstmate is always
	// deciding; what has gone wrong pulses until someone sees to it.
	const live = $derived(
		!still && (state.tone === 'busy' || state.tone === 'danger' || state.icon === 'compass')
	);
</script>

<span class="state {cls}">
	<svg
		viewBox="0 0 24 24"
		role={decorative ? undefined : 'img'}
		aria-label={decorative ? undefined : state.label}
		aria-hidden={decorative || undefined}
		class="state-icon"
		data-icon={state.icon}
		data-tone={state.tone}
		data-live={live || undefined}
	>
		{#if state.icon === 'sailing'}
			<g class="boat">
				<path d="M12 2.5v12" />
				<path d="M12 3.5 18.5 12.5H12" />
				<path d="M10 5.5 5.5 12.5H10z" />
				<path d="M3.5 15h17l-3 3.5h-11z" />
			</g>
			<path
				class="wake"
				d="M2 21.5c1.5 0 1.5-1 3-1s1.5 1 3 1 1.5-1 3-1 1.5 1 3 1 1.5-1 3-1 1.5 1 3 1"
			/>
		{:else if state.icon === 'becalmed'}
			<!-- Sail hanging slack, no wake: flat calm. -->
			<path d="M12 2.5v12" />
			<path d="M12 4c.6 3.6 2.2 6.2 4.8 8.5H12" />
			<path d="M3.5 15h17l-3 3.5h-11z" />
			<path d="M3 21.5h18" />
		{:else if state.icon === 'aground'}
			<!-- Listing on a rock. -->
			<g transform="rotate(-20 12 18)">
				<path d="M12 2.5v12" />
				<path d="M12 3.5 18.5 12.5H12" />
				<path d="M3.5 15h17l-3 3.5h-11z" />
			</g>
			<path d="M2 21.5h11" />
			<path d="m14 21.5 2.5-3.5 2 2 1-1 2.5 2.5" />
		{:else if state.icon === 'anchored'}
			<path d="M12 6v16" />
			<path d="m19 13 2-1a9 9 0 0 1-18 0l2 1" />
			<path d="M9 11h6" />
			<circle cx="12" cy="4" r="2" />
		{:else if state.icon === 'lighthouse'}
			<path class="beam" d="M13.5 7 22 4.5v5z" />
			<path d="M9.5 5.5 12 3l2.5 2.5z" />
			<path d="M10 5.5h4v3h-4z" />
			<path d="M10 8.5 8.5 20.5h7L14 8.5" />
			<path d="M9.3 14.5h5.4" />
			<path d="M5 20.5h14" />
		{:else if state.icon === 'danger'}
			<!-- An isolated-danger buoy: two balls for its topmark. -->
			<circle class="solid" cx="12" cy="3.6" r="1.6" />
			<circle class="solid" cx="12" cy="7.6" r="1.6" />
			<path d="M12 9.5v2" />
			<path d="M8.5 19.5 10 11.5h4l1.5 8z" />
			<path d="M9.3 15.5h5.4" />
			<path d="M3 21.5h18" />
		{:else if state.icon === 'flag'}
			<path d="M6 21.5V2.5" />
			<path class="tint" d="M6 3.5h12.5L15 8l3.5 4.5H6" />
			<path d="M3.5 21.5h5" />
		{:else if state.icon === 'spyglass'}
			<path
				d="m10.065 12.493-6.18 1.318a.934.934 0 0 1-1.108-.702l-.537-2.15a1.07 1.07 0 0 1 .691-1.265l13.504-4.44"
			/>
			<path d="m13.56 11.747 4.332-.924" />
			<path d="m16 21-3.105-6.21" />
			<path
				d="M16.485 5.94a2 2 0 0 1 1.455-2.425l1.09-.272a1 1 0 0 1 1.212.727l1.515 6.06a1 1 0 0 1-.727 1.213l-1.09.272a2 2 0 0 1-2.425-1.455z"
			/>
			<path d="m6.158 8.633 1.114 4.456" />
			<path d="m8 21 3.105-6.21" />
			<circle cx="12" cy="13" r="2" />
		{:else if state.icon === 'compass'}
			<circle cx="12" cy="12" r="10" />
			<path
				class="needle"
				d="m16.24 7.76-1.804 5.411a2 2 0 0 1-1.265 1.265L7.76 16.24l1.804-5.411a2 2 0 0 1 1.265-1.265z"
			/>
		{:else if state.icon === 'buoy'}
			<!-- A mooring buoy, waiting for a ship. -->
			<circle cx="12" cy="7" r="1.6" />
			<path d="M12 8.6V11" />
			<path d="M6.5 17a5.5 5.5 0 0 1 11 0z" />
			<path d="M3 17h18" />
			<path d="M7 20.5h10" />
		{:else if state.icon === 'moored'}
			<!-- Made fast to a bollard on the quay. -->
			<path d="M8 3v11.5" />
			<path d="M8 4 13 12.5H8" />
			<path d="M2 15h13l-2.5 3.5h-8z" />
			<path d="M15 15c1.6 1.2 3 1.2 4.2-.2" />
			<path d="M17.5 13h4" />
			<path d="M19.5 13v8.5" />
			<path d="M2 21.5h22" />
		{/if}
	</svg>
	{#if !decorative}<span class="tip" aria-hidden="true">{state.label}</span>{/if}
</span>

<style>
	.state {
		position: relative;
		display: inline-flex;
	}
	.state-icon {
		width: 100%;
		height: 100%;
		fill: none;
		stroke: currentColor;
		stroke-width: 1.75;
		stroke-linecap: round;
		stroke-linejoin: round;
		color: var(--teal);
	}
	.state-icon[data-tone='sea'] {
		color: var(--gold);
	}
	.state-icon:is([data-tone='quiet'], [data-tone='muted']) {
		color: var(--muted-foreground);
	}
	.state-icon[data-tone='danger'] {
		color: var(--danger);
	}
	.state-icon[data-tone='warning'] {
		color: var(--amber);
	}
	.state-icon[data-tone='success'] {
		color: var(--success);
	}
	.solid {
		fill: currentColor;
		stroke: none;
	}
	.tint {
		fill: currentColor;
		fill-opacity: 0.22;
	}
	.beam {
		fill: currentColor;
		fill-opacity: 0.4;
		stroke: none;
	}
	.state-icon:not([data-live]) .beam {
		fill-opacity: 0.2;
	}

	/* The tooltip: the app's (dark on light, light on dark), quick to show, beside the icon. */
	.tip {
		position: absolute;
		top: 50%;
		left: calc(100% + 0.5rem);
		z-index: 50;
		padding: 0.25rem 0.6rem;
		border-radius: 0.375rem;
		background: var(--foreground);
		color: var(--background);
		font-size: 0.75rem;
		line-height: 1rem;
		font-weight: 500;
		white-space: nowrap;
		pointer-events: none;
		opacity: 0;
		transform: translate(-0.25rem, -50%);
		transition:
			opacity 120ms ease-out,
			transform 120ms ease-out;
	}
	.tip::before {
		content: '';
		position: absolute;
		top: 50%;
		left: -0.25rem;
		width: 0.5rem;
		height: 0.5rem;
		border-radius: 1px;
		background: inherit;
		transform: translateY(-50%) rotate(45deg);
	}
	.state:hover .tip,
	:global(:focus-visible) > .state .tip {
		opacity: 1;
		transform: translate(0, -50%);
		transition-delay: 80ms;
	}

	/* Moving work: the ship sails on a streaming wake, the beam sweeps, the needle settles. */
	.boat,
	.beam,
	.needle {
		transform-box: view-box;
	}
	[data-live] .boat {
		transform-origin: 12px 18px;
		animation: pitch 1.6s ease-in-out infinite;
	}
	[data-live] .wake {
		stroke-dasharray: 3.5 2.5;
		animation: wake 0.6s linear infinite;
	}
	/* What has gone wrong (aground, a failed step) flashes. */
	.state-icon[data-live][data-tone='danger'] {
		animation: flash 1.2s ease-in-out infinite;
	}
	[data-live] .beam {
		transform-origin: 12px 7px;
		animation: sweep 3s ease-in-out infinite;
	}
	[data-live] .needle {
		transform-origin: 12px 12px;
		animation: settle 4s ease-in-out infinite;
	}
	@keyframes pitch {
		0%,
		100% {
			transform: translate(-1px, 0) rotate(-9deg);
		}
		50% {
			transform: translate(1px, -1.6px) rotate(7deg);
		}
	}
	@keyframes flash {
		0%,
		100% {
			opacity: 1;
		}
		50% {
			opacity: 0.3;
		}
	}
	@keyframes wake {
		to {
			stroke-dashoffset: 6;
		}
	}
	@keyframes sweep {
		0%,
		100% {
			transform: scaleX(1);
		}
		50% {
			transform: scaleX(-1);
		}
	}
	@keyframes settle {
		0%,
		100% {
			transform: rotate(-14deg);
		}
		50% {
			transform: rotate(10deg);
		}
	}
	@media (prefers-reduced-motion: reduce) {
		[data-live] :is(.boat, .wake, .beam, .needle),
		.state-icon[data-live][data-tone='danger'] {
			animation: none;
		}
	}
</style>
