import { plainStatus } from '../../plain';
import type { MateHealth, MateTask, SecondMate, TaskStatus } from '../../types';
import type { BacklogRecord, FleetSnapshot, SecondMateRecord, SnapshotTask } from './contracts';
import { ageText, isSecondMateRow, prNumber, STATUS_LABEL } from './model';

/**
 * Second mates, local and remote, as Wheelhouse shows them: each one's
 * health, projects, work in flight, queue, landed work and pull requests, and
 * how many questions it has open, from the fleet snapshot's
 * `secondmate_current` (Firstmate's validated summary of each second mate's
 * home). Nothing here asks a second mate anything: what the snapshot does not
 * carry is said plainly (SECOND_MATE_GAPS) rather than read some other way.
 *
 * A second mate's own row in `tasks[]` (kind `secondmate`) is the record the
 * captain's Firstmate keeps of it; it is shown here, never as a task card.
 */

/** Second-mate facts Firstmate's fleet snapshot does not carry yet. */
export const SECOND_MATE_GAPS = {
	host: 'Host CPU, memory and disk: Firstmate’s fleet snapshot does not report them for a second mate’s host yet.',
	previews:
		'Previews: Firstmate’s summary of a second mate’s home does not carry its workers’ preview addresses yet.'
} as const;

const STATE_LABEL: Record<string, string> = {
	captain_decision: 'Needs your decision',
	active_child_work: 'Working',
	externally_held: 'Held',
	no_active_work: 'Idle',
	unknown: 'State unknown'
};

/** In a second mate's home, a worker's decision goes to that second mate first. */
const MATE_LABEL: Partial<Record<TaskStatus, string>> = {
	'with-firstmate': 'Waiting on its second mate',
	done: 'Finished; with its second mate'
};

const label = (status: TaskStatus) => MATE_LABEL[status] ?? STATUS_LABEL[status];

const isCaptainHold = (d: { verb: string | null; source: string | null }) =>
	d.verb === 'captain-hold' || d.source === 'backlog';

function task(
	id: string,
	status: TaskStatus,
	o: Partial<Omit<MateTask, 'id' | 'status' | 'statusLabel' | 'title'>> & {
		title?: string | null;
	} = {}
): MateTask {
	return {
		id,
		title: o.title || id,
		projectId: o.projectId ?? null,
		status,
		statusLabel: label(status),
		doing: o.doing ?? null,
		since: o.since ?? null,
		completedOn: o.completedOn ?? null,
		pr: o.pr ?? null,
		report: o.report ?? null
	};
}

const IN_FLIGHT_ORDER: Partial<Record<TaskStatus, number>> = {
	'needs-decision': 0,
	blocked: 1,
	failed: 1,
	unknown: 2,
	'with-firstmate': 3,
	waiting: 4,
	working: 5,
	done: 6
};

function health(rec: SecondMateRecord, row: SnapshotTask | null): MateHealth {
	const read = rec.provenance === 'structured-home';
	const age = rec.freshness.ageSeconds;
	const base = {
		reason: null as string | null,
		observedAt: rec.freshness.observedAt,
		ageSeconds: age,
		cached: false,
		host: { cpu: null, memory: null, disk: null },
		hostNote: SECOND_MATE_GAPS.host
	};
	const where = rec.host ?? 'its host';
	if (read && rec.summarySource === 'remote-ledger-cache') {
		return {
			...base,
			online: 'offline',
			cached: true,
			text: `Offline: Firstmate could not reach ${where}; this is what it reported${age === null ? ' last' : ` ${ageText(age)}`}`,
			reason: `Firstmate could not read ${where} just now.`
		};
	}
	if (read) {
		if (!rec.remote && row?.endpoint.exists === false) {
			return {
				...base,
				online: 'offline',
				text: 'Offline: its terminal is gone',
				reason: 'Firstmate reports no terminal for it.'
			};
		}
		return { ...base, online: 'online', text: 'Online' };
	}
	const reason = rec.reason ?? 'Firstmate could not read its home.';
	return rec.remote
		? { ...base, online: 'offline', text: `Offline: could not read ${where}`, reason }
		: { ...base, online: 'unknown', text: 'Not readable', reason };
}

/** One second mate, from its record (and its own row in the parent's tasks, if any). */
export function deriveSecondMate(
	rec: SecondMateRecord,
	row: SnapshotTask | null,
	backlog: BacklogRecord | null
): SecondMate {
	const h = health(rec, row);
	const seen = new Set<string>();
	const inFlight: MateTask[] = [];
	const queued: MateTask[] = [];
	const endpoint = new Map(rec.endpoints.map((e) => [e.id, e]));
	const repo = new Map<string, string>();
	for (const a of rec.active) if (a.repo) repo.set(a.id, a.repo);
	for (const q of rec.queued) if (q.repo) repo.set(q.id, q.repo);
	const add = (to: MateTask[], t: MateTask) => {
		if (seen.has(t.id)) return;
		seen.add(t.id);
		to.push({ ...t, projectId: t.projectId ?? repo.get(t.id) ?? null });
	};

	// Its captain's calls first, then its workers' own questions.
	for (const d of rec.decisions) {
		const q = rec.queued.find((x) => x.id === d.id);
		if (isCaptainHold(d)) {
			add(
				inFlight,
				task(d.id, 'needs-decision', {
					title: q?.title ?? d.summary,
					doing: d.question ?? d.reason ?? d.summary,
					since: q?.since ?? null
				})
			);
		} else if (d.summary) {
			const a = rec.active.find((x) => x.id === d.id);
			add(
				inFlight,
				task(d.id, d.verb === 'blocked' ? 'blocked' : 'with-firstmate', {
					title: a?.name ?? q?.title ?? null,
					doing: plainStatus(d.verb ?? 'needs-decision', d.summary)
				})
			);
		}
	}
	for (const a of rec.active) {
		add(
			inFlight,
			task(a.id, 'working', {
				title: a.name,
				projectId: a.repo,
				doing: a.doing ? plainStatus('working', a.doing) : null
			})
		);
	}
	for (const hd of rec.holds) {
		if (hd.source !== 'child-state') continue;
		const state = endpoint.get(hd.id)?.state;
		add(
			inFlight,
			task(hd.id, state === 'blocked' ? 'blocked' : 'waiting', {
				title: hd.title,
				doing: hd.reason ? plainStatus(state ?? 'paused', hd.reason) : null
			})
		);
	}
	for (const q of rec.queued) {
		const waiting = q.blockedBy
			? `Waiting on ${q.blockedBy}.`
			: q.holdReason
				? `Held: ${q.holdReason}`
				: 'Not started yet.';
		add(
			queued,
			task(q.id, q.captainActionable ? 'needs-decision' : 'queued', {
				title: q.title,
				projectId: q.repo,
				doing: q.captainActionable ? (q.question ?? q.holdReason) : waiting,
				since: q.since
			})
		);
	}
	// Workers the summary lists only by their endpoint: finished, failed or unreadable ones.
	for (const e of rec.endpoints) {
		const status: TaskStatus | null =
			e.state === 'working'
				? 'working'
				: e.state === 'done'
					? 'done'
					: e.state === 'failed'
						? 'failed'
						: e.state === 'blocked'
							? 'blocked'
							: e.state === 'parked' || e.state === 'paused'
								? 'waiting'
								: e.state === 'unknown'
									? 'unknown'
									: null;
		if (status) add(inFlight, task(e.id, status));
	}
	inFlight.sort((a, b) => (IN_FLIGHT_ORDER[a.status] ?? 9) - (IN_FLIGHT_ORDER[b.status] ?? 9));

	const landed: MateTask[] = rec.landed.map((l) =>
		task(l.id, 'landed', {
			title: l.title,
			completedOn: l.completion.date,
			doing: l.completion.verb
				? `${l.completion.verb[0].toUpperCase()}${l.completion.verb.slice(1)}${l.completion.date ? ` on ${l.completion.date}` : ''}.`
				: null,
			pr: l.prUrl ? { url: l.prUrl, number: prNumber(l.prUrl) } : null,
			report: l.reportPath
		})
	);
	const prs = [...inFlight, ...queued, ...landed]
		.filter((t) => t.pr)
		.map((t) => ({
			taskId: t.id,
			title: t.title,
			url: t.pr!.url,
			number: t.pr!.number,
			landed: t.status === 'landed'
		}));

	const projects = [
		...new Set([...inFlight, ...queued].map((t) => t.projectId).filter((p): p is string => !!p))
	].sort();

	const omitted: string[] = [];
	const more = (key: string, shown: number, words: string) => {
		const n = (rec.counts[key] ?? shown) - shown;
		if (n > 0) omitted.push(`${n} more ${words}`);
	};
	more('active_children', rec.active.length, 'working');
	more('decisions_open', rec.decisions.length, 'open questions');
	more('queued', rec.queued.length, 'queued');
	more('landed', rec.landed.length, 'landed');
	more('endpoints', rec.endpoints.length, 'workers');

	const captainDecisions =
		rec.decisions.filter(isCaptainHold).length + (backlog?.captainActionable ? 1 : 0);
	const tone: SecondMate['tone'] =
		h.online === 'unknown' || (h.online === 'offline' && !h.cached)
			? 'trouble'
			: rec.state === 'captain_decision' || captainDecisions > 0
				? 'captain'
				: rec.state === 'active_child_work'
					? 'working'
					: 'quiet';

	const peek = rec.remote
		? rec.host
			? { available: true, reason: null }
			: { available: false, reason: 'Firstmate records no host for it.' }
		: row?.endpoint.exists === true
			? { available: true, reason: null }
			: { available: false, reason: 'Firstmate reports no terminal for it.' };

	return {
		id: rec.id,
		where: rec.remote ? 'remote' : 'local',
		host: rec.host,
		home: rec.home,
		stateLabel: STATE_LABEL[rec.state] ?? STATE_LABEL.unknown,
		tone,
		health: h,
		projects,
		inFlight,
		queued,
		landed,
		prs,
		previews: [],
		previewNote: SECOND_MATE_GAPS.previews,
		decisions: rec.decisions.length,
		captainDecisions,
		omitted,
		lastReport: rec.parentEvent?.note
			? { text: rec.parentEvent.note, ageSeconds: rec.parentEvent.ageSeconds }
			: null,
		peek
	};
}

/**
 * A second mate the snapshot has only as a row in `tasks[]` (a Firstmate
 * without `secondmate_current`): its record, with nothing read from its home.
 */
function rowRecord(row: SnapshotTask): SecondMateRecord {
	return {
		id: row.id,
		home: null,
		host: null,
		remote: false,
		registered: null,
		state: 'unknown',
		reason: 'This Firstmate’s snapshot does not summarise second mates’ homes.',
		provenance: null,
		summarySource: null,
		freshness: { status: null, observedAt: row.current?.observedAt ?? null, ageSeconds: null },
		active: [],
		decisions: [],
		holds: [],
		queued: [],
		landed: [],
		endpoints: [],
		counts: {},
		parentEvent: row.lastEvent
			? { note: row.lastEvent.note, ageSeconds: row.lastEvent.ageSeconds }
			: null
	};
}

/** The raw records behind every second mate the snapshot names, in its order. */
export function secondMateRecords(snapshot: FleetSnapshot): SecondMateRecord[] {
	const records = [...(snapshot.secondMates?.records ?? [])];
	const known = new Set(records.map((r) => r.id));
	for (const row of snapshot.tasks) {
		if (isSecondMateRow(row) && !known.has(row.id)) records.push(rowRecord(row));
	}
	return records;
}

/** Every second mate in the snapshot, and how many its bound left out. */
export function deriveSecondMates(snapshot: FleetSnapshot): {
	secondMates: SecondMate[];
	omitted: number;
} {
	const rows = new Map(snapshot.tasks.map((t) => [t.id, t]));
	return {
		secondMates: secondMateRecords(snapshot).map((r) => {
			const row = rows.get(r.id) ?? null;
			const backlog = row?.backlog ?? snapshot.backlog.records.find((b) => b.id === r.id) ?? null;
			return deriveSecondMate(r, row, backlog);
		}),
		omitted: snapshot.secondMates?.truncated ?? 0
	};
}
