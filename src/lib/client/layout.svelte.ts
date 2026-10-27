/**
 * Which side of the Firstmate page the On deck rail docks to, kept in this browser.
 * On the left (the default) it sits next to the side panel with the chat on the right.
 */
export const RAIL_SIDE_KEY = 'wheelhouse-ondeck-side';

export type RailSide = 'left' | 'right';

/** The side as stored: `right` only when set so, else the default left. */
export function parseRailSide(raw: string | null): RailSide {
	return raw === 'right' ? 'right' : 'left';
}

class HomeLayout {
	side = $state<RailSide>('left');

	load() {
		try {
			this.side = parseRailSide(localStorage.getItem(RAIL_SIDE_KEY));
		} catch {
			// storage unavailable: the default side
		}
	}

	swap() {
		this.side = this.side === 'left' ? 'right' : 'left';
		try {
			localStorage.setItem(RAIL_SIDE_KEY, this.side);
		} catch {
			// storage unavailable: the side lasts for this page only
		}
	}
}

export const homeLayout = new HomeLayout();
