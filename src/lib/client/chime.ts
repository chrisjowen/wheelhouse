/**
 * A ship's bell, made with Web Audio rather than shipped as a recording: two
 * strokes, as for "two bells", each a struck bell's hum, prime, minor-third
 * tierce, quint and nominal partials fading at their own rates. Quiet by
 * design. A browser that has not seen a click or key press on the page yet may
 * keep it silent; turning the sound on (a click) allows it.
 */

const BASE_HZ = 587;
/** [frequency ratio, loudness, seconds to fade] */
const PARTIALS: [number, number, number][] = [
	[0.5, 0.35, 2.8],
	[1, 0.6, 2.2],
	[1.2, 0.3, 1.6],
	[1.5, 0.22, 1.3],
	[2, 0.4, 1.1],
	[2.74, 0.12, 0.7],
	[3.76, 0.08, 0.45]
];
const STROKE_GAP_S = 0.42;
const VOLUME = 0.16;

let ctx: AudioContext | null = null;

/** Ring the bell (two strokes). Does nothing where Web Audio is missing. */
export function strike(): void {
	try {
		const Ctor =
			globalThis.AudioContext ??
			(globalThis as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
		if (!Ctor) return;
		ctx ??= new Ctor();
		if (ctx.state === 'suspended') void ctx.resume();
		const start = ctx.currentTime + 0.02;
		stroke(ctx, start);
		stroke(ctx, start + STROKE_GAP_S);
	} catch {
		// no sound available
	}
}

function stroke(ctx: AudioContext, at: number): void {
	const out = ctx.createGain();
	out.gain.value = VOLUME;
	out.connect(ctx.destination);
	for (const [ratio, level, fade] of PARTIALS) {
		const osc = ctx.createOscillator();
		const gain = ctx.createGain();
		osc.type = 'sine';
		osc.frequency.value = BASE_HZ * ratio;
		gain.gain.setValueAtTime(0.0001, at);
		gain.gain.exponentialRampToValueAtTime(level, at + 0.004);
		gain.gain.exponentialRampToValueAtTime(0.0001, at + fade);
		osc.connect(gain).connect(out);
		osc.start(at);
		osc.stop(at + fade + 0.05);
	}
}
