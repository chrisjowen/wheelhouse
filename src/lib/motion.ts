import { backOut, cubicInOut, cubicOut, quintOut } from 'svelte/easing';
import type { Attachment } from 'svelte/attachments';
import type { TransitionConfig } from 'svelte/transition';

/**
 * Wheelhouse's motion: a few short, quiet transitions that show what changed
 * (a panel sliding out over the page, a preview zooming out of its card, an
 * answered question stamped and leaving, a count rolling), never motion for
 * its own sake. Each one is instant while the system asks for reduced motion;
 * CSS animations are, too, through the rule at the end of app.css.
 */

/** Durations in milliseconds: small state changes, panels, and a moment worth seeing. */
export const MOTION = { quick: 180, panel: 340, moment: 700 } as const;

/** Whether the system asks for reduced motion (never on the server). */
export function reducedMotion(): boolean {
	return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

const ms = (n: number) => (reducedMotion() ? 0 : n);

/** A side panel sliding in from (and back out to) the right-hand edge. */
export function slideFromRight(
	_node: Element,
	{ duration = MOTION.panel }: { duration?: number } = {}
): TransitionConfig {
	return {
		duration: ms(duration),
		easing: quintOut,
		css: (_t, u) => `transform: translateX(${u * 100}%)`
	};
}

/** A scrim or a light layer fading in and out. */
export function fadeQuick(
	_node: Element,
	{ duration = MOTION.quick }: { duration?: number } = {}
): TransitionConfig {
	return { duration: ms(duration), easing: cubicOut, css: (t) => `opacity: ${t}` };
}

/** Something new rising into a list (a card, a question). */
export function rise(
	_node: Element,
	{ y = 8, duration = MOTION.panel }: { y?: number; duration?: number } = {}
): TransitionConfig {
	return {
		duration: ms(duration),
		easing: cubicOut,
		css: (t, u) => `opacity: ${t}; transform: translateY(${u * y}px)`
	};
}

/** A marker arriving where things now stand (the current step's dot), with a small overshoot. */
export function pop(_node: Element): TransitionConfig {
	return {
		duration: ms(MOTION.panel),
		easing: backOut,
		css: (t) => `transform: scale(${0.3 + 0.7 * t})`
	};
}

/** A number that changed rolling in from below (a count going down or up). */
export function roll(_node: Element): TransitionConfig {
	return {
		duration: ms(MOTION.quick + 120),
		easing: cubicOut,
		css: (t, u) => `display: inline-block; opacity: ${t}; transform: translateY(${u * 70}%)`
	};
}

/** The words a stamp may carry, from what the captain did. */
export type StampWord = 'Answered' | 'Closed' | 'Later';

/**
 * An answered card leaving its list. With a `word`, it is pressed into the
 * card (the element itself, positioned) as an ink stamp first, held a moment,
 * then the card slides away; without one it just fades and slides. The rest
 * of the list closes up behind it (animate:flip).
 */
export function stampOut(
	node: HTMLElement,
	{ word = null }: { word?: StampWord | null } = {}
): TransitionConfig {
	if (reducedMotion()) return { duration: 0 };
	if (!word) {
		return {
			duration: MOTION.panel,
			easing: cubicInOut,
			css: (t, u) => `opacity: ${t}; transform: translateX(${-u * 24}px)`
		};
	}
	const stamp = document.createElement('span');
	stamp.className = 'wh-stamp';
	stamp.setAttribute('aria-hidden', 'true');
	stamp.textContent = word;
	node.append(stamp);
	const hold = MOTION.moment;
	const away = MOTION.panel + 60;
	const total = hold + away;
	return {
		duration: total,
		css: (t) => {
			// t runs from 1 to 0 as the card leaves: hold still while the stamp lands, then go.
			const p = cubicInOut(Math.max(0, (1 - t) * total - hold) / away);
			return `opacity: ${1 - p}; transform: translateX(${-p * 32}px)`;
		}
	};
}

const cues = new WeakMap<Element, unknown>();

/**
 * Plays a one-off CSS animation class (say `wh-landed`, app.css) on an element
 * when `on` turns true after the element was first drawn: work landing while
 * its card is on screen, not work that had already landed.
 */
export function cue(on: boolean, cls: string, ms = 1600): Attachment<HTMLElement> {
	return (node) => {
		const seen = cues.has(node);
		const was = cues.get(node);
		cues.set(node, on);
		if (!seen || !on || was || reducedMotion()) return;
		node.classList.add(cls);
		const t = setTimeout(() => node.classList.remove(cls), ms);
		return () => {
			clearTimeout(t);
			node.classList.remove(cls);
		};
	};
}

/** A box's place on the page, as a plain object (a DOMRect's left, top, width and height). */
export type Box = { left: number; top: number; width: number; height: number };

/**
 * The transform that draws a box of size `to` over the box `from`, scaled from
 * its top-left corner: where something should start when it zooms out of a
 * thumbnail, and end when it zooms back in.
 */
export function zoomFrom(from: Box, to: Box): { x: number; y: number; sx: number; sy: number } {
	return {
		x: from.left - to.left,
		y: from.top - to.top,
		sx: to.width ? from.width / to.width : 1,
		sy: to.height ? from.height / to.height : 1
	};
}

/**
 * An overlay growing out of the element it was opened from (a preview's
 * thumbnail), and shrinking back into it as it closes. Without an origin it
 * fades and settles in from slightly smaller.
 */
export function zoom(node: HTMLElement, { from }: { from: Box | null }): TransitionConfig {
	if (reducedMotion()) return { duration: 0 };
	if (!from) {
		return {
			duration: MOTION.panel,
			easing: cubicOut,
			css: (t, u) => `opacity: ${t}; transform: scale(${1 - u * 0.03})`
		};
	}
	const z = zoomFrom(from, node.getBoundingClientRect());
	return {
		duration: MOTION.panel + 140,
		easing: quintOut,
		css: (t, u) =>
			`transform-origin: 0 0; border-radius: ${u * 10}px; opacity: ${Math.min(1, t * 2.5)};` +
			`transform: translate(${u * z.x}px, ${u * z.y}px) scale(${1 - u * (1 - z.sx)}, ${1 - u * (1 - z.sy)})`
	};
}
