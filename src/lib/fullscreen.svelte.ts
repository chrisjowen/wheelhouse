/**
 * Full-screen layers: a preview full screen (PreviewStudio) or a live review
 * (LiveReview), drawn over the whole window even when opened from inside a
 * slide-out panel. A panel that contains its layout (the task slide-out's
 * dialog has `contain: layout`) or is transformed makes `position: fixed`
 * relative to itself, so a layer opened inside it would be squeezed to the
 * panel's width. `use:fullscreen` moves the layer's element to the end of
 * <body> while it is open, out of any panel (taking back the pointer events a
 * modal dialog turns off on <body>), and counts the layers open.
 *
 * A modal dialog under a layer (a slide-out) must let the layer take clicks,
 * focus and Escape without closing: call `keepForLayer(e)` from its
 * outside-interaction, outside-focus and Escape handlers (TaskSlideout does;
 * any slide-out that shows previews can). Focus moving into a layer is kept
 * from the dialog's focus trap here, which would otherwise pull it back: the
 * trap listens for `focusin` on the document, so while a layer is open those
 * events stop at the window when they come from inside one (nothing in a layer
 * listens for `focusin`).
 */
class Layers {
	open = $state(0);
}

export const layers = new Layers();

export const LAYER_ATTRIBUTE = 'data-fullscreen-layer';

function keepFocus(e: FocusEvent) {
	if (inLayer(e.target)) e.stopPropagation();
}

/** Svelte action: draw this element on the whole window, outside any panel, while it is mounted. */
export function fullscreen(node: HTMLElement) {
	node.setAttribute(LAYER_ATTRIBUTE, '');
	// A modal dialog under it turns pointer events off on <body>; the layer takes them back.
	node.style.pointerEvents = 'auto';
	document.body.appendChild(node);
	if (layers.open++ === 0) window.addEventListener('focusin', keepFocus, true);
	return {
		destroy() {
			if (--layers.open === 0) window.removeEventListener('focusin', keepFocus, true);
			node.remove();
		}
	};
}

/** Whether an event's target is inside a full-screen layer. */
export function inLayer(target: EventTarget | null): boolean {
	return target instanceof Element && !!target.closest(`[${LAYER_ATTRIBUTE}]`);
}

/** For a dialog under a layer: keep it open while a layer is open or the event is in one. */
export function keepForLayer(e: Event): void {
	if (layers.open > 0 || inLayer(e.target)) e.preventDefault();
}
