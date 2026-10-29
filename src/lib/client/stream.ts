/** Our own connection to the Wheelhouse server (not Firstmate's state). */
export type Connection = 'connecting' | 'open' | 'lost';

/** A dropped stream that has not come back this long means the server is gone. */
export const LOST_AFTER_MS = 5_000;
/** How soon to open a fresh stream after the browser gave up on one. */
export const REOPEN_MS = 3_000;

/**
 * An EventSource on one of Wheelhouse's streams that notices when the server
 * is gone and keeps trying until it is back. The browser retries a dropped
 * stream on its own (the server asks for every 3 s) but only reports
 * "connecting" while it does, so a stream that stays down past LOST_AFTER_MS
 * is reported lost; and when the browser gives up on a stream (a refused
 * answer, say, while the server restarts) a fresh one is opened every
 * REOPEN_MS. `listen` attaches the event handlers to each stream opened.
 */
export function watchedStream(
	url: string,
	listen: (es: EventSource) => void,
	report: (state: Connection) => void
): () => void {
	let state: Connection = 'connecting';
	let es: EventSource | null = null;
	let lostTimer: ReturnType<typeof setTimeout> | null = null;
	let reopenTimer: ReturnType<typeof setTimeout> | null = null;
	const set = (s: Connection) => {
		state = s;
		report(s);
	};
	const lost = () => {
		if (lostTimer) clearTimeout(lostTimer);
		lostTimer = null;
		set('lost');
	};
	const open = () => {
		reopenTimer = null;
		const source = new EventSource(url);
		es = source;
		source.addEventListener('open', () => {
			if (lostTimer) clearTimeout(lostTimer);
			lostTimer = null;
			set('open');
		});
		source.addEventListener('error', () => {
			if (source.readyState === EventSource.CLOSED) {
				source.close();
				lost();
				reopenTimer ??= setTimeout(open, REOPEN_MS);
				return;
			}
			// Still lost until it opens again: the browser's own retries do not clear it.
			if (state !== 'lost') set('connecting');
			lostTimer ??= setTimeout(lost, LOST_AFTER_MS);
		});
		listen(source);
	};
	open();
	return () => {
		if (lostTimer) clearTimeout(lostTimer);
		if (reopenTimer) clearTimeout(reopenTimer);
		es?.close();
		es = null;
	};
}
