<script lang="ts">
	/**
	 * Focus mode's calm mark: a ring of fine gold dots, a rounded square, and a
	 * ship's wheel that materialises in its middle. It is still while nothing
	 * is happening, and moves only while Firstmate or its crew is at work
	 * (`active`), easing in and out: the motion changes every few seconds
	 * among light trails travelling round the ring, one faster trail, a slow
	 * pulse round it and a tide of short glows, while the wheel now and then
	 * turns a little, as if steering. The ring is drawn on a canvas at about
	 * 30 frames a second, only while it is on screen in a visible tab; with
	 * reduced motion it never moves.
	 */
	import { onMount } from 'svelte';

	let {
		size = 260,
		wheel = true,
		active = false
	}: { size?: number; wheel?: boolean; active?: boolean } = $props();

	let canvas = $state<HTMLCanvasElement | null>(null);
	const uid = $props.id();
	const gold = `helm-gold-${uid}`;
	/** The wheel's heading, in degrees: it turns now and then while work is under way. */
	let steer = $state(0);
	let still = $state(false);
	// Read inside the drawing loop, which runs outside Svelte's tracking.
	let working = false;
	$effect(() => {
		working = active;
		wake?.();
	});
	let wake: (() => void) | null = null;

	// The ring's dots: a fixed random scatter across and along the outline, so it reads as particles.
	const N = 520;
	const rand = (i: number, k: number) => {
		const x = Math.sin(i * 12.9898 + k * 78.233) * 43758.5453;
		return x - Math.floor(x);
	};
	const dots = Array.from({ length: N }, (_, i) => ({
		a: ((i + rand(i, 1)) / N) * Math.PI * 2,
		off: (rand(i, 2) + rand(i, 3) - 1) * 0.7,
		size: 0.6 + rand(i, 4) * 0.9,
		base: 0.12 + rand(i, 5) * 0.3
	}));
	const TAU = Math.PI * 2;
	/** How far behind a glow a dot is, along the ring (0 at the glow, growing back along its trail). */
	const behind = (a: number, head: number) => (((head - a) % TAU) + TAU) % TAU;

	/** The ways the ring moves while work is under way; one at a time, changing every few seconds. */
	type Mood = 'trails' | 'chase' | 'pulse' | 'tide';
	const MOODS: Mood[] = ['trails', 'chase', 'pulse', 'tide'];
	/** Where the glows are in a mood, at time t (radians round the ring). */
	const headsOf = (m: Mood, t: number): number[] =>
		m === 'trails'
			? [t * 0.85, t * 0.85 + Math.PI]
			: m === 'chase'
				? [t * 1.6]
				: m === 'tide'
					? [0, 1, 2, 3].map((k) => t * 0.45 + (k * TAU) / 4)
					: [];
	/** How lit a dot is in a mood (0 to 1). */
	function litIn(m: Mood, a: number, t: number): number {
		if (m === 'pulse') return Math.max(0, Math.sin(2 * a - t * 1.4)) ** 6 * 0.7;
		const heads = headsOf(m, t);
		const tail = m === 'chase' ? 0.9 : m === 'tide' ? 0.28 : 0.55;
		let d = Infinity;
		for (const h of heads) d = Math.min(d, behind(a, h));
		return Math.exp(-d / tail);
	}

	onMount(() => {
		const c = canvas;
		const ctx = c?.getContext('2d');
		if (!c || !ctx) return;
		const reduced = matchMedia('(prefers-reduced-motion: reduce)');
		still = reduced.matches;
		let rgb = '232,176,74';
		// Light paper: ink-brass dots and a soft warm glow laid on, not added light.
		let dark = true;
		const readColour = () => {
			dark = document.documentElement.classList.contains('dark');
			const m = getComputedStyle(c).color.match(/\d+(\.\d+)?/g);
			if (m && m.length >= 3) rgb = `${m[0]},${m[1]},${m[2]}`;
		};
		const dpr = Math.min(window.devicePixelRatio || 1, 2);
		c.width = Math.round(size * dpr);
		c.height = Math.round(size * dpr);
		ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
		readColour();

		// The mark's own clock, which runs only as fast as it is awake (energy), so it slows to a stop.
		let t = 2.2;
		let energy = 0;
		let mood: Mood = 'trails';
		let prev: Mood = 'trails';
		let blend = 1;
		let nextMood = 0;
		let nextSteer = 0;

		const draw = () => {
			const s = size;
			const cx = s / 2;
			const cy = s / 2;
			const R = s * 0.36;
			ctx.clearRect(0, 0, s, s);
			const turn = t * 0.07;
			const point = (a: number, wobble: number) => {
				const th = a + turn;
				// A rounded square (a superellipse), breathing a little out of round.
				const base =
					R /
					Math.pow(Math.pow(Math.abs(Math.cos(a)), 4) + Math.pow(Math.abs(Math.sin(a)), 4), 1 / 4);
				const r =
					base * (1 + 0.045 * Math.sin(3 * a + t * 0.55) + 0.03 * Math.sin(2 * a - t * 0.4)) +
					wobble;
				return [cx + Math.cos(th) * r, cy + Math.sin(th) * r] as const;
			};
			for (const d of dots) {
				const lit = energy * (blend * litIn(mood, d.a, t) + (1 - blend) * litIn(prev, d.a, t));
				const spread = s * 0.045 * (1 + lit * 1.2);
				const [x, y] = point(d.a, d.off * spread);
				const alpha = d.base * (0.65 + 0.35 * energy) + lit * 0.85;
				ctx.fillStyle = `rgba(${rgb},${Math.min(1, dark ? alpha : alpha * 1.25)})`;
				const z = d.size * (1 + lit * 0.8);
				ctx.fillRect(x - z / 2, y - z / 2, z, z);
			}
			// A warm glow at the head of each trail, fading in and out with the mood.
			ctx.globalCompositeOperation = dark ? 'lighter' : 'source-over';
			const glows = [
				...headsOf(mood, t).map((h) => [h, blend] as const),
				...headsOf(prev, t).map((h) => [h, 1 - blend] as const)
			];
			for (const [h, w] of glows) {
				const k = energy * w * (mood === 'tide' || prev === 'tide' ? 0.6 : 1);
				if (k < 0.02) continue;
				const [x, y] = point(((h % TAU) + TAU) % TAU, 0);
				const r = s * 0.09;
				const g = ctx.createRadialGradient(x, y, 0, x, y, r);
				g.addColorStop(0, dark ? `rgba(255,236,200,${0.85 * k})` : `rgba(${rgb},${0.5 * k})`);
				g.addColorStop(0.25, `rgba(${rgb},${(dark ? 0.55 : 0.22) * k})`);
				g.addColorStop(1, `rgba(${rgb},0)`);
				ctx.fillStyle = g;
				ctx.fillRect(x - r, y - r, r * 2, r * 2);
			}
			ctx.globalCompositeOperation = 'source-over';
		};

		let raf = 0;
		let last = 0;
		let showing = true;
		let frames = 0;
		const tick = (now: number) => {
			raf = 0;
			if (!showing || document.hidden || reduced.matches) return;
			const dt = last ? Math.min(0.1, (now - last) / 1000) : 0;
			if (now - last < 33) {
				raf = requestAnimationFrame(tick);
				return;
			}
			last = now;
			const target = working ? 1 : 0;
			energy += Math.sign(target - energy) * Math.min(Math.abs(target - energy), dt * 0.6);
			t += dt * energy;
			blend = Math.min(1, blend + dt / 1.6);
			if (working && now > nextMood) {
				prev = mood;
				const others = MOODS.filter((m) => m !== mood);
				mood = others[Math.floor(Math.random() * others.length)];
				blend = 0;
				nextMood = now + 9000 + Math.random() * 7000;
			}
			if (working && now > nextSteer) {
				steer += (Math.random() < 0.5 ? -1 : 1) * (40 + Math.random() * 100);
				nextSteer = now + 6000 + Math.random() * 8000;
			}
			if (++frames % 30 === 0) readColour();
			draw();
			// At rest, it stops drawing until work starts again.
			if (!working && energy === 0) {
				last = 0;
				return;
			}
			raf = requestAnimationFrame(tick);
		};
		const run = () => {
			still = reduced.matches;
			if (reduced.matches) {
				energy = 0;
				readColour();
				draw();
				return;
			}
			if (!raf && showing && !document.hidden && (working || energy > 0)) {
				if (working && !nextMood) {
					nextMood = performance.now() + 9000;
					nextSteer = performance.now() + 2500;
				}
				raf = requestAnimationFrame(tick);
			}
		};
		wake = run;
		const io = new IntersectionObserver((e) => {
			showing = e.some((x) => x.isIntersecting);
			run();
		});
		io.observe(c);
		document.addEventListener('visibilitychange', run);
		reduced.addEventListener('change', run);
		draw();
		run();
		return () => {
			wake = null;
			cancelAnimationFrame(raf);
			io.disconnect();
			document.removeEventListener('visibilitychange', run);
			reduced.removeEventListener('change', run);
		};
	});
</script>

<div
	class="helm-mark relative grid shrink-0 place-items-center"
	style:width="{size}px"
	style:height="{size}px"
	aria-hidden="true"
	data-helm-mark
>
	<canvas bind:this={canvas} class="absolute inset-0 size-full text-gold"></canvas>
	{#if wheel}
		<svg
			viewBox="0 0 100 100"
			class="helm-wheel relative {active ? 'is-active' : ''}"
			style:width="{size * 0.46}px"
			style:rotate={still ? null : `${steer}deg`}
		>
			<defs>
				<linearGradient id={gold} gradientUnits="userSpaceOnUse" x1="10" y1="10" x2="90" y2="90">
					<stop offset="0" style:stop-color="var(--helm-a)" />
					<stop offset="0.5" style:stop-color="var(--helm-b)" />
					<stop offset="1" style:stop-color="var(--helm-c)" />
				</linearGradient>
			</defs>
			<g fill="none" stroke="url(#{gold})" stroke-linecap="round">
				{#each { length: 8 } as _, i (i)}
					<g transform="rotate({i * 45} 50 50)">
						<line x1="50" y1="43" x2="50" y2="8" stroke-width="3.2" />
						<line x1="50" y1="14" x2="50" y2="4" stroke-width="5.6" />
					</g>
				{/each}
				<circle cx="50" cy="50" r="29" stroke-width="5.5" />
				<circle cx="50" cy="50" r="22" stroke-width="2" />
				<circle cx="50" cy="50" r="7.5" stroke-width="4" />
			</g>
			<circle cx="50" cy="50" r="2.6" fill="url(#{gold})" />
		</svg>
	{/if}
</div>

<style>
	/* Light paper: an ink-brass wheel with a soft warm shadow, on a faint warm halo. */
	.helm-mark {
		--helm-a: #c9943a;
		--helm-b: #8f5f17;
		--helm-c: #4a3210;
		--helm-shadow: drop-shadow(0 2px 6px rgb(120 80 20 / 0.28));
		--helm-shine: drop-shadow(0 2px 12px rgb(168 116 18 / 0.38));
		background: radial-gradient(closest-side, rgb(168 116 18 / 0.09), transparent);
	}
	/* Night: a pale gold wheel glowing out of the dark. */
	:global(.dark) .helm-mark {
		--helm-a: #f6e2b8;
		--helm-b: #d9b06a;
		--helm-c: #9c7438;
		--helm-shadow: drop-shadow(0 0 8px rgb(232 176 74 / 0.3));
		--helm-shine: drop-shadow(0 0 18px rgb(232 176 74 / 0.6));
		background: radial-gradient(closest-side, rgb(232 176 74 / 0.06), transparent);
	}
	.helm-wheel {
		filter: var(--helm-shadow);
		transition: rotate 2.6s cubic-bezier(0.45, 0, 0.2, 1);
		animation: helm-in 1.8s cubic-bezier(0.2, 0.7, 0.2, 1) 0.3s both;
	}
	.helm-wheel.is-active {
		animation:
			helm-in 1.8s cubic-bezier(0.2, 0.7, 0.2, 1) 0.3s both,
			helm-glow 6s ease-in-out 2.1s infinite;
	}
	@keyframes helm-in {
		from {
			opacity: 0;
			transform: scale(0.82);
			filter: blur(6px);
		}
		to {
			opacity: 1;
			transform: none;
			filter: blur(0) var(--helm-shadow);
		}
	}
	@keyframes helm-glow {
		50% {
			filter: var(--helm-shine);
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.helm-wheel,
		.helm-wheel.is-active {
			animation: none;
			transition: none;
		}
	}
</style>
