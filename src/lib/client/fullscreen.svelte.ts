/**
 * Real (browser) full screen for the live consoles, so the terminal fills the
 * display rather than only the browser window. Where the browser refuses
 * (no user gesture, an iframe without permission) the overlay still fills the
 * window.
 */

type KeyboardLock = { lock?: (keys: string[]) => Promise<void>; unlock?: () => void };
const keyboard = (): KeyboardLock | undefined =>
	(navigator as Navigator & { keyboard?: KeyboardLock }).keyboard;

/**
 * Put `el` in full screen. With `keepEscape`, Esc keeps reaching the page
 * (Claude Code uses it) where the browser can lock it; holding Esc then exits.
 * Resolves to whether `el` is now full screen, and whether Esc was kept.
 */
export async function enterFullscreen(
	el: Element,
	{ keepEscape = false }: { keepEscape?: boolean } = {}
): Promise<{ full: boolean; escapeKept: boolean }> {
	if (document.fullscreenElement !== el) {
		if (typeof el.requestFullscreen !== 'function') return { full: false, escapeKept: false };
		try {
			await el.requestFullscreen({ navigationUI: 'hide' });
		} catch {
			return { full: false, escapeKept: false };
		}
	}
	let escapeKept = false;
	if (keepEscape && keyboard()?.lock) {
		escapeKept = await keyboard()!.lock!(['Escape'])
			.then(() => true)
			.catch(() => false);
	}
	return { full: true, escapeKept };
}

/** Leave full screen if `el` holds it. */
export function leaveFullscreen(el: Element | null): void {
	if (!el || document.fullscreenElement !== el) return;
	keyboard()?.unlock?.();
	void document.exitFullscreen().catch(() => {});
}

/**
 * How many full-screen consoles are open. The console windows behind one
 * stop sampling, so only the console the captain is watching polls quickly.
 */
class ConsoleFocus {
	open = $state(0);
}
export const consoleFocus = new ConsoleFocus();
