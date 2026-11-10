import { plainStatus } from '../../plain';
import { shortTitle } from '../../card';
import type { MateHealth, MateTask, SecondMate, TaskStatus, TaskSummary } from '../../types';
import type { BacklogRecord, FleetSnapshot, SecondMateRecord, SnapshotTask } from './contracts';
import { ageText, isSecondMateRow, prNumber, STATUS_LABEL, UNASSIGNED } from './model';
import { stagesFor as defaultStagesFor, type StageModel } from './stages';

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
		'Previews: none reported by its work in flight yet. Each is read from its task’s status log there, up to a minute after the worker reports it, and opens on the task’s page.'
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
	// A cached copy says only that this read did not refresh it (slow, or failed), not that the host is down.
	if (read && rec.summarySource === 'remote-ledger-cache') {
		return {
			...base,
			online: 'unknown',
			cached: true,
			text: `Not refreshed: this is what it reported${age === null ? ' last' : ` ${ageText(age)}`}`,
			reason: `Firstmate's last fleet read could not fetch its summary from ${where} in time, or the fetch failed (the snapshot does not say which), so it kept its last copy.`
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
	// Firstmate's own words for why; only a look that fails to connect says the host is down.
	const reason = rec.reason ?? 'Firstmate could not read its home.';
	return {
		...base,
		online: 'unknown',
		text: rec.remote ? `Not readable: Firstmate could not read it on ${where}` : 'Not readable',
		reason
	};
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
		(h.online === 'unknown' && !h.cached) || h.online === 'offline'
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

const CLOSED_TEXT = 'Its pull request was closed without merging.';

/**
 * A second mate's task in flight whose PR GitHub reports merged is landed, and
 * one whose PR was closed without merging (its worker no longer at work) is
 * closed, as model.ts deriveLiveTask settles a task of the captain's; a
 * question on it keeps it where it is.
 */
function settled(t: MateTask, backlogState: string, prState: string | null): MateTask {
	if (backlogState !== 'in_flight' || !prState) return t;
	if (t.status === 'needs-decision' || t.status === 'with-firstmate') return t;
	if (prState === 'merged') return { ...t, status: 'landed', statusLabel: label('landed') };
	if (prState === 'closed' && t.status !== 'working') {
		return { ...t, status: 'closed', statusLabel: label('closed'), doing: null };
	}
	return t;
}

/**
 * What a second mate's task's own files add (matetasks.ts): its latest PR and
 * preview from its status log, and its project from its meta file.
 */
export interface MateTaskFacts {
	pr: string | null;
	preview: { url: string; reportedAt: string | null } | null;
	/** The latest review board its status log names, as written. */
	board?: { url: string; reportedAt: string | null } | null;
	projectId?: string | null;
	/** How many files its last read of its worktree's changes counted (MateTasks.changes). */
	filesChanged?: number | null;
}

/**
 * A second mate's tasks as the captain's own tasks are shown: one TaskSummary
 * each, named `<task>@<mate>` and marked with where it runs, so they sit in the
 * same lists and open the same task page. Its PR and preview come from its
 * status log when that has been read (facts), else only a landed PR is known;
 * its project from the summary, else its meta file (facts), and its changed-file
 * count from the last read of its changes (facts). As with a task of
 * the captain's, what GitHub last said of its PR (prState) lands it once
 * merged, or closes it once closed without merging (settled).
 * Its questions are cards of their own in Decisions (inbox/cards.ts mateCards),
 * so its attention here only says whose move it is.
 */
export function mateTaskSummaries(
	mate: SecondMate,
	o: {
		facts?: (id: string) => MateTaskFacts | null;
		/** The PR's forge state (open, closed or merged), lowercased; null when unknown. */
		prState?: (id: string) => string | null;
		stagesFor?: (projectId: string) => StageModel;
		nowSeconds: number;
	}
): TaskSummary[] {
	const rows: { t: MateTask; backlogState: string }[] = [
		...mate.inFlight.map((t) => ({ t, backlogState: 'in_flight' })),
		...mate.queued.map((t) => ({ t, backlogState: 'queued' })),
		...mate.landed.map((t) => ({ t, backlogState: 'done' }))
	];
	const where = { id: mate.id, host: mate.host, where: mate.where };
	return rows.map(({ t: listed, backlogState: listedState }) => {
		const id = `${listed.id}@${mate.id}`;
		const facts = o.facts?.(id) ?? null;
		const prUrl = listed.pr?.url ?? facts?.pr ?? null;
		const projectId = listed.projectId ?? facts?.projectId ?? UNASSIGNED;
		const t = settled(listed, listedState, prUrl ? (o.prState?.(id) ?? null) : null);
		const backlogState = t.status === 'landed' ? 'done' : listedState;
		const live = backlogState === 'in_flight' && t === listed;
		const crewState =
			t.status === 'working'
				? 'working'
				: t.status === 'waiting'
					? 'paused'
					: live
						? t.status
						: null;
		const reported = facts?.preview
			? {
					url: facts.preview.url,
					reportedAt: facts.preview.reportedAt ?? new Date(o.nowSeconds * 1000).toISOString()
				}
			: null;
		const passage = (o.stagesFor ?? defaultStagesFor)(projectId).passage({
			track: 'ship',
			backlogState,
			live,
			crewState,
			crewSource: null,
			mode: null,
			yolo: null,
			prUrl,
			prReady: false,
			merged: t.status === 'landed',
			reportPresent: false,
			captainHold: t.status === 'needs-decision',
			taskId: id,
			landedAt: t.completedOn ? Date.parse(`${t.completedOn}T23:59:59`) || null : null,
			preview: reported ? { url: reported.url, at: reported.reportedAt } : null
		});
		const attention: TaskSummary['attention'] =
			t.status === 'needs-decision'
				? {
						kind: 'decision',
						owner: 'captain',
						text: t.doing ?? 'Its second mate is holding this for you.',
						url: null
					}
				: t.status === 'with-firstmate'
					? {
							kind: 'decision',
							owner: 'firstmate',
							text: t.doing ?? 'A question for its second mate.',
							url: null
						}
					: null;
		const canPeek = live && mate.peek.available;
		return {
			id,
			secondMate: where,
			title: t.title,
			shortTitle: shortTitle(t.title, projectId),
			projectId,
			kind: null,
			track: 'ship',
			status: t.status,
			statusLabel: t.statusLabel,
			summary: t.doing ?? (t.status === 'closed' ? CLOSED_TEXT : null),
			summaryIsHistory: false,
			summaryRaw: null,
			activity: t.doing && live ? { text: t.doing, at: null, source: 'state' } : null,
			busy: t.status === 'working' && mate.health.online === 'online',
			pipeline: null,
			filesChanged: facts?.filesChanged ?? null,
			worker: null,
			branch: null,
			passage,
			attention,
			current: null,
			pr: prUrl ? { url: prUrl, number: prNumber(prUrl) } : null,
			since: t.since,
			completedOn: t.completedOn,
			mergedAt: null,
			preview: reported,
			// A board on a remote host's loopback is not reachable from here; one on this computer is.
			board:
				facts?.board && mate.where !== 'remote'
					? {
							url: facts.board.url,
							reportedAt: facts.board.reportedAt ?? new Date(o.nowSeconds * 1000).toISOString()
						}
					: null,
			blockedBy: [],
			hasReport: false,
			outputAvailable: canPeek,
			outputNote: canPeek
				? null
				: live
					? (mate.peek.reason ?? 'Its terminal cannot be read.')
					: 'No worker is running for this task.',
			thumb: { kind: 'none' },
			screenshots: 0,
			shots: []
		};
	});
}
