<script lang="ts">
	/**
	 * Live mode's calm mark: a ring of fine gold dots, a rounded square, and a
	 * ship's wheel that materialises in its middle. It is still while nothing
	 * is happening, and moves only while there is something to show (`helm`,
	 * read from the fleet by lib/helm.ts; without it, `active` alone shows the
	 * mood cycle). Each kind of work has its own motion and tint, crossfading
	 * from one to the next:
	 *   mood        light trails, a fast chase, a pulse or a tide round the ring,
	 *               changing every few seconds, the wheel steering now and then
	 *   swell       three crests travel round, the outline rising with them, the
	 *               wheel rocking and a ping widening out from it
	 *   lighthouse  one soft beam goes round, lighting the dots it passes
	 *   lantern     the spokes light in turn and the wheel clicks on a spoke
	 *   pulse       the whole ring breathes, slowly
	 * and a task landing turns the wheel once, a glow on the ring following it
	 * (`flourish`, counted up by the caller). The ring is a canvas drawn at
	 * 24–30 frames a second only for mood, swell, a crossfade or the flourish,
	 * on screen in a visible tab; lighthouse, lantern and pulse are CSS on a
	 * still copy of the ring lit up, run by the compositor. With reduced motion
	 * nothing moves: each shows one still frame of itself.
	 */
	import { onMount } from 'svelte';
	import type { Helm, HelmIdea, HelmTint } from '$lib/helm';

	let {
		size = 260,
		wheel = true,
		active = false,
		helm = null,
		flourish = 0
	}: {
		size?: number;
		wheel?: boolean;
		active?: boolean;
		helm?: Helm | null;
		flourish?: number;
	} = $props();

	const idea = $derived<HelmIdea>(helm?.idea ?? (active ? 'mood' : 'still'));
	const tint = $derived<HelmTint>(helm?.tint ?? 'gold');
	const tempo = $derived(helm?.tempo ?? 1);
	/** How long one look takes to give way to the next. */
	const FADE_MS = 1600;

	let mark = $state<HTMLElement | null>(null);
	let canvas = $state<HTMLCanvasElement | null>(null);
	let litBeam = $state<HTMLCanvasElement | null>(null);
	let litPulse = $state<HTMLCanvasElement | null>(null);
	let litLantern = $state<HTMLCanvasElement | null>(null);
	const uid = $props.id();
	const gold = `helm-gold-${uid}`;
	/** The wheel's heading, in degrees, and how it gets there: eased, a click, or the flourish's spring. */
	let steer = $state(0);
	let steering = $state<'ease' | 'click' | 'spring'>('ease');
	let still = $state(false);

	// The looks still fading out keep running until they are gone; the rest are paused.
	let leaving = $state<HelmIdea[]>([]);
	let lastIdea: HelmIdea = 'still';
	$effect(() => {
		const next = idea;
		if (next === lastIdea) return;
		const gone = lastIdea;
		lastIdea = next;
		leaving = [...leaving.filter((x) => x !== next), gone];
		setTimeout(() => (leaving = leaving.filter((x) => x !== gone)), FADE_MS + 200);
	});
	const runs = (x: HelmIdea) => idea === x || leaving.includes(x);

	// Read inside the drawing loop, which runs outside Svelte's tracking.
	let wake: ((idea: HelmIdea, tint: HelmTint, tempo: number) => void) | null = null;
	let turn: ((at: number) => void) | null = null;
	$effect(() => {
		wake?.(idea, tint, tempo);
	});
	// Speed: every running CSS loop plays at the fleet's tempo, without jumping where it is.
	$effect(() => {
		const rate = tempo;
		void idea;
		void leaving;
		if (typeof CSSAnimation === 'undefined') return;
		// Svelte scopes keyframe names (svelte-<hash>-hl-spin); the looping ones are all hl-.
		for (const a of mark?.getAnimations?.({ subtree: true }) ?? [])
			if (a instanceof CSSAnimation && a.animationName.includes('hl-')) a.updatePlaybackRate(rate);
	});
	// The lantern clicks the wheel round one spoke each time its light comes round.
	$effect(() => {
		if (idea !== 'lantern' || still) return;
		const every = 3200 / tempo;
		const id = setInterval(() => {
			steering = 'click';
			steer += 45;
		}, every);
		return () => clearInterval(id);
	});
	// A task landed: turn the wheel once.
	let lastFlourish: number | null = null;
	$effect(() => {
		const n = flourish;
		const was = lastFlourish;
		lastFlourish = n;
		if (was !== null && n !== was) turn?.(performance.now());
	});

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

	/** The ways the ring moves on the canvas: the mood cycle's four, the swell, or none (still). */
	type Mood = 'trails' | 'chase' | 'pulse' | 'tide';
	type Pattern = Mood | 'swell' | 'none';
	const MOODS: Mood[] = ['trails', 'chase', 'pulse', 'tide'];
	const isMood = (p: Pattern): p is Mood => (MOODS as string[]).includes(p);
	/** Where the glows are in a pattern, at time t (radians round the ring). */
	const headsOf = (m: Pattern, t: number): number[] =>
		m === 'trails'
			? [t * 0.85, t * 0.85 + Math.PI]
			: m === 'chase'
				? [t * 1.6]
				: m === 'tide'
					? [0, 1, 2, 3].map((k) => t * 0.45 + (k * TAU) / 4)
					: [];
	/** The swell's three crests: how high the ring stands at a dot (0 to 1). */
	function crest(a: number, t: number): number {
		let v = 0;
		for (let k = 0; k < 3; k++) {
			const d = behind(a, t * 0.5 + (k * TAU) / 3);
			const near = Math.min(d, TAU - d);
			v = Math.max(v, Math.exp(-((near / 0.42) ** 2)));
		}
		return v;
	}
	/** How lit a dot is in a pattern (0 to 1). */
	function litIn(m: Pattern, a: number, t: number): number {
		if (m === 'none') return 0;
		if (m === 'swell') return crest(a, t) * 0.75;
		if (m === 'pulse') return Math.max(0, Math.sin(2 * a - t * 1.4)) ** 6 * 0.7;
		const heads = headsOf(m, t);
		const tail = m === 'chase' ? 0.9 : m === 'tide' ? 0.28 : 0.55;
		let d = Infinity;
		for (const h of heads) d = Math.min(d, behind(a, h));
		return Math.exp(-d / tail);
	}
	const patternOf = (x: HelmIdea, now: Pattern): Pattern =>
		x === 'mood' ? (isMood(now) ? now : 'trails') : x === 'swell' ? 'swell' : 'none';

	type Rgb = [number, number, number];
	function rgbOf(value: string): Rgb | null {
		const v = value.trim();
		const hex = v.match(/^#([0-9a-f]{6})$/i);
		if (hex) {
			const n = parseInt(hex[1], 16);
			return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
		}
		const m = v.match(/\d+(\.\d+)?/g);
		return m && m.length >= 3 ? [+m[0], +m[1], +m[2]] : null;
	}
	/** The tint each CSS look's lit ring is drawn in: always its look's own (lib/helm.ts). */
	const LIT = { lighthouse: 'amber', pulse: 'red', lantern: 'cool' } as const satisfies Record<
		string,
		HelmTint
	>;
	/** The wheel's spring when a task lands: past the mark a little, then settling. */
	const spring = (p: number) => 1 + 2.3 * (p - 1) ** 3 + 1.3 * (p - 1) ** 2;

	onMount(() => {
		const c = canvas;
		const host = mark;
		const ctx = c?.getContext('2d');
		if (!c || !ctx || !host) return;
		const reduced = matchMedia('(prefers-reduced-motion: reduce)');
		still = reduced.matches;
		const dpr = Math.min(window.devicePixelRatio || 1, 2);
		const prepare = (el: HTMLCanvasElement | null) => {
			const x = el?.getContext('2d');
			if (!el || !x) return null;
			el.width = Math.round(size * dpr);
			el.height = Math.round(size * dpr);
			x.setTransform(dpr, 0, 0, dpr, 0, 0);
			return x;
		};
		prepare(c);
		const lits: [keyof typeof LIT, CanvasRenderingContext2D | null][] = [
			['lighthouse', prepare(litBeam)],
			['pulse', prepare(litPulse)],
			['lantern', prepare(litLantern)]
		];

		// Light paper: ink-coloured dots and a soft glow laid on, not added light.
		let dark = true;
		const tintOf = (name: HelmTint): Rgb =>
			rgbOf(getComputedStyle(host).getPropertyValue(`--tint-${name}`)) ?? [232, 176, 74];

		// The mark's own clock, which runs only as fast as it is awake (energy), so it slows to a stop.
		let t = 2.2;
		let energy = 0;
		let look: HelmIdea = 'still';
		let lookTint: HelmTint = 'gold';
		let pace = 1;
		let cur: Pattern = 'none';
		let prev: Pattern = 'none';
		let blend = 1;
		let toColour: Rgb = tintOf('gold');
		let fromColour: Rgb = toColour;
		let shade = 1;
		let nextMood = 0;
		let nextSteer = 0;
		let fl: { start: number; from: number; to: number } | null = null;
		let flGlow = 0;
		let flHead = 0;
		let flDir = 1;

		const ink = (): Rgb =>
			[0, 1, 2].map((i) =>
				Math.round(fromColour[i] + (toColour[i] - fromColour[i]) * shade)
			) as Rgb;

		const paint = (
			x: CanvasRenderingContext2D,
			rgb: Rgb,
			o: { energy: number; lit?: boolean; glow?: number }
		) => {
			const s = size;
			const cx = s / 2;
			const cy = s / 2;
			const R = s * 0.36;
			const e = o.energy;
			const col = rgb.join(',');
			x.clearRect(0, 0, s, s);
			const spin = t * 0.07;
			const point = (a: number, wobble: number, rise: number) => {
				const th = a + spin;
				// A rounded square (a superellipse), breathing a little out of round.
				const base =
					R /
					Math.pow(Math.pow(Math.abs(Math.cos(a)), 4) + Math.pow(Math.abs(Math.sin(a)), 4), 1 / 4);
				const r =
					base *
						(1 + 0.045 * Math.sin(3 * a + t * 0.55) + 0.03 * Math.sin(2 * a - t * 0.4) + rise) +
					wobble;
				return [cx + Math.cos(th) * r, cy + Math.sin(th) * r] as const;
			};
			const swell = (cur === 'swell' ? blend : 0) + (prev === 'swell' ? 1 - blend : 0);
			for (const d of dots) {
				let lit = o.lit
					? 0.7
					: e * (blend * litIn(cur, d.a, t) + (1 - blend) * litIn(prev, d.a, t));
				if (o.glow) {
					const back = flDir > 0 ? behind(d.a, flHead) : behind(flHead, d.a);
					lit = Math.max(lit, o.glow * Math.exp(-back / 0.6));
				}
				const rise = o.lit ? 0 : e * swell * 0.05 * crest(d.a, t);
				const spread = s * 0.045 * (1 + lit * 1.2);
				const [px, py] = point(d.a, d.off * spread, rise);
				const alpha = o.lit ? d.base + 0.55 : d.base * (0.65 + 0.35 * e) + lit * 0.85;
				x.fillStyle = `rgba(${col},${Math.min(1, dark ? alpha : alpha * 1.25)})`;
				const z = d.size * (1 + lit * 0.8);
				x.fillRect(px - z / 2, py - z / 2, z, z);
			}
			if (o.lit) return;
			// A warm glow at the head of each trail, fading in and out with the mood (none for the swell).
			x.globalCompositeOperation = dark ? 'lighter' : 'source-over';
			const dim = cur === 'tide' || prev === 'tide' ? 0.6 : 1;
			const glows = [
				...headsOf(cur, t).map((h) => [h, e * blend * dim] as const),
				...headsOf(prev, t).map((h) => [h, e * (1 - blend) * dim] as const),
				...(o.glow ? [[flHead, o.glow] as const] : [])
			];
			for (const [h, k] of glows) {
				if (k < 0.02) continue;
				const [gx, gy] = point(((h % TAU) + TAU) % TAU, 0, 0);
				const r = s * 0.09;
				const g = x.createRadialGradient(gx, gy, 0, gx, gy, r);
				g.addColorStop(0, dark ? `rgba(255,240,215,${0.85 * k})` : `rgba(${col},${0.5 * k})`);
				g.addColorStop(0.25, `rgba(${col},${(dark ? 0.55 : 0.22) * k})`);
				g.addColorStop(1, `rgba(${col},0)`);
				x.fillStyle = g;
				x.fillRect(gx - r, gy - r, r * 2, r * 2);
			}
			x.globalCompositeOperation = 'source-over';
		};
		/** The still lit copies the CSS looks sweep, pulse and brighten, each in its look's tint (lib/helm.ts). */
		const paintLit = () => {
			for (const [name, x] of lits) if (x) paint(x, tintOf(LIT[name]), { energy: 0, lit: true });
		};
		const draw = () => {
			dark = document.documentElement.classList.contains('dark');
			const rgb = ink();
			if (still) {
				// One still frame of the look: its trail heads or crests lit, nothing moving.
				paint(ctx, rgb, { energy: cur === 'none' ? 0 : 1 });
				return;
			}
			paint(ctx, rgb, { energy, glow: flGlow });
		};

		let raf = 0;
		let last = 0;
		let showing = true;
		const busy = () => cur !== 'none' || energy > 0 || blend < 1 || shade < 1 || fl !== null;
		const tick = (now: number) => {
			raf = 0;
			if (!showing || document.hidden || reduced.matches) return;
			const dt = last ? Math.min(0.1, (now - last) / 1000) : 0;
			if (now - last < (cur === 'swell' ? 41 : 33)) {
				raf = requestAnimationFrame(tick);
				return;
			}
			last = now;
			const target = cur !== 'none' ? 1 : 0;
			energy += Math.sign(target - energy) * Math.min(Math.abs(target - energy), dt * 0.6);
			t += dt * energy * pace;
			blend = Math.min(1, blend + (dt * 1000) / FADE_MS);
			shade = Math.min(1, shade + (dt * 1000) / FADE_MS);
			if (isMood(cur) && now > nextMood) {
				prev = cur;
				const others = MOODS.filter((m) => m !== cur);
				cur = others[Math.floor(Math.random() * others.length)];
				blend = 0;
				nextMood = now + (9000 + Math.random() * 7000) / pace;
			}
			if (isMood(cur) && !fl && now > nextSteer) {
				steering = 'ease';
				steer += (Math.random() < 0.5 ? -1 : 1) * (40 + Math.random() * 100);
				nextSteer = now + (6000 + Math.random() * 8000) / pace;
			}
			if (fl) {
				const p = Math.min(1, (now - fl.start) / 2600);
				steer = fl.from + (fl.to - fl.from) * spring(p);
				flGlow = Math.sin(Math.PI * Math.min(1, p * 1.15));
				flHead = (((steer - 90) * Math.PI) / 180 - t * 0.07) % TAU;
				if (p >= 1) {
					fl = null;
					flGlow = 0;
				}
			}
			draw();
			// At rest, it stops drawing until there is something to show again.
			if (!busy()) {
				last = 0;
				paintLit();
				return;
			}
			raf = requestAnimationFrame(tick);
		};
		const run = () => {
			still = reduced.matches;
			if (reduced.matches) {
				blend = 1;
				shade = 1;
				fl = null;
				draw();
				paintLit();
				return;
			}
			if (!raf && showing && !document.hidden && busy()) {
				if (isMood(cur) && !nextMood) {
					nextMood = performance.now() + 9000;
					nextSteer = performance.now() + 2500;
				}
				raf = requestAnimationFrame(tick);
			} else if (!busy()) draw();
		};
		wake = (nextLook, nextTint, nextPace) => {
			pace = nextPace;
			if (nextTint !== lookTint) {
				fromColour = ink();
				lookTint = nextTint;
				toColour = tintOf(nextTint);
				shade = 0;
			}
			if (nextLook !== look) {
				look = nextLook;
				const p = patternOf(nextLook, cur);
				if (p !== cur) {
					prev = cur;
					cur = p;
					blend = 0;
				}
				if (isMood(cur)) nextMood = 0;
				paintLit();
			}
			run();
		};
		turn = (now) => {
			if (reduced.matches) return;
			const dir = Math.random() < 0.5 ? -1 : 1;
			flDir = dir;
			steering = 'spring';
			fl = { start: now, from: steer, to: steer + dir * (150 + Math.random() * 90) };
			run();
		};
		const io = new IntersectionObserver((e) => {
			showing = e.some((x) => x.isIntersecting);
			run();
		});
		io.observe(c);
		// The theme changes the ink: draw again in the new one.
		const themed = new MutationObserver(() => {
			toColour = tintOf(lookTint);
			fromColour = toColour;
			draw();
			paintLit();
		});
		themed.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
		document.addEventListener('visibilitychange', run);
		reduced.addEventListener('change', run);
		wake(idea, tint, tempo);
		draw();
		paintLit();
		return () => {
			wake = null;
			turn = null;
			cancelAnimationFrame(raf);
			io.disconnect();
			themed.disconnect();
			document.removeEventListener('visibilitychange', run);
			reduced.removeEventListener('change', run);
		};
	});
</script>

<div
	bind:this={mark}
	class="helm-mark relative grid shrink-0 place-items-center"
	style:width="{size}px"
	style:height="{size}px"
	title={helm?.legend || undefined}
	aria-hidden="true"
	data-helm-mark
	data-helm-idea={idea}
	data-helm-tint={tint}
>
	<div class="helm-halo absolute inset-0 tint-{tint}" class:is-on={idea !== 'still'}></div>
	<canvas bind:this={canvas} class="absolute inset-0 size-full"></canvas>

	<!-- Lighthouse: a lit copy of the ring shown only where the beam is, and the beam itself. -->
	<div class="hl-layer" class:is-on={idea === 'lighthouse'} class:is-running={runs('lighthouse')}>
		<div class="lh-sweep absolute inset-0">
			<canvas bind:this={litBeam} class="lh-lit absolute inset-0 size-full"></canvas>
		</div>
		<div class="lh-beam absolute inset-0"></div>
	</div>
	<!-- Pulse: the ring, lit, breathing slowly. -->
	<div class="hl-layer" class:is-on={idea === 'pulse'} class:is-running={runs('pulse')}>
		<canvas bind:this={litPulse} class="pulse-lit absolute inset-0 size-full"></canvas>
	</div>
	<!-- Lantern: the ring brightening every second round. -->
	<div class="hl-layer" class:is-on={idea === 'lantern'} class:is-running={runs('lantern')}>
		<canvas bind:this={litLantern} class="lantern-lit absolute inset-0 size-full"></canvas>
	</div>
	<!-- Swell: pings widening out from the wheel. -->
	<div class="hl-layer" class:is-on={idea === 'swell'} class:is-running={runs('swell')}>
		<span class="swell-ping"></span>
		<span class="swell-ping swell-ping-late"></span>
	</div>

	{#if wheel}
		<div class="helm-rock relative grid place-items-center" class:is-rocking={runs('swell')}>
			<div
				class="helm-wheel relative steer-{steering}"
				style:width="{size * 0.46}px"
				style:height="{size * 0.46}px"
				style:rotate={still ? null : `${steer}deg`}
			>
				<svg viewBox="0 0 100 100" class="helm-svg size-full">
					<defs>
						<linearGradient
							id={gold}
							gradientUnits="userSpaceOnUse"
							x1="10"
							y1="10"
							x2="90"
							y2="90"
						>
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
				<!-- Lantern: the spokes lighting in turn. -->
				<div
					class="hl-layer lantern-spokes"
					class:is-on={idea === 'lantern'}
					class:is-running={runs('lantern')}
				>
					{#each { length: 8 } as _, i (i)}
						<span class="lantern-spoke" style:rotate="{i * 45}deg" style:--i={i}></span>
					{/each}
				</div>
			</div>
		</div>
	{/if}
</div>

<style>
	/* The tints (app.css): ink colours on paper by day, pale ones glowing out of the dark at night. */
	.helm-mark {
		--tint-gold: var(--gold);
		--tint-amber: var(--helm-amber);
		--tint-red: var(--destructive);
		--tint-teal: var(--teal);
		--tint-cool: var(--helm-cool);
		--helm-a: #c9943a;
		--helm-b: #8f5f17;
		--helm-c: #4a3210;
		--helm-shadow: drop-shadow(0 2px 6px rgb(120 80 20 / 0.28));
		--halo-rest: 0.09;
		--lit-blend: multiply;
	}
	:global(.dark) .helm-mark {
		--helm-a: #f6e2b8;
		--helm-b: #d9b06a;
		--helm-c: #9c7438;
		--helm-shadow: drop-shadow(0 0 8px rgb(232 176 74 / 0.3));
		--halo-rest: 0.06;
		--lit-blend: plus-lighter;
	}

	/* A faint halo behind the wheel in the look's tint, breathing while it works (opacity and scale only). */
	.helm-halo {
		mask-image: radial-gradient(closest-side, #000, transparent);
		opacity: calc(var(--halo-rest) * 1.6);
		transition:
			background-color 1.6s ease,
			opacity 1.6s ease;
		will-change: opacity, transform;
	}
	.helm-halo.tint-gold {
		background-color: var(--tint-gold);
	}
	.helm-halo.tint-amber {
		background-color: var(--tint-amber);
	}
	.helm-halo.tint-red {
		background-color: var(--tint-red);
	}
	.helm-halo.tint-teal {
		background-color: var(--tint-teal);
	}
	.helm-halo.tint-cool {
		background-color: var(--tint-cool);
	}
	.helm-halo.is-on {
		animation: hl-halo 6s ease-in-out infinite;
	}
	@keyframes hl-halo {
		0%,
		100% {
			opacity: calc(var(--halo-rest) * 1.6);
			transform: scale(0.94);
		}
		50% {
			opacity: calc(var(--halo-rest) * 3.2);
			transform: scale(1.04);
		}
	}

	/* Each CSS look fades in and out; when gone it is paused, so nothing ticks at rest. */
	.hl-layer {
		position: absolute;
		inset: 0;
		pointer-events: none;
		opacity: 0;
		transition: opacity 1.6s ease;
	}
	.hl-layer.is-on {
		opacity: 1;
	}
	.hl-layer:not(.is-running),
	.hl-layer:not(.is-running) * {
		animation-play-state: paused !important;
	}

	/* Lighthouse: the lit ring, seen only through a turning wedge; the inner copy turns back so the dots stay put. */
	.lh-sweep {
		mask-image: conic-gradient(
			from -80deg,
			transparent 0deg,
			rgb(0 0 0 / 0.25) 40deg,
			#000 74deg,
			#000 80deg,
			transparent 86deg
		);
		animation: hl-spin 10s linear infinite;
		will-change: transform;
	}
	.lh-lit {
		animation: hl-spin 10s linear infinite reverse;
		will-change: transform;
	}
	.lh-beam {
		background: conic-gradient(
			from -40deg,
			transparent 0deg,
			color-mix(in srgb, var(--tint-amber) 30%, transparent) 36deg,
			color-mix(in srgb, var(--tint-amber) 45%, transparent) 40deg,
			transparent 46deg
		);
		mask-image: radial-gradient(
			closest-side,
			transparent 45%,
			#000 62%,
			#000 80%,
			transparent 100%
		);
		mix-blend-mode: var(--lit-blend);
		animation: hl-spin 10s linear infinite;
		will-change: transform;
	}
	@keyframes hl-spin {
		to {
			transform: rotate(1turn);
		}
	}

	/* Pulse: a slow breath of the lit ring. */
	.pulse-lit {
		animation: hl-breathe 5s ease-in-out infinite;
		will-change: opacity;
	}
	@keyframes hl-breathe {
		0%,
		100% {
			opacity: 0.08;
		}
		50% {
			opacity: 0.75;
		}
	}

	/* Lantern: the ring brightens softly every second round of the spokes. */
	.lantern-lit {
		animation: hl-glint 6.4s ease-in-out infinite;
		will-change: opacity;
	}
	@keyframes hl-glint {
		0%,
		100% {
			opacity: 0;
		}
		50% {
			opacity: 0.55;
		}
	}
	.lantern-spoke {
		position: absolute;
		left: calc(50% - 2.2%);
		bottom: 50%;
		width: 4.4%;
		height: 46%;
		transform-origin: 50% 100%;
		border-radius: 999px;
		background: linear-gradient(
			to top,
			transparent 14%,
			color-mix(in srgb, var(--tint-cool) 85%, transparent) 40%,
			var(--tint-cool) 95%
		);
		mix-blend-mode: var(--lit-blend);
		opacity: 0;
		animation: hl-spoke 3.2s linear infinite;
		animation-delay: calc(var(--i) * 0.4s - 3.2s);
		will-change: opacity;
	}
	@keyframes hl-spoke {
		0% {
			opacity: 0.95;
		}
		40%,
		100% {
			opacity: 0;
		}
	}

	/* Swell: rounded-square pings widening out from the wheel. */
	.swell-ping {
		position: absolute;
		left: 27%;
		top: 27%;
		width: 46%;
		height: 46%;
		border-radius: 30%;
		border: 1.5px solid var(--tint-teal);
		opacity: 0;
		animation: hl-ping 2.6s cubic-bezier(0.2, 0.6, 0.3, 1) infinite;
		will-change: transform, opacity;
	}
	.swell-ping-late {
		animation-delay: -1.3s;
	}
	@keyframes hl-ping {
		from {
			opacity: 0.55;
			transform: scale(0.55);
		}
		to {
			opacity: 0;
			transform: scale(1.55);
		}
	}
	/* The wheel rocks with the swell and is held where it is after, never snapping level. */
	.helm-rock {
		animation: hl-rock 5.2s ease-in-out infinite paused;
	}
	.helm-rock.is-rocking {
		animation-play-state: running;
	}
	@keyframes hl-rock {
		0%,
		100% {
			rotate: 0deg;
		}
		25% {
			rotate: 6deg;
		}
		75% {
			rotate: -6deg;
		}
	}

	/* The wheel: a static shadow, turned on the compositor. */
	.helm-wheel {
		will-change: transform;
		animation: helm-in 1.8s cubic-bezier(0.2, 0.7, 0.2, 1) 0.3s both;
	}
	.helm-svg {
		filter: var(--helm-shadow);
	}
	.steer-ease {
		transition: rotate 2.6s cubic-bezier(0.45, 0, 0.2, 1);
	}
	.steer-click {
		transition: rotate 0.7s cubic-bezier(0.34, 1.56, 0.64, 1);
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
			filter: none;
		}
	}

	/* Reduced motion: one still frame of each look. */
	@media (prefers-reduced-motion: reduce) {
		.helm-mark *,
		.helm-halo.is-on {
			animation: none !important;
			transition-property: opacity, background-color !important;
		}
		.pulse-lit {
			opacity: 0.5;
		}
		.lantern-lit {
			opacity: 0.3;
		}
		.lantern-spoke {
			opacity: 0.5;
		}
		.swell-ping {
			display: none;
		}
	}
</style>
