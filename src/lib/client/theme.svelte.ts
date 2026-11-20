import { reducedMotion } from '$lib/motion';

/**
 * Light or dark: app.html applies the saved choice before first paint, and the
 * header's switch (on a phone, the More page's) changes it and saves it.
 */
export const theme = $state({ dark: false });

/** Reads the theme app.html applied; called once the page runs. */
export function readTheme() {
	theme.dark = document.documentElement.classList.contains('dark');
}

export function toggleTheme(e?: MouseEvent) {
	const next = !theme.dark;
	const apply = () => {
		theme.dark = next;
		document.documentElement.classList.toggle('dark', next);
	};
	// The new theme opens as a circle from the switch.
	if (!document.startViewTransition || reducedMotion() || !e) apply();
	else {
		const x = e.clientX || innerWidth - 40;
		const y = e.clientY || 28;
		const r = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y));
		void document.startViewTransition(apply).ready.then(() =>
			document.documentElement.animate(
				{ clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${r}px at ${x}px ${y}px)`] },
				{
					duration: 520,
					easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)',
					pseudoElement: '::view-transition-new(root)'
				}
			)
		);
	}
	try {
		localStorage.setItem('wheelhouse-theme', next ? 'dark' : 'light');
	} catch {
		// storage unavailable; the choice lasts for this page only
	}
}
