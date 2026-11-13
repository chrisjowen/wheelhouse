/**
 * What Wheelhouse cannot currently see, in the captain's words, for the one
 * slim strip under the header. The checks themselves (the connection, health
 * and fleet reads) are unchanged; this only says what they found, worst first,
 * without script names, timeouts or ids. Pure, so it is unit-tested.
 */

import { ago } from './format';
import { clean } from './plain';
import type { FleetView, Health } from './types';

export type NoticeTone = 'danger' | 'warning' | 'quiet';

export interface Notice {
	key: 'connection' | 'setup' | 'compatibility' | 'watch' | 'stale';
	tone: NoticeTone;
	/** A few words for the strip, e.g. "Connection trouble". */
	title: string;
	/** What it means, in a sentence or two, for the opened panel. */
	text: string;
}

export interface NoticeInput {
	/** Our own connection to the Wheelhouse server is lost. */
	connectionLost: boolean;
	health: Pick<Health, 'configured' | 'firstmate' | 'supervisor'> | null;
	fleet: Pick<FleetView, 'stale' | 'collectedAt'> | null;
	now: number;
}

/** A reason in plain words, or null when nothing readable is left once internals are gone. */
function plainReason(reason: string | null | undefined): string | null {
	if (!reason) return null;
	const s = clean(reason.replace(/\s*\([^()]*\)/g, ''));
	if (!s || /\b\d+\s*ms\b|\btimed out\b/i.test(s)) return null;
	return /[.!?]$/.test(s) ? s : `${s}.`;
}

/** Every condition that applies, worst first; empty when all is well. */
export function notices({ connectionLost, health, fleet, now }: NoticeInput): Notice[] {
	const out: Notice[] = [];
	if (connectionLost) {
		out.push({
			key: 'connection',
			tone: 'danger',
			title: 'Connection trouble',
			text: 'Can’t reach the Wheelhouse server, retrying. What you see picks up again as soon as it answers.'
		});
	}
	if (health && !health.configured) {
		const why = plainReason(health.firstmate.problems[0]);
		out.push({
			key: 'setup',
			tone: 'danger',
			title: 'Not connected to Firstmate',
			text: `Wheelhouse isn’t connected to a Firstmate home.${why ? ` ${why}` : ''}`
		});
	} else if (health && !health.firstmate.compatible) {
		out.push({
			key: 'compatibility',
			tone: 'warning',
			title: 'Firstmate may not be compatible',
			text: 'This Firstmate may not match this Wheelhouse, so some information may be missing or wrong.'
		});
	}
	const sup = health?.supervisor;
	if (health?.configured && sup && sup.onWatch !== true) {
		const off = sup.onWatch === false;
		const why = plainReason(sup.reason);
		out.push({
			key: 'watch',
			tone: 'quiet',
			title: off ? 'Firstmate is off watch' : 'Firstmate isn’t answering',
			text: `${off ? 'Firstmate is off watch.' : 'Firstmate isn’t answering right now.'}${
				why ? ` ${why}` : ''
			} Task states are still read from its records.`
		});
	}
	if (health?.configured && fleet?.stale) {
		out.push({
			key: 'stale',
			tone: 'warning',
			title: 'Updates may be late',
			text: fleet.collectedAt
				? `Fleet view last updated ${ago(fleet.collectedAt, now)}. Wheelhouse keeps trying.`
				: 'Wheelhouse hasn’t been able to read the fleet yet. It keeps trying.'
		});
	}
	const rank: Record<NoticeTone, number> = { danger: 0, warning: 1, quiet: 2 };
	return out.sort((a, b) => rank[a.tone] - rank[b.tone]);
}

/** The strip's one line: the worst condition, with a count when there are several. */
export function noticeSummary(list: Notice[]): string {
	if (!list.length) return '';
	return list.length === 1 ? list[0].title : `${list[0].title} · ${list.length} issues`;
}

/**
 * Made-up conditions for trying the strip in development, from `?notices=`
 * (comma-separated: lost or server, setup, compat, watch, offwatch, stale).
 */
export function sampleNoticeInput(param: string, now: number): NoticeInput {
	const want = new Set(param.split(',').map((s) => s.trim()));
	const configured = !want.has('setup');
	const onWatch = want.has('offwatch') ? false : want.has('watch') ? null : true;
	return {
		connectionLost: want.has('lost') || want.has('server'),
		health: {
			configured,
			firstmate: {
				dir: null,
				home: null,
				version: null,
				compatible: configured && !want.has('compat'),
				problems: ['fm-session.sh is missing'],
				scripts: []
			},
			supervisor: {
				available: true,
				onWatch,
				reason: 'fm-inbox.sh timed out after 10000 ms',
				observedAt: null,
				posture: null
			}
		},
		fleet: {
			stale: want.has('stale'),
			collectedAt: new Date(now - 60 * 60_000).toISOString()
		},
		now
	};
}
