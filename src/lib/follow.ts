/**
 * Following the end of a feed, as a chat does: it opens at the latest entry
 * and, while the reader is at (or within a few pixels of) the bottom, keeps
 * the newest entry in view as entries arrive. Once the reader scrolls up it
 * never moves on its own; it only notes that something new has arrived below
 * (`unseen`), until they come back down or jump there. Scrolling is always
 * instant, so it reads the same under reduced motion and never races the
 * reader's own scrolling.
 */

/** How close to the bottom still counts as at it, in pixels. */
export const NEAR_BOTTOM = 48;

/** Where a scroller stands: how far down it is, its full height and the height in view. */
export type Metrics = { top: number; height: number; view: number };

export function atBottom(m: Metrics, near = NEAR_BOTTOM): boolean {
	return m.height - m.view - m.top <= near;
}

export type Follower = {
	/** The reader scrolled (or the follower did): note whether they are at the bottom. */
	scrolled(): void;
	/** The feed grew: follow it when at the bottom, else note there is something new below. */
	grew(): void;
	/** Go to the latest entry and follow from there. */
	jump(): void;
	readonly following: boolean;
	readonly unseen: boolean;
};

export function follower(scroller: {
	measure(): Metrics;
	toBottom(): void;
	onunseen?: (unseen: boolean) => void;
}): Follower {
	let following = true;
	let unseen = false;
	const setUnseen = (v: boolean) => {
		if (v === unseen) return;
		unseen = v;
		scroller.onunseen?.(v);
	};
	return {
		scrolled() {
			following = atBottom(scroller.measure());
			if (following) setUnseen(false);
		},
		grew() {
			if (following) scroller.toBottom();
			else setUnseen(true);
		},
		jump() {
			following = true;
			setUnseen(false);
			scroller.toBottom();
		},
		get following() {
			return following;
		},
		get unseen() {
			return unseen;
		}
	};
}

/**
 * Follow `feed`, an element in the page that scrolls as a whole (the window),
 * from the bottom: it goes there now and follows it as it grows while it is
 * shown. Returns the follower and the function that stops it.
 */
export function followPage(
	feed: HTMLElement,
	onunseen?: (unseen: boolean) => void
): { follow: Follower; stop: () => void } {
	const root = document.scrollingElement ?? document.documentElement;
	const follow = follower({
		measure: () => ({ top: root.scrollTop, height: root.scrollHeight, view: innerHeight }),
		toBottom: () => window.scrollTo({ top: root.scrollHeight, behavior: 'instant' }),
		onunseen
	});
	follow.jump();
	let last = feed.offsetHeight;
	const resized = new ResizeObserver(() => {
		const now = feed.offsetHeight;
		// Shown again after another tab, or shrunk (a stage folded): nothing new to follow.
		if (last > 0 && now > last) follow.grew();
		last = now;
	});
	resized.observe(feed);
	const onscroll = () => follow.scrolled();
	addEventListener('scroll', onscroll, { passive: true });
	return {
		follow,
		stop: () => {
			resized.disconnect();
			removeEventListener('scroll', onscroll);
		}
	};
}
