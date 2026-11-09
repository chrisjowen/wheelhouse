import type { MatePeek, SecondMate } from '../../types';
import {
	PEEK_DEFAULT_LINES,
	PEEK_MAX_LINES,
	REMOTE_PEEK_MAX_LINES,
	REMOTE_UNREACHABLE,
	type AdapterResult,
	type FirstmateAdapter,
	type PeekOutput
} from './adapter';

/**
 * A bounded, read-only look at a second mate's own terminal, only when the
 * captain asks for one: a local second mate's through fm-peek.sh, as a
 * worker's; a remote one's on its host through fm-on.sh and the host's
 * `capture` (adapter.remotePeek). It never steers, messages or controls
 * anything. One look per second mate runs at a time, and looks asked for
 * within a moment of each other share one, so a burst of clicks cannot stack
 * SSH calls. A host that cannot be reached (fm-on.sh exit 255) reads as
 * offline and is not tried again until the captain asks again.
 */

/** Looks asked for this soon after one share it. */
const SHARE_MS = 2_000;

export class MatePeeks {
	private recent = new Map<string, { at: number; value: Promise<MatePeek>; pending: boolean }>();

	constructor(
		private adapter: Pick<FirstmateAdapter, 'peek' | 'remotePeek'>,
		private now: () => number = Date.now
	) {}

	look(mate: SecondMate, asked: number): Promise<MatePeek> {
		const cap = mate.where === 'remote' ? REMOTE_PEEK_MAX_LINES : PEEK_MAX_LINES;
		const lines = Math.min(
			cap,
			Math.max(1, Number.isFinite(asked) ? Math.floor(asked) : PEEK_DEFAULT_LINES)
		);
		if (!mate.peek.available) {
			return Promise.resolve(off(mate.peek.reason ?? 'Its terminal cannot be read.', lines));
		}
		const key = `${mate.id}:${lines}`;
		const at = this.now();
		const hit = this.recent.get(key);
		if (hit && at - hit.at < SHARE_MS) return hit.value;
		// One look per second mate at a time: a new ask while one runs shares it.
		for (const [k, v] of this.recent) {
			if (k.startsWith(`${mate.id}:`) && v.pending) return v.value;
		}
		for (const [k, v] of this.recent) {
			if (!v.pending && at - v.at > SHARE_MS * 5) this.recent.delete(k);
		}
		const ask =
			mate.where === 'remote'
				? this.adapter.remotePeek(mate.id, lines)
				: this.adapter.peek(mate.id, lines);
		const entry = {
			at,
			pending: true,
			value: ask
				.then((r) => toPeek(r, mate, lines))
				.finally(() => {
					entry.pending = false;
					entry.at = this.now();
				})
		};
		this.recent.set(key, entry);
		return entry.value;
	}
}

const off = (reason: string, requested: number, offline = false): MatePeek => ({
	available: false,
	offline,
	reason,
	lines: [],
	capturedAt: null,
	requested
});

function toPeek(r: AdapterResult<PeekOutput>, mate: SecondMate, lines: number): MatePeek {
	if (r.ok) {
		return {
			available: true,
			offline: false,
			reason: null,
			lines: r.value.lines,
			capturedAt: r.observedAt,
			requested: lines
		};
	}
	if (mate.where === 'remote' && r.error.exitCode === REMOTE_UNREACHABLE) {
		return {
			...off(
				`Offline: Firstmate could not reach ${mate.host ?? 'its host'}. Wheelhouse does not try again by itself.`,
				lines,
				true
			),
			capturedAt: r.observedAt
		};
	}
	const reason =
		r.error.kind === 'missing-script'
			? `This Firstmate has no ${r.error.script}, so Wheelhouse cannot look at it.`
			: `Could not read its terminal: ${r.error.message}`;
	return { ...off(reason, lines), capturedAt: r.observedAt };
}
